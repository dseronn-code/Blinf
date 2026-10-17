/**
 * Ligação conta real ↔ canal de venda e despacho das operações reais
 * (importar pedidos, vincular anúncios por SKU, enviar estoque/preço, NF-e).
 * O SalesChannel guarda as preferências; a IntegrationAccount, as credenciais.
 */
import type { SalesChannel } from '@prisma/client';
import { prisma } from '@/lib/db';
import { onEvent } from '@/server/events';
import { getProvider } from '@/server/integrations/registry';
import { getAccount, toCtx, ensureFreshToken } from '@/server/integrations/accounts';
import type { AccountCtx } from '@/server/integrations/types';
import type { Actor } from '../sales';
import { getAdapter, MARKETPLACE_PROVIDERS, type MkListing, type MkOrder } from './types';
import { ingestOrder, channelLog, type IngestResult } from './ingest';
import { nfeConsultaUrl } from './mappers';

const DEFAULT_FEE: Record<string, number> = { MERCADO_LIVRE: 14, SHOPEE: 20 };

export async function actorFor(companyId: string, who = 'Integração'): Promise<Actor> {
  const c = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { organizationId: true } });
  return { companyId, orgId: c.organizationId, userName: who };
}

const cfg = (ch: { config: unknown }) => (ch.config || {}) as Record<string, any>;
export const isRealChannel = (ch: { config: unknown }) => !!cfg(ch).realAccountId;

async function findChannel(companyId: string, provider: string) {
  return prisma.salesChannel.findFirst({ where: { companyId, provider }, orderBy: { createdAt: 'asc' } });
}

/**
 * Garante o canal de venda da conta conectada.
 * force: (re)conecta mesmo um canal desconectado (ao conectar/testar a conta);
 * sem force não reativa um canal que o usuário desconectou.
 */
export async function ensureChannelForAccount(acc: AccountCtx, opts: { force?: boolean; accountName?: string | null } = {}) {
  if (!MARKETPLACE_PROVIDERS.includes(acc.provider)) return null;
  const def = getProvider(acc.provider);
  const storeName = opts.accountName || acc.accountName || def?.name || acc.provider;
  const ch = await findChannel(acc.companyId, acc.provider);
  const linked = ch && cfg(ch).realAccountId === acc.id;
  if (ch && linked && (ch.status === 'CONECTADO' || !opts.force)) {
    if (ch.status === 'CONECTADO' && storeName && ch.storeName !== storeName) return prisma.salesChannel.update({ where: { id: ch.id }, data: { storeName } });
    return ch;
  }
  if (ch && !opts.force && ch.status === 'DESCONECTADO') return ch;
  const { accessToken: _sim, ...rest } = ch ? cfg(ch) : {};
  const config = { ...rest, realAccountId: acc.id, sellerId: acc.externalAccountId, connectedAt: new Date().toISOString() };
  const saved = ch
    ? await prisma.salesChannel.update({ where: { id: ch.id }, data: { status: 'CONECTADO', storeName, config } })
    : await prisma.salesChannel.create({ data: { companyId: acc.companyId, provider: acc.provider, name: def?.name || acc.provider, category: def?.category === 'ECOMMERCE' ? 'ECOMMERCE' : 'MARKETPLACE', feePercent: DEFAULT_FEE[acc.provider] ?? 0, status: 'CONECTADO', storeName, config } });
  if (!linked) {
    // Anúncios gerados pela simulação não existem no canal real: encerra para não enviar IDs fictícios
    const sim = await prisma.listing.updateMany({ where: { channelId: saved.id, permalink: { startsWith: 'https://simulado.' } }, data: { status: 'ENCERRADO' } });
    await channelLog(saved.id, 'CONEXAO', `Conta real conectada: ${storeName}${acc.externalAccountId ? ` (ID ${acc.externalAccountId})` : ''}${sim.count ? ` · ${sim.count} anúncio(s) simulado(s) encerrado(s)` : ''}. Use "Vincular anúncios por SKU" para ligar os anúncios aos produtos.`);
  } else await channelLog(saved.id, 'CONEXAO', `Canal reconectado à conta real ${storeName}`);
  return saved;
}

/** Ajusta os canais conforme as contas reais da empresa (chamado ao abrir a Central) */
export async function syncAccountChannels(companyId: string) {
  const rows = await prisma.integrationAccount.findMany({ where: { companyId, provider: { in: MARKETPLACE_PROVIDERS } } });
  for (const r of rows) {
    if (r.status === 'CONECTADO') {
      await ensureChannelForAccount(toCtx(r)).catch(() => null);
      continue;
    }
    const ch = await findChannel(companyId, r.provider);
    if (ch && cfg(ch).realAccountId === r.id && ch.status === 'CONECTADO') {
      await prisma.salesChannel.update({ where: { id: ch.id }, data: { status: 'DESCONECTADO' } });
      await channelLog(ch.id, 'CONEXAO', `Conta real ${r.accountName || ''} desconectada em Integrações → Contas — canal desconectado`, undefined, false);
    }
  }
}

/** Conta real do canal (null → canal simulado). Liga automaticamente se a empresa já conectou a conta. */
export async function linkedAccount(ch: SalesChannel): Promise<AccountCtx | null> {
  if (!MARKETPLACE_PROVIDERS.includes(ch.provider) || !getAdapter(ch.provider)) return null;
  const id = cfg(ch).realAccountId as string | undefined;
  if (id) {
    const row = await prisma.integrationAccount.findUnique({ where: { id } });
    if (!row || row.companyId !== ch.companyId || row.status !== 'CONECTADO') return null;
    return ensureFreshToken(toCtx(row));
  }
  const acc = await getAccount(ch.companyId, ch.provider);
  if (!acc) return null;
  if (ch.status === 'DESCONECTADO') return null;
  await ensureChannelForAccount(acc);
  return acc;
}

/** Situação real/simulada do canal para a interface */
export async function realInfo(ch: SalesChannel) {
  if (!MARKETPLACE_PROVIDERS.includes(ch.provider)) return { supported: false, real: false };
  const id = cfg(ch).realAccountId as string | undefined;
  const row = id ? await prisma.integrationAccount.findUnique({ where: { id } }) : null;
  return {
    supported: true,
    real: !!row && row.status === 'CONECTADO',
    accountName: row?.accountName || null,
    accountStatus: row?.status || null,
    accountError: row?.lastError || null,
    lastOrderSyncAt: cfg(ch).lastOrderSyncAt || null,
    lastListingLinkAt: cfg(ch).lastListingLinkAt || null,
  };
}

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------
async function ingestMany(actor: Actor, ch: SalesChannel, orders: MkOrder[]) {
  const results: IngestResult[] = [];
  for (const mk of orders) {
    try {
      results.push(await ingestOrder(actor, ch, mk));
    } catch (e) {
      const message = `Falha ao importar pedido ${mk.number || mk.externalId}: ${(e as Error).message}`;
      results.push({ action: 'ERRO', message });
      await channelLog(ch.id, 'ERRO', message, { externalId: mk.externalId }, false);
    }
  }
  return results;
}

/** Busca na API os pedidos novos/alterados desde a última sincronização e importa */
export async function realImportOrders(actor: Actor, ch: SalesChannel, acc: AccountCtx, opts: { since?: Date } = {}) {
  const adapter = getAdapter(ch.provider)!;
  const started = new Date();
  const last = cfg(ch).lastOrderSyncAt ? new Date(cfg(ch).lastOrderSyncAt) : null;
  // 1h de sobreposição: pedidos alterados perto do corte não se perdem (a importação é idempotente)
  const since = opts.since || (last ? new Date(last.getTime() - 3600_000) : new Date(Date.now() - 7 * 86400_000));
  let orders: MkOrder[];
  try {
    orders = await adapter.fetchOrders(acc, since);
  } catch (e) {
    await channelLog(ch.id, 'ERRO', `Falha ao consultar pedidos no ${ch.name}: ${(e as Error).message}`, undefined, false);
    throw e;
  }
  const results = await ingestMany(actor, ch, orders);
  const created = results.filter((r) => r.action === 'CRIADO');
  const fresh = await prisma.salesChannel.findUnique({ where: { id: ch.id } });
  await prisma.salesChannel.update({ where: { id: ch.id }, data: { lastSyncAt: started, config: { ...cfg(fresh || ch), lastOrderSyncAt: started.toISOString() } } });
  const errors = results.filter((r) => r.action === 'ERRO').length;
  if (!created.length) await channelLog(ch.id, 'PEDIDO', `Sincronização de pedidos: ${orders.length} consultado(s), nenhum novo${errors ? `, ${errors} com erro` : ''}`, undefined, !errors);
  return { created: await prisma.salesOrder.findMany({ where: { id: { in: created.map((c) => c.orderId!) } } }), results };
}

/** Importa pedidos já obtidos (webhook) para a conta */
export async function ingestForAccount(acc: AccountCtx, orders: MkOrder[]) {
  const ch = await ensureChannelForAccount(acc);
  if (!ch) return 'Provedor sem canal de venda';
  if (ch.status !== 'CONECTADO') return 'Canal desconectado — notificação ignorada';
  const results = await ingestMany(await actorFor(acc.companyId, `Integração ${ch.name}`), ch, orders);
  return results.map((r) => r.message).join(' | ') || 'Nada a importar';
}

/** Sincronização periódica (garantia, além das notificações) */
export async function pollMarketplace(acc: AccountCtx) {
  const ch = await ensureChannelForAccount(acc);
  if (!ch || ch.status !== 'CONECTADO') return 'Canal desconectado';
  if (!ch.autoImport) return 'Importação automática desativada no canal';
  const { created, results } = await realImportOrders(await actorFor(acc.companyId, `Integração ${ch.name}`), ch, acc);
  return `${results.length} pedido(s) consultado(s), ${created.length} importado(s)`;
}

// ---------------------------------------------------------------------------
// Anúncios
// ---------------------------------------------------------------------------
/** Vincula anúncios do canal a produtos pelo SKU (inclusive variações) */
export async function linkListings(actor: Actor, ch: SalesChannel, list: MkListing[]) {
  const skus = [...new Set(list.map((l) => l.sku?.trim()).filter(Boolean) as string[])];
  const products = await prisma.product.findMany({ where: { organizationId: actor.orgId, sku: { in: skus } }, select: { id: true, sku: true, kind: true } });
  const bySku = new Map(products.filter((p) => p.kind !== 'VARIACAO_PAI').map((p) => [p.sku, p.id]));
  let linked = 0;
  const unmatched: string[] = [];
  for (const l of list) {
    const productId = l.sku ? bySku.get(l.sku.trim()) : undefined;
    if (!productId) {
      unmatched.push(`${l.externalId}${l.sku ? ` (SKU ${l.sku})` : ' (sem SKU)'}`);
      continue;
    }
    try {
      const data = { externalId: l.externalId, title: l.title.slice(0, 250), price: l.price, stock: l.stock, status: l.status, listingType: l.listingType || null, permalink: l.permalink || null, lastSyncAt: new Date() };
      await prisma.listing.upsert({ where: { channelId_productId: { channelId: ch.id, productId } }, create: { channelId: ch.id, productId, ...data }, update: data });
      linked++;
    } catch (e) {
      await channelLog(ch.id, 'ERRO', `Anúncio ${l.externalId}: ${(e as Error).message}`, undefined, false);
    }
  }
  return { linked, unmatched };
}

export async function realLinkListings(actor: Actor, ch: SalesChannel, acc: AccountCtx) {
  const adapter = getAdapter(ch.provider)!;
  let list: MkListing[];
  try {
    list = await adapter.fetchListings(acc);
  } catch (e) {
    await channelLog(ch.id, 'ERRO', `Falha ao consultar anúncios no ${ch.name}: ${(e as Error).message}`, undefined, false);
    throw e;
  }
  const r = await linkListings(actor, ch, list);
  await prisma.salesChannel.update({ where: { id: ch.id }, data: { config: { ...cfg(ch), lastListingLinkAt: new Date().toISOString() } } });
  await channelLog(ch.id, 'ANUNCIO', `Vínculo por SKU: ${list.length} anúncio(s)/variação(ões) no canal, ${r.linked} vinculado(s)${r.unmatched.length ? `, ${r.unmatched.length} sem produto com o mesmo SKU` : ''}`, r.unmatched.length ? { unmatched: r.unmatched.slice(0, 100) } : undefined, true);
  return { total: list.length, ...r };
}

/** Envia estoque/preço de um anúncio; devolve mensagem de erro (o lote continua) */
export async function pushListing(ch: SalesChannel, acc: AccountCtx, externalId: string, data: { stock?: number; price?: number }) {
  try {
    await getAdapter(ch.provider)!.pushListing(acc, externalId, data);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

// ---------------------------------------------------------------------------
// NF-e para o canal: XML no pacote do Mercado Livre; número/série/chave nos demais
// (Shopee add_invoice_data, metafields da Shopify, meta_data do WooCommerce, Nuvemshop)
// ---------------------------------------------------------------------------
export async function uploadOrderInvoice(companyId: string, orderId: string, invoiceId: string) {
  const order = await prisma.salesOrder.findFirst({ where: { id: orderId, companyId } });
  if (!order?.channelId || !order.externalId) return null;
  const ch = await prisma.salesChannel.findUnique({ where: { id: order.channelId } });
  const adapter = ch ? getAdapter(ch.provider) : undefined;
  if (!ch || !adapter?.uploadInvoice || !isRealChannel(ch)) return null;
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: { select: { cfop: true }, take: 1 } } });
  const xml = inv?.procXml || inv?.xml;
  if (!inv || inv.status !== 'AUTORIZADA' || !xml || !inv.accessKey) return null;
  const acc = await linkedAccount(ch);
  if (!acc) return null;
  const ref = ((order.shipTo || {}) as any).ref || {};
  try {
    await adapter.uploadInvoice(acc, { externalId: order.externalId, packId: ref.packId || null }, {
      xml, number: inv.number, series: inv.series, accessKey: inv.accessKey, issueDate: inv.authorizedAt || inv.issueDate, total: inv.total, productsTotal: inv.productsTotal, cfop: inv.items[0]?.cfop || null, danfeUrl: nfeConsultaUrl(inv.accessKey),
    });
    await channelLog(ch.id, 'PEDIDO', `NF-e nº ${inv.number} enviada ao ${ch.name} (pedido ${order.externalId})`, { orderId, invoiceId });
    return true;
  } catch (e) {
    await channelLog(ch.id, 'ERRO', `Falha ao enviar NF-e nº ${inv.number} ao ${ch.name}: ${(e as Error).message}`, { orderId, invoiceId }, false);
    return false;
  }
}

// Registro único do ouvinte (evita duplicar em recarga de módulo no desenvolvimento)
const g = globalThis as unknown as { __mkInvoiceListener?: boolean };
if (!g.__mkInvoiceListener) {
  g.__mkInvoiceListener = true;
  onEvent(async (event, p) => {
    if (event === 'order.invoiced' && p.invoiceId) await uploadOrderInvoice(p.companyId, String(p.orderId), String(p.invoiceId));
  });
}
