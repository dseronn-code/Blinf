/**
 * Central de integrações: catálogo de conectores, publicação/vínculo de anúncios,
 * sincronização de estoque/preço e importação de pedidos.
 * Canal ligado a uma conta real (Integrações → Contas: Mercado Livre, Shopee,
 * Nuvemshop, Shopify, WooCommerce) → chamadas às APIs oficiais (services/marketplace).
 * Sem conta real → SIMULAÇÃO (OAuth fictício e pedidos com dados realistas).
 */
import { prisma } from '@/lib/db';
import { pick, randomInt, round2, randomDigits } from '@/lib/utils';
import { generateCPF } from '@/lib/br';
import { getAvailability } from './stock';
import { resolvePrice, createOrder, type Actor } from './sales';
import { getAccount } from '@/server/integrations/accounts';
import { linkedAccount, ensureChannelForAccount, realImportOrders, realLinkListings, pushListing, isRealChannel, MARKETPLACE_PROVIDERS } from './marketplace';

export type ConnectorDef = { provider: string; name: string; category: string; color: string; feePercent: number; description: string; orderPrefix: string };

export const CONNECTORS: ConnectorDef[] = [
  { provider: 'MERCADO_LIVRE', name: 'Mercado Livre', category: 'MARKETPLACE', color: '#ffe600', feePercent: 14, description: 'Maior marketplace da América Latina. Anúncios Clássico e Premium, Mercado Envios e Full.', orderPrefix: '20000' },
  { provider: 'SHOPEE', name: 'Shopee', category: 'MARKETPLACE', color: '#ee4d2d', feePercent: 20, description: 'Marketplace com forte presença mobile e frete grátis subsidiado.', orderPrefix: '2410' },
  { provider: 'AMAZON', name: 'Amazon', category: 'MARKETPLACE', color: '#ff9900', feePercent: 15, description: 'Amazon Seller Central — DBA e FBA.', orderPrefix: '702-' },
  { provider: 'MAGALU', name: 'Magalu', category: 'MARKETPLACE', color: '#0086ff', feePercent: 16, description: 'Parceiro Magalu — marketplace do Magazine Luiza.', orderPrefix: 'LU-' },
  { provider: 'AMERICANAS', name: 'Americanas', category: 'MARKETPLACE', color: '#e60014', feePercent: 16, description: 'Americanas Marketplace.', orderPrefix: 'AME' },
  { provider: 'CASAS_BAHIA', name: 'Casas Bahia', category: 'MARKETPLACE', color: '#0033a0', feePercent: 16, description: 'Marketplace Grupo Casas Bahia.', orderPrefix: 'CB' },
  { provider: 'SHEIN', name: 'Shein', category: 'MARKETPLACE', color: '#222222', feePercent: 16, description: 'Shein Marketplace Brasil.', orderPrefix: 'GSH' },
  { provider: 'TIKTOK_SHOP', name: 'TikTok Shop', category: 'MARKETPLACE', color: '#000000', feePercent: 12, description: 'Venda direto nos vídeos e lives do TikTok.', orderPrefix: '57' },
  { provider: 'ALIEXPRESS', name: 'AliExpress', category: 'MARKETPLACE', color: '#e43225', feePercent: 10, description: 'AliExpress para vendedores locais.', orderPrefix: '81' },
  { provider: 'CARREFOUR', name: 'Carrefour', category: 'MARKETPLACE', color: '#004e9f', feePercent: 15, description: 'Marketplace Carrefour.', orderPrefix: 'CRF' },
  { provider: 'NETSHOES', name: 'Netshoes', category: 'MARKETPLACE', color: '#5c2d91', feePercent: 18, description: 'Marketplace de esportes.', orderPrefix: 'NS' },
  { provider: 'DAFITI', name: 'Dafiti', category: 'MARKETPLACE', color: '#000000', feePercent: 18, description: 'Moda e lifestyle.', orderPrefix: 'DF' },
  { provider: 'OLIST', name: 'Olist', category: 'MARKETPLACE', color: '#0c29d0', feePercent: 19, description: 'Hub de marketplaces Olist.', orderPrefix: 'OL' },
  { provider: 'MADEIRA_MADEIRA', name: 'MadeiraMadeira', category: 'MARKETPLACE', color: '#f37021', feePercent: 17, description: 'Casa e móveis.', orderPrefix: 'MM' },
  { provider: 'NUVEMSHOP', name: 'Nuvemshop', category: 'ECOMMERCE', color: '#2c3357', feePercent: 0, description: 'Plataforma de loja virtual.', orderPrefix: '#' },
  { provider: 'TRAY', name: 'Tray', category: 'ECOMMERCE', color: '#0068ff', feePercent: 0, description: 'Plataforma de e-commerce Tray.', orderPrefix: 'TR' },
  { provider: 'SHOPIFY', name: 'Shopify', category: 'ECOMMERCE', color: '#95bf47', feePercent: 0, description: 'Shopify — integração via app.', orderPrefix: '#10' },
  { provider: 'VTEX', name: 'VTEX', category: 'ECOMMERCE', color: '#f71963', feePercent: 0, description: 'VTEX Commerce.', orderPrefix: 'v' },
  { provider: 'WOOCOMMERCE', name: 'WooCommerce', category: 'ECOMMERCE', color: '#7f54b3', feePercent: 0, description: 'Plugin para WordPress.', orderPrefix: 'WC' },
  { provider: 'LOJA_INTEGRADA', name: 'Loja Integrada', category: 'ECOMMERCE', color: '#22c55e', feePercent: 0, description: 'Loja Integrada.', orderPrefix: 'LI' },
  { provider: 'WIX', name: 'Wix', category: 'ECOMMERCE', color: '#0c6efc', feePercent: 0, description: 'Wix eCommerce.', orderPrefix: 'WX' },
  { provider: 'IFOOD', name: 'iFood', category: 'DELIVERY', color: '#ea1d2c', feePercent: 12, description: 'Pedidos de delivery do iFood.', orderPrefix: 'IF' },
  { provider: 'RAPPI', name: 'Rappi', category: 'DELIVERY', color: '#ff441f', feePercent: 15, description: 'Rappi Turbo e Restaurantes.', orderPrefix: 'RP' },
  { provider: 'INSTAGRAM', name: 'Instagram Shopping', category: 'SOCIAL', color: '#d62976', feePercent: 0, description: 'Catálogo no Instagram e Facebook.', orderPrefix: 'IG' },
  { provider: 'GOOGLE_SHOPPING', name: 'Google Shopping', category: 'SOCIAL', color: '#4285f4', feePercent: 0, description: 'Feed de produtos para Google Merchant Center.', orderPrefix: 'GS' },
  { provider: 'WHATSAPP', name: 'WhatsApp Business', category: 'SOCIAL', color: '#25d366', feePercent: 0, description: 'Catálogo e pedidos via WhatsApp.', orderPrefix: 'WA' },
  { provider: 'MERCADO_PAGO', name: 'Mercado Pago', category: 'PAGAMENTO', color: '#00b1ea', feePercent: 0, description: 'Conciliação de recebimentos Mercado Pago.', orderPrefix: 'MP' },
  { provider: 'PAGSEGURO', name: 'PagBank', category: 'PAGAMENTO', color: '#41b54a', feePercent: 0, description: 'Conciliação PagBank/PagSeguro.', orderPrefix: 'PS' },
  { provider: 'MELHOR_ENVIO', name: 'Melhor Envio', category: 'LOGISTICA', color: '#1652f0', feePercent: 0, description: 'Cotação e etiquetas de várias transportadoras.', orderPrefix: 'ME' },
  { provider: 'CORREIOS', name: 'Correios', category: 'LOGISTICA', color: '#ffcc00', feePercent: 0, description: 'Contrato Correios (SIGEP/API).', orderPrefix: 'CO' },
  { provider: 'GESTAO_ENVIOS', name: 'GestãoPro Envios', category: 'LOGISTICA', color: '#16a34a', feePercent: 0, description: 'Logística integrada com descontos (equivalente ao Bling Envios).', orderPrefix: 'GE' },
  { provider: 'CONTABILIDADE', name: 'Portal do Contador', category: 'ERP', color: '#64748b', feePercent: 0, description: 'Envio automático de XMLs e relatórios ao contador.', orderPrefix: 'CT' },
];

export const connector = (provider: string) => CONNECTORS.find((c) => c.provider === provider);

/** Conta real do canal sem interromper o fluxo (falha de token vira log de erro) */
async function realAccountOf(ch: Parameters<typeof linkedAccount>[0]) {
  let acc = null;
  try {
    acc = await linkedAccount(ch);
  } catch (e) {
    await log(ch.id, 'ERRO', (e as Error).message, undefined, false);
    throw e;
  }
  // Canal que já foi ligado a uma conta real nunca volta a simular
  if (!acc && isRealChannel(ch)) throw new Error(`${ch.name}: a conta real está desconectada — reconecte em Integrações → Contas e credenciais`);
  return acc;
}

async function log(channelId: string, type: string, message: string, payload?: unknown, success = true) {
  await prisma.integrationLog.create({ data: { channelId, type, message, payload: (payload as object) ?? undefined, success } });
}

export async function connectChannel(actor: Actor, provider: string, storeName?: string) {
  const def = connector(provider);
  if (!def) throw new Error('Conector desconhecido');
  // Conta real já conectada em Integrações → Contas: liga o canal a ela em vez de simular
  if (MARKETPLACE_PROVIDERS.includes(provider)) {
    const acc = await getAccount(actor.companyId, provider);
    if (acc) return (await ensureChannelForAccount(acc, { force: true }))!;
  }
  const existing = await prisma.salesChannel.findFirst({ where: { companyId: actor.companyId, provider } });
  const data = {
    status: 'CONECTADO',
    storeName: storeName || `${def.name} - Loja Oficial`,
    config: { accessToken: `SIMULATED-${randomDigits(16)}`, sellerId: randomDigits(9), connectedAt: new Date().toISOString() },
  };
  const ch = existing
    ? await prisma.salesChannel.update({ where: { id: existing.id }, data })
    : await prisma.salesChannel.create({ data: { companyId: actor.companyId, provider, name: def.name, category: def.category, feePercent: def.feePercent, ...data } });
  await log(ch.id, 'CONEXAO', `Conta conectada via OAuth (simulado): ${data.storeName}`);
  return ch;
}

export async function disconnectChannel(actor: Actor, channelId: string) {
  const ch = await prisma.salesChannel.update({ where: { id: channelId }, data: { status: 'DESCONECTADO' } });
  await log(channelId, 'CONEXAO', 'Conta desconectada');
  return ch;
}

/** Publica anúncios para os produtos informados (ou todos os ativos sem anúncio) */
export async function publishListings(actor: Actor, channelId: string, productIds?: string[]) {
  const ch = await prisma.salesChannel.findFirst({ where: { id: channelId, companyId: actor.companyId } });
  if (!ch) throw new Error('Canal não encontrado');
  // Canal real: os anúncios são criados no painel do canal e vinculados aqui pelo SKU
  const acc = await realAccountOf(ch);
  if (acc) return (await realLinkListings(actor, ch, acc)).linked;
  const products = await prisma.product.findMany({
    where: { organizationId: actor.orgId, active: true, kind: { in: ['SIMPLES', 'VARIACAO', 'KIT', 'FABRICADO'] }, ...(productIds ? { id: { in: productIds } } : { listings: { none: { channelId } } }) },
    take: 200,
  });
  const avail = await getAvailability(prisma, { orgId: actor.orgId, companyId: actor.companyId }, products.map((p) => p.id));
  let count = 0;
  for (const p of products) {
    const price = await resolvePrice(prisma, p.id, ch.priceListId);
    const stock = Math.max(0, avail.get(p.id)?.available ?? 0);
    const externalId = ch.provider === 'MERCADO_LIVRE' ? `MLB${randomDigits(10)}` : ch.provider === 'AMAZON' ? `B0${randomDigits(8)}` : `${ch.provider.slice(0, 3)}-${randomDigits(9)}`;
    await prisma.listing.upsert({
      where: { channelId_productId: { channelId, productId: p.id } },
      create: { channelId, productId: p.id, externalId, title: p.name, price, stock, status: stock > 0 ? 'ATIVO' : 'SEM_ESTOQUE', listingType: ch.provider === 'MERCADO_LIVRE' ? pick(['Clássico', 'Premium']) : 'Padrão', permalink: `https://simulado.${ch.provider.toLowerCase()}.com/item/${externalId}`, lastSyncAt: new Date() },
      update: { price, stock, title: p.name, lastSyncAt: new Date() },
    });
    count++;
  }
  await log(channelId, 'ANUNCIO', `${count} anúncio(s) publicado(s)/atualizado(s)`);
  return count;
}

/** Vincula os anúncios existentes no canal real aos produtos pelo SKU */
export async function linkChannelListings(actor: Actor, channelId: string) {
  const ch = await prisma.salesChannel.findFirst({ where: { id: channelId, companyId: actor.companyId } });
  if (!ch) throw new Error('Canal não encontrado');
  const acc = await realAccountOf(ch);
  if (!acc) throw new Error('Canal sem conta real conectada — conecte em Integrações → Contas e credenciais');
  return realLinkListings(actor, ch, acc);
}

/**
 * Sincroniza estoque (e preço) dos anúncios — chamado pela automação em tempo real.
 * Canal real: envia à API somente o que mudou (force = envia tudo); erro em um anúncio não interrompe o lote.
 */
export async function syncListings(actor: Actor, opts: { productIds?: string[]; channelId?: string; prices?: boolean; force?: boolean } = {}) {
  const channels = await prisma.salesChannel.findMany({ where: { companyId: actor.companyId, status: 'CONECTADO', ...(opts.channelId ? { id: opts.channelId } : {}) } });
  let updated = 0;
  for (const ch of channels) {
    if (!ch.syncStock && !(opts.prices && ch.syncPrice)) continue;
    const listings = await prisma.listing.findMany({ where: { channelId: ch.id, ...(opts.productIds ? { productId: { in: opts.productIds } } : {}), status: { not: 'ENCERRADO' } } });
    if (!listings.length) continue;
    const avail = await getAvailability(prisma, { orgId: actor.orgId, companyId: actor.companyId }, listings.map((l) => l.productId));
    let acc = null;
    try {
      acc = await realAccountOf(ch);
    } catch {
      continue;
    }
    const changes: string[] = [];
    const errors: string[] = [];
    for (const l of listings) {
      const data: Record<string, unknown> = { lastSyncAt: new Date() };
      const push: { stock?: number; price?: number } = {};
      if (ch.syncStock) {
        const stock = Math.max(0, avail.get(l.productId)?.available ?? 0);
        if (stock !== l.stock) changes.push(`${l.externalId}: estoque ${l.stock} → ${stock}`);
        if (stock !== l.stock || opts.force) push.stock = stock;
        data.stock = stock;
        if (l.status !== 'PAUSADO') data.status = stock > 0 ? 'ATIVO' : 'SEM_ESTOQUE';
      }
      if (opts.prices && ch.syncPrice) {
        const price = await resolvePrice(prisma, l.productId, ch.priceListId);
        if (price !== l.price) changes.push(`${l.externalId}: preço ${l.price.toFixed(2)} → ${price.toFixed(2)}`);
        if (price !== l.price || opts.force) push.price = price;
        data.price = price;
      }
      if (acc && (push.stock != null || push.price != null)) {
        const err = await pushListing(ch, acc, l.externalId, push);
        if (err) {
          // Mantém o valor anterior: a próxima sincronização tenta de novo
          errors.push(`${l.externalId}: ${err}`);
          continue;
        }
      }
      await prisma.listing.update({ where: { id: l.id }, data });
      updated++;
    }
    await prisma.salesChannel.update({ where: { id: ch.id }, data: { lastSyncAt: new Date() } });
    if (changes.length || (acc && opts.force)) await log(ch.id, opts.prices ? 'PRECO' : 'ESTOQUE', `Sincronização${acc ? '' : ' (simulada)'}: ${changes.length} alteração(ões) enviada(s) ao ${ch.name}${acc && opts.force ? ` · ${listings.length - errors.length} anúncio(s) confirmados na API` : ''}`, { changes: changes.slice(0, 50) });
    if (errors.length) await log(ch.id, 'ERRO', `Falha ao enviar ${errors.length} anúncio(s) ao ${ch.name}`, { errors: errors.slice(0, 50) }, false);
  }
  return updated;
}

const FIRST = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Larissa', 'Marcos', 'Natália', 'Otávio', 'Paula', 'Rafael', 'Sabrina', 'Thiago', 'Vanessa', 'Wesley'];
const LAST = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes', 'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida'];
const CITIES = [
  { city: 'São Paulo', uf: 'SP', zip: '01310100', street: 'Avenida Paulista' },
  { city: 'Rio de Janeiro', uf: 'RJ', zip: '22041001', street: 'Rua Barata Ribeiro' },
  { city: 'Belo Horizonte', uf: 'MG', zip: '30130010', street: 'Avenida Afonso Pena' },
  { city: 'Curitiba', uf: 'PR', zip: '80020000', street: 'Rua XV de Novembro' },
  { city: 'Porto Alegre', uf: 'RS', zip: '90010150', street: 'Rua dos Andradas' },
  { city: 'Salvador', uf: 'BA', zip: '40020000', street: 'Avenida Sete de Setembro' },
  { city: 'Recife', uf: 'PE', zip: '50010000', street: 'Rua da Aurora' },
  { city: 'Fortaleza', uf: 'CE', zip: '60060000', street: 'Avenida Beira Mar' },
  { city: 'Goiânia', uf: 'GO', zip: '74003010', street: 'Avenida Goiás' },
  { city: 'Campinas', uf: 'SP', zip: '13010000', street: 'Rua Barão de Jaguara' },
];

/** Gera um comprador fictício como contato */
export async function fakeBuyer(orgId: string) {
  const name = `${pick(FIRST)} ${pick(LAST)} ${pick(LAST)}`;
  const addr = pick(CITIES);
  return prisma.contact.create({
    data: {
      organizationId: orgId,
      types: ['CLIENTE'],
      personType: 'PF',
      name,
      document: generateCPF(),
      email: `${name.split(' ')[0].toLowerCase()}.${randomDigits(4)}@email.com`,
      mobile: `(11) 9${randomDigits(4)}-${randomDigits(4)}`,
      zip: addr.zip,
      street: addr.street,
      number: String(randomInt(10, 2500)),
      district: 'Centro',
      city: addr.city,
      uf: addr.uf,
    },
  });
}

/** Importa N pedidos simulados de um canal conectado (anúncios ativos com estoque) */
export async function importOrders(actor: Actor, channelId: string, count = 3) {
  const ch = await prisma.salesChannel.findFirst({ where: { id: channelId, companyId: actor.companyId } });
  if (!ch || ch.status !== 'CONECTADO') throw new Error('Canal não conectado');
  // Canal real: busca na API os pedidos novos/alterados (a quantidade é ignorada)
  const acc = await realAccountOf(ch);
  if (acc) return (await realImportOrders(actor, ch, acc)).created;
  const def = connector(ch.provider);
  const listings = await prisma.listing.findMany({ where: { channelId, status: 'ATIVO', stock: { gt: 0 } }, include: { product: true } });
  if (!listings.length) {
    await log(channelId, 'PEDIDO', 'Nenhum anúncio ativo com estoque — nenhum pedido importado', undefined, false);
    return [];
  }
  const orders = [];
  for (let i = 0; i < count; i++) {
    const buyer = await fakeBuyer(actor.orgId);
    const lines = Array.from({ length: randomInt(1, Math.min(3, listings.length)) }, () => pick(listings));
    const unique = [...new Map(lines.map((l) => [l.productId, l])).values()];
    const externalId = `${def?.orderPrefix || ''}${randomDigits(10)}`;
    const freight = pick([0, 0, round2(randomInt(1290, 3490) / 100)]);
    try {
      const order = await createOrder(actor, {
        customerId: buyer.id,
        channelId,
        externalId,
        origin: 'INTEGRACAO',
        items: unique.map((l) => ({ productId: l.productId, quantity: Math.min(randomInt(1, 2), Math.max(1, Math.floor(l.stock))), unitPrice: l.price })),
        freight,
        paymentMethod: 'MARKETPLACE',
        installments: 1,
        paymentTermDays: ch.provider === 'MERCADO_LIVRE' ? 14 : 30,
        paidOnCreate: false,
        notes: `Pedido importado automaticamente do ${ch.name} (simulação)`,
      });
      orders.push(order);
      await log(channelId, 'PEDIDO', `Pedido ${externalId} importado → pedido nº ${order.number} (R$ ${order.total.toFixed(2)})`, { externalId, orderId: order.id, buyer: buyer.name });
    } catch (e) {
      await log(channelId, 'ERRO', `Falha ao importar pedido ${externalId}: ${(e as Error).message}`, undefined, false);
    }
  }
  await prisma.salesChannel.update({ where: { id: channelId }, data: { lastSyncAt: new Date() } });
  return orders;
}

/** "Tick" do simulador em tempo real: chance de novos pedidos em canais com importação automática */
export async function simulationTick(actor: Actor) {
  const channels = await prisma.salesChannel.findMany({ where: { companyId: actor.companyId, status: 'CONECTADO', autoImport: true, category: { in: ['MARKETPLACE', 'ECOMMERCE', 'DELIVERY', 'SOCIAL'] } } });
  const created = [];
  for (const ch of channels) {
    // Canais ligados a contas reais recebem pedidos por notificação/sincronização periódica
    if (isRealChannel(ch) || (MARKETPLACE_PROVIDERS.includes(ch.provider) && (await getAccount(actor.companyId, ch.provider).catch(() => null)))) continue;
    if (Math.random() < 0.25) created.push(...(await importOrders(actor, ch.id, 1)));
  }
  return created;
}
