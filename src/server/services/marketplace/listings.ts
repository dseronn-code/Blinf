/**
 * Criação e edição de anúncios nos canais reais a partir do produto do ERP
 * (como o Bling: escolhe o produto, o canal, o tipo de anúncio e a categoria).
 * Produto com variações → um anúncio com variações; cada variação vira um Listing
 * ligado ao produto filho (ID composto item/variação).
 */
import type { SalesChannel } from '@prisma/client';
import { prisma } from '@/lib/db';
import { appUrl } from '@/server/integrations/accounts';
import type { AccountCtx } from '@/server/integrations/types';
import { resolvePrice, type Actor } from '../sales';
import { getAvailability } from '../stock';
import { getAdapter, type MkDraft, type MkListing } from './types';
import { channelLog } from './ingest';
import { splitExternal } from './mappers';

export const ML_LISTING_TYPES = [
  { value: 'gold_special', label: 'Clássico' },
  { value: 'gold_pro', label: 'Premium' },
];

/** /api/files/... → URL absoluta (os canais baixam as imagens pela internet) */
export function absoluteImage(u: string) {
  if (!u) return '';
  if (/^(https?:|data:)/i.test(u)) return u;
  return `${appUrl()}${u.startsWith('/') ? '' : '/'}${u}`;
}

const imagesOf = (p: { imageUrl: string | null; images: string[] }) => [...new Set([...(p.images || []), ...(p.imageUrl ? [p.imageUrl] : [])].filter(Boolean).map(absoluteImage))].slice(0, 10);

const attrsOf = (v: unknown) => {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x != null && x !== '' && !Array.isArray(x)) out[k] = String(x);
  return out;
};

export type CreateListingInput = { productId: string; listingType?: string | null; categoryId?: string | null; price?: number | null; quantity?: number | null; title?: string | null };

/** Monta o rascunho do anúncio a partir do produto (e das variações) */
export async function buildDraft(actor: Actor, ch: SalesChannel, input: CreateListingInput) {
  const p = await prisma.product.findFirst({ where: { id: input.productId, organizationId: actor.orgId }, include: { variations: { where: { active: true }, orderBy: { sku: 'asc' } } } });
  if (!p) throw new Error('Produto não encontrado');
  if (!['SIMPLES', 'VARIACAO_PAI', 'VARIACAO', 'KIT', 'FABRICADO'].includes(p.kind)) throw new Error('Este tipo de produto não pode ser anunciado');
  const children = p.kind === 'VARIACAO_PAI' ? p.variations : [];
  if (p.kind === 'VARIACAO_PAI' && !children.length) throw new Error('Produto com variações sem nenhuma variação ativa');
  const ids = children.length ? children.map((c) => c.id) : [p.id];
  const avail = await getAvailability(prisma, { orgId: actor.orgId, companyId: actor.companyId }, ids);
  const stockOf = (id: string) => (input.quantity != null && input.quantity !== ('' as any) ? Math.max(0, Math.floor(Number(input.quantity))) : Math.max(0, Math.floor(avail.get(id)?.available ?? 0)));
  const priceOf = async (id: string) => (input.price != null && Number(input.price) > 0 ? Number(input.price) : await resolvePrice(prisma, id, ch.priceListId));
  const variations = [];
  for (const c of children) {
    variations.push({ productId: c.id, sku: c.sku, gtin: c.gtin, price: await priceOf(c.id), quantity: stockOf(c.id), attributes: attrsOf(c.attributes), images: imagesOf(c) });
  }
  const price = children.length ? Math.max(...variations.map((v) => v.price)) : await priceOf(p.id);
  const images = imagesOf(p).length ? imagesOf(p) : [...new Set(variations.flatMap((v) => v.images))].slice(0, 10);
  const draft: MkDraft = {
    orgId: actor.orgId,
    title: (input.title || p.name).trim().slice(0, ch.provider === 'MERCADO_LIVRE' ? 60 : 120),
    description: p.description || p.name,
    sku: p.sku,
    gtin: p.gtin,
    brand: p.brand,
    price,
    quantity: children.length ? variations.reduce((a, v) => a + v.quantity, 0) : stockOf(p.id),
    images,
    weight: p.weight,
    width: p.width,
    height: p.height,
    length: p.length,
    listingType: input.listingType || (ch.provider === 'MERCADO_LIVRE' ? 'gold_special' : null),
    categoryId: input.categoryId || null,
    attributes: p.kind === 'VARIACAO' ? attrsOf(p.attributes) : {},
    variations: variations.map(({ productId: _id, ...v }) => v),
  };
  // SKU → produto do ERP (para gravar um Listing por variação)
  const bySku = new Map<string, string>(children.length ? children.map((c) => [c.sku, c.id]) : [[p.sku, p.id]]);
  return { product: p, draft, bySku };
}

/** Cria o anúncio no canal real e grava os Listings */
export async function createRealListing(actor: Actor, ch: SalesChannel, acc: AccountCtx, input: CreateListingInput) {
  const adapter = getAdapter(ch.provider);
  if (!adapter?.createListing) throw new Error(`${ch.name}: criação de anúncios não suportada`);
  const { product, draft, bySku } = await buildDraft(actor, ch, input);
  const prodIds = [...bySku.values()];
  const existing = await prisma.listing.findFirst({ where: { channelId: ch.id, productId: { in: prodIds }, status: { not: 'ENCERRADO' }, NOT: { permalink: { startsWith: 'https://simulado.' } } } });
  if (existing) throw new Error(`Produto já anunciado neste canal (anúncio ${existing.externalId}). Encerre o anúncio no canal antes de criar outro.`);
  let created: MkListing[];
  try {
    created = await adapter.createListing(acc, draft);
  } catch (e) {
    await channelLog(ch.id, 'ERRO', `Falha ao criar anúncio de ${product.sku} no ${ch.name}: ${(e as Error).message}`, { productId: product.id }, false);
    throw e;
  }
  const rows = [];
  for (const l of created) {
    const productId = (l.sku && bySku.get(l.sku)) || (created.length === 1 ? prodIds[0] : null);
    if (!productId) continue;
    const data = { externalId: l.externalId, title: l.title.slice(0, 250), price: l.price, stock: l.stock, status: l.status, listingType: l.listingType || null, permalink: l.permalink || null, lastSyncAt: new Date() };
    rows.push(await prisma.listing.upsert({ where: { channelId_productId: { channelId: ch.id, productId } }, create: { channelId: ch.id, productId, ...data }, update: data }));
  }
  const first = created[0];
  await channelLog(ch.id, 'ANUNCIO', `Anúncio criado no ${ch.name}: ${first ? splitExternal(first.externalId)[0] : ''} — ${draft.title} (${rows.length} variação(ões)/SKU vinculados)`, { productId: product.id, externalIds: created.map((c) => c.externalId), permalink: first?.permalink });
  return { created: rows.length, listings: rows, permalink: first?.permalink || null };
}

/**
 * Edita o anúncio no canal real: status (pausar/ativar), título e preço.
 * Grava localmente antes e reverte se a API recusar.
 */
export async function editRealListing(ch: SalesChannel, acc: AccountCtx, listingId: string, body: { status?: string; title?: string; price?: number }) {
  const l = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
  const adapter = getAdapter(ch.provider)!;
  const prev = { status: l.status, title: l.title, price: l.price };
  const data: Record<string, unknown> = { lastSyncAt: new Date() };
  const active = body.status === 'ATIVO' ? true : body.status === 'PAUSADO' ? false : undefined;
  if (active != null) data.status = active ? (l.stock > 0 ? 'ATIVO' : 'SEM_ESTOQUE') : 'PAUSADO';
  if (body.title && body.title !== l.title) data.title = body.title;
  if (body.price != null && Number(body.price) !== l.price) data.price = Number(body.price);
  const updated = await prisma.listing.update({ where: { id: l.id }, data });
  try {
    if (active != null || data.title) {
      if (!adapter.editListing) throw new Error(`${ch.name}: edição de anúncios não suportada`);
      await adapter.editListing(acc, l.externalId, { active, title: data.title as string | undefined });
    }
    if (data.price != null) await adapter.pushListing(acc, l.externalId, { price: data.price as number });
  } catch (e) {
    await prisma.listing.update({ where: { id: l.id }, data: prev });
    await channelLog(ch.id, 'ERRO', `Falha ao atualizar o anúncio ${l.externalId} no ${ch.name}: ${(e as Error).message}`, body, false);
    throw e;
  }
  // Pausar/ativar vale para o anúncio inteiro: replica nas demais variações do mesmo item
  const [root] = splitExternal(l.externalId);
  if (active != null && root !== l.externalId) {
    await prisma.listing.updateMany({ where: { channelId: ch.id, id: { not: l.id }, externalId: { startsWith: `${root}/` }, status: { not: 'ENCERRADO' } }, data: { status: active ? 'ATIVO' : 'PAUSADO', lastSyncAt: new Date() } });
  }
  await channelLog(ch.id, 'ANUNCIO', `Anúncio ${l.externalId} atualizado no ${ch.name}: ${[active != null ? (active ? 'ativado' : 'pausado') : '', data.title ? `título "${data.title}"` : '', data.price != null ? `preço R$ ${(data.price as number).toFixed(2)}` : ''].filter(Boolean).join(', ')}`);
  return updated;
}

/** Sugestão de categoria pelo título (ML: domain_discovery; Shopee: category_recommend) */
export async function suggestChannelCategories(ch: SalesChannel, acc: AccountCtx, title: string) {
  const adapter = getAdapter(ch.provider);
  if (!adapter?.suggestCategories || !title.trim()) return [];
  return adapter.suggestCategories(acc, title.trim());
}
