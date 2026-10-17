/**
 * Mercado Livre (API oficial): OAuth com o app da plataforma (ML_CLIENT_ID/ML_CLIENT_SECRET),
 * pedidos (orders_v2) com comprador, endereço e CPF/CNPJ, anúncios vinculados por SKU,
 * estoque/preço por anúncio e variação, notificações e envio do XML da NF-e.
 */
import crypto from 'crypto';
import { registerProvider } from '../registry';
import { httpRequest, ensureOk, IntegrationError } from '../http';
import { findAccountByExternalId } from '../accounts';
import type { AccountCtx, TokenResult } from '../types';
import { registerAdapter, type MkListing, type MkOrder, type MkAddress, type MkStatus, type MkDraft, type MkInvoice, type MkCategory } from '@/server/services/marketplace/types';
import { num, str, cep, doc, toUf, fullName, joinExternal, splitExternal, chunk, stripHtml, money2 } from '@/server/services/marketplace/mappers';
import { ensureChannelForAccount, ingestForAccount, pollMarketplace, linkListings, actorFor } from '@/server/services/marketplace/sync';

const P = 'MERCADO_LIVRE';
export const ML_API = 'https://api.mercadolibre.com';
const AUTH_URL = 'https://auth.mercadolivre.com.br/authorization';

const clientId = (acc?: AccountCtx) => (acc?.settings.clientId as string) || process.env.ML_CLIENT_ID || '';
const clientSecret = (acc?: AccountCtx) => acc?.secrets.clientSecret || process.env.ML_CLIENT_SECRET || '';

/** PKCE: o verificador é derivado do state (o state é apagado antes da troca do código) */
function pkceVerifier(state: string) {
  return crypto.createHmac('sha256', process.env.NEXTAUTH_SECRET || 'gestaopro-dev-secret').update(`ml-pkce:${state}`).digest('base64url');
}
const pkceChallenge = (v: string) => crypto.createHash('sha256').update(v).digest('base64url');

function tokenResult(d: any): TokenResult {
  if (!d?.access_token) throw new IntegrationError('Mercado Livre: resposta de token inválida');
  return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 21600, externalAccountId: d.user_id != null ? String(d.user_id) : undefined };
}

async function ml<T = any>(acc: AccountCtx, path: string, init: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown; headers?: Record<string, string>; allow404?: boolean } = {}) {
  const res = await httpRequest<T>({ provider: P, companyId: acc.companyId, url: path.startsWith('http') ? path : `${ML_API}${path}`, method: init.method, body: init.body, headers: { Authorization: `Bearer ${acc.secrets.accessToken}`, ...(init.headers || {}) } });
  if (init.allow404 && res.status === 404) return null;
  if (!res.ok) {
    // Erros de validação: { message: "Validation error", cause: [{ type: "error", code, message }] } → mensagens do ML
    const d = res.data as any;
    const causes = (Array.isArray(d?.cause) ? d.cause : []).filter((c: any) => c?.type !== 'warning' && c?.message).map((c: any) => c.message);
    if (causes.length) throw new IntegrationError(`Mercado Livre: ${causes.join(' | ')}`, res.status, d);
  }
  return ensureOk(res, 'Mercado Livre').data;
}

// ---------------------------------------------------------------------------
// Mapeamento do pedido
// ---------------------------------------------------------------------------
const STATUS: Record<string, MkStatus> = { paid: 'PAGO', partially_refunded: 'PAGO', cancelled: 'CANCELADO', invalid: 'CANCELADO' };

/** billing_info (formato clássico: doc_type/doc_number/additional_info; ou formato novo com identification) */
function billing(b: any) {
  const bi = b?.billing_info || b?.buyer?.billing_info || b || {};
  const extra: Record<string, string> = {};
  for (const a of bi.additional_info || []) if (a?.type) extra[a.type] = a.value;
  const document = doc(bi.doc_number || bi.identification?.number);
  const name = fullName(extra.FIRST_NAME || bi.name, extra.LAST_NAME || bi.last_name) || str(extra.BUSINESS_NAME);
  const addr: MkAddress | null = extra.STREET_NAME || bi.address
    ? { street: str(extra.STREET_NAME || bi.address?.street_name), number: str(extra.STREET_NUMBER || bi.address?.street_number), complement: str(extra.COMMENT || bi.address?.comment), district: str(extra.NEIGHBORHOOD || bi.address?.neighborhood), city: str(extra.CITY_NAME || bi.address?.city_name), uf: toUf(extra.STATE_CODE || extra.STATE_NAME || bi.address?.state?.code || bi.address?.state?.name), zip: cep(extra.ZIP_CODE || bi.address?.zip_code) }
    : null;
  return { document, name: str(extra.BUSINESS_NAME) && document?.length === 14 ? str(extra.BUSINESS_NAME)! : name, ie: str(extra.STATE_REGISTRATION), address: addr };
}

/** receiver_address do envio (formato clássico) ou destination.shipping_address (formato novo) */
function receiver(s: any): MkAddress | null {
  const r = s?.receiver_address || s?.destination?.shipping_address;
  if (!r) return null;
  return {
    name: str(r.receiver_name || s?.destination?.receiver_name), phone: str(r.receiver_phone || s?.destination?.receiver_phone), zip: cep(r.zip_code), street: str(r.street_name) || str(r.address_line),
    number: str(r.street_number), complement: str(r.comment), district: str(r.neighborhood?.name), city: str(r.city?.name), uf: toUf(r.state?.id || r.state?.name),
  };
}

/** Pedido do ML (+ envio + dados de faturamento) → pedido normalizado */
export function mapMlOrder(o: any, shipment?: any, billingInfo?: any): MkOrder {
  const bill = billing(billingInfo);
  const ship = receiver(shipment);
  const approved = (o.payments || []).filter((p: any) => ['approved', 'authorized'].includes(p.status));
  const freightPaid = approved.reduce((a: number, p: any) => a + num(p.shipping_cost), 0);
  const freight = freightPaid || num(shipment?.shipping_option?.cost) || num(o.shipping_cost);
  const items = (o.order_items || []).map((it: any) => ({
    sku: str(it.item?.seller_sku) || str(it.item?.seller_custom_field),
    externalItemId: str(it.item?.id),
    variationId: it.item?.variation_id ? String(it.item.variation_id) : null,
    title: [it.item?.title, ...(it.item?.variation_attributes || []).map((v: any) => v.value_name)].filter(Boolean).join(' - '),
    quantity: num(it.quantity),
    unitPrice: num(it.unit_price),
  }));
  // Conferir na documentação: sale_fee é a tarifa por unidade vendida
  const fee = (o.order_items || []).reduce((a: number, it: any) => a + num(it.sale_fee) * num(it.quantity), 0);
  const buyerName = bill.name || fullName(o.buyer?.first_name, o.buyer?.last_name) || ship?.name || o.buyer?.nickname || 'Comprador Mercado Livre';
  const shipStatus = shipment?.status === 'delivered' ? 'ENTREGUE' : shipment?.status === 'shipped' ? 'ENVIADO' : null;
  return {
    externalId: String(o.id),
    packId: o.pack_id ? String(o.pack_id) : null,
    shipmentId: o.shipping?.id ? String(o.shipping.id) : null,
    date: o.date_closed || o.date_created,
    status: STATUS[o.status] || 'PENDENTE',
    shipStatus,
    buyer: { name: buyerName, document: bill.document, ie: bill.ie, nickname: str(o.buyer?.nickname), email: str(o.buyer?.email), phone: ship?.phone || null, address: bill.address?.street ? bill.address : ship },
    shipTo: ship || bill.address,
    items,
    freight,
    discount: 0,
    fee: o.order_items?.some((it: any) => it.sale_fee != null) ? Math.round(fee * 100) / 100 : null,
    paymentLabel: approved[0] ? `${approved[0].payment_type === 'credit_card' ? 'Cartão de crédito' : approved[0].payment_type === 'bank_transfer' ? 'Pix' : approved[0].payment_type === 'ticket' ? 'Boleto' : 'Mercado Pago'}${approved[0].installments > 1 ? ` em ${approved[0].installments}x` : ''}` : null,
    shippingService: shipment?.shipping_option?.name ? `Mercado Envios - ${shipment.shipping_option.name}` : shipment?.logistic_type ? `Mercado Envios (${shipment.logistic_type})` : null,
    carrier: o.shipping?.id ? 'Mercado Envios' : null,
  };
}

async function fullOrder(acc: AccountCtx, o: any) {
  const [shipment, bill] = await Promise.all([
    o.shipping?.id ? ml(acc, `/shipments/${o.shipping.id}`, { allow404: true }).catch(() => null) : null,
    ml(acc, `/orders/${o.id}/billing_info`, { allow404: true }).catch(() => null),
  ]);
  return mapMlOrder(o, shipment, bill);
}

async function fetchOrders(acc: AccountCtx, since: Date) {
  const out: MkOrder[] = [];
  const from = since.toISOString().replace('Z', '-00:00');
  for (let offset = 0; offset < 2000; offset += 50) {
    const r = await ml(acc, `/orders/search?seller=${acc.externalAccountId}&order.date_last_updated.from=${encodeURIComponent(from)}&sort=date_asc&offset=${offset}&limit=50`);
    for (const o of r?.results || []) out.push(await fullOrder(acc, o));
    if (offset + 50 >= Number(r?.paging?.total || 0)) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anúncios
// ---------------------------------------------------------------------------
const skuOf = (x: any) => str(x?.seller_custom_field) || str((x?.attributes || []).find((a: any) => a.id === 'SELLER_SKU')?.value_name);
const LISTING_TYPE: Record<string, string> = { gold_special: 'Clássico', gold_pro: 'Premium', free: 'Grátis', gold_premium: 'Diamante' };
const listingStatus = (s: string, qty: number) => (s === 'active' ? (qty > 0 ? 'ATIVO' : 'SEM_ESTOQUE') : s === 'paused' ? (qty > 0 ? 'PAUSADO' : 'SEM_ESTOQUE') : 'ENCERRADO');

export function mapMlItem(it: any): MkListing[] {
  const base = { title: it.title, permalink: it.permalink || null, listingType: LISTING_TYPE[it.listing_type_id] || it.listing_type_id || null };
  if (it.variations?.length) {
    return it.variations.map((v: any) => ({
      ...base,
      externalId: joinExternal(it.id, v.id),
      sku: skuOf(v),
      title: `${it.title} - ${(v.attribute_combinations || []).map((a: any) => a.value_name).join(' ')}`.trim(),
      price: num(v.price ?? it.price),
      stock: num(v.available_quantity),
      status: listingStatus(it.status, num(v.available_quantity)),
    }));
  }
  return [{ ...base, externalId: String(it.id), sku: skuOf(it), price: num(it.price), stock: num(it.available_quantity), status: listingStatus(it.status, num(it.available_quantity)) }];
}

async function getItems(acc: AccountCtx, ids: string[]) {
  const out: any[] = [];
  for (const part of chunk(ids, 20)) {
    // include_attributes=all traz SELLER_SKU dentro das variações
    const r = await ml<any[]>(acc, `/items?ids=${part.join(',')}&include_attributes=all`);
    for (const x of r || []) if (x?.code === 200 && x.body) out.push(x.body);
  }
  return out;
}

async function fetchListings(acc: AccountCtx) {
  const ids: string[] = [];
  let scrollId: string | null = null;
  for (let page = 0; page < 200; page++) {
    // search_type=scan permite percorrer contas com mais de 1.000 anúncios
    const r: any = await ml(acc, `/users/${acc.externalAccountId}/items/search?search_type=scan&limit=100${scrollId ? `&scroll_id=${encodeURIComponent(scrollId)}` : ''}`);
    const res = (r?.results || []) as string[];
    ids.push(...res);
    scrollId = r?.scroll_id || null;
    if (!res.length || !scrollId) break;
  }
  return (await getItems(acc, ids)).flatMap(mapMlItem);
}

async function pushListing(acc: AccountCtx, externalId: string, data: { stock?: number; price?: number }) {
  const [itemId, variationId] = splitExternal(externalId);
  const patch: Record<string, number> = {};
  if (data.stock != null) patch.available_quantity = Math.max(0, Math.floor(data.stock));
  if (data.price != null) patch.price = Math.round(data.price * 100) / 100;
  if (!Object.keys(patch).length) return;
  if (!variationId) {
    await ml(acc, `/items/${itemId}`, { method: 'PUT', body: patch });
    return;
  }
  // Variações: enviar todas as variações do anúncio (as omitidas seriam excluídas pelo ML).
  // Conferir na documentação: o ML exige o mesmo preço em todas as variações do anúncio.
  const item = await ml(acc, `/items/${itemId}?attributes=variations`);
  const variations = (item?.variations || []).map((v: any) => (String(v.id) === variationId ? { id: v.id, ...patch } : { id: v.id, ...(patch.price != null ? { price: patch.price } : {}) }));
  if (!variations.some((v: any) => String(v.id) === variationId)) throw new IntegrationError(`Mercado Livre: variação ${variationId} não existe mais no anúncio ${itemId}`);
  await ml(acc, `/items/${itemId}`, { method: 'PUT', body: { variations } });
}

/** XML da NF-e no pacote (sem pacote, o ID do pedido faz as vezes do pack_id) */
async function uploadInvoice(acc: AccountCtx, ref: { externalId: string; packId?: string | null }, { xml }: MkInvoice) {
  const boundary = `----GestaoPro${crypto.randomBytes(8).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="fiscal_document"; filename="nfe-${ref.externalId}.xml"\r\nContent-Type: text/xml\r\n\r\n`),
    Buffer.from(xml, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  await ml(acc, `/packs/${ref.packId || ref.externalId}/fiscal_documents`, { method: 'POST', body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
}

// ---------------------------------------------------------------------------
// Criação e edição de anúncios
// ---------------------------------------------------------------------------
/** Predição de categoria pelo título */
async function suggestCategories(acc: AccountCtx, title: string): Promise<MkCategory[]> {
  const r = await ml<any[]>(acc, `/sites/MLB/domain_discovery/search?limit=5&q=${encodeURIComponent(title)}`);
  const seen = new Set<string>();
  return (r || []).filter((d: any) => d?.category_id && !seen.has(d.category_id) && seen.add(d.category_id)).map((d: any) => ({ id: String(d.category_id), name: d.category_name || d.category_id, path: d.domain_name || null }));
}

const fold = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
/** Nomes usuais no ERP → IDs de atributo do ML */
const ATTR_ALIAS: Record<string, string> = { cor: 'COLOR', color: 'COLOR', tamanho: 'SIZE', size: 'SIZE', voltagem: 'VOLTAGE', modelo: 'MODEL', material: 'MATERIAL', sabor: 'FLAVOR', genero: 'GENDER' };

function findAttr(catAttrs: any[], name: string) {
  const n = fold(name);
  return catAttrs.find((a) => a.id === ATTR_ALIAS[n]) || catAttrs.find((a) => fold(String(a.name || '')) === n) || null;
}

/** Valor do atributo: usa value_id quando o nome bate com um valor da lista do ML */
function attrValue(def: any, id: string, value: string) {
  const v = (def?.values || []).find((x: any) => fold(String(x.name)) === fold(value));
  return v ? { id, value_id: String(v.id) } : { id, value_name: value };
}

/** Monta o corpo do POST /items: atributos obrigatórios preenchidos com o que houver no produto */
export function buildMlItem(d: MkDraft, categoryId: string, catAttrs: any[]) {
  const attributes: any[] = [];
  const has = (id: string) => attributes.some((a) => a.id === id);
  const required = (a: any) => a?.tags?.required || a?.tags?.catalog_required;
  if (d.brand) attributes.push({ id: 'BRAND', value_name: d.brand });
  const modelDef = catAttrs.find((a) => a.id === 'MODEL');
  if (modelDef && required(modelDef)) attributes.push({ id: 'MODEL', value_name: d.attributes?.Modelo || d.sku });
  attributes.push({ id: 'ITEM_CONDITION', value_id: '2230284' }); // Novo
  for (const [k, v] of Object.entries(d.attributes || {})) {
    const def = findAttr(catAttrs, k);
    if (def && !has(def.id)) attributes.push(attrValue(def, def.id, v));
  }
  const pictures = d.images.map((source) => ({ source }));
  const body: Record<string, any> = {
    title: d.title.slice(0, 60),
    category_id: categoryId,
    price: money2(d.price),
    currency_id: 'BRL',
    buying_mode: 'buy_it_now',
    listing_type_id: d.listingType || 'gold_special',
    condition: 'new',
    pictures,
    attributes,
  };
  if (!d.variations.length) {
    body.available_quantity = Math.max(0, Math.floor(d.quantity));
    attributes.push({ id: 'SELLER_SKU', value_name: d.sku });
    if (d.gtin) attributes.push({ id: 'GTIN', value_name: d.gtin });
    else if (catAttrs.some((a) => a.id === 'GTIN' && required(a))) attributes.push({ id: 'EMPTY_GTIN_REASON', value_id: '17055160' }); // "O produto não tem código cadastrado"
    return body;
  }
  // Variações: atributos que variam (attribute_combinations) + SKU/GTIN de cada uma.
  // Conferir na documentação: o ML exige o mesmo preço em todas as variações.
  body.variations = d.variations.map((v) => {
    const vAttrs: any[] = [{ id: 'SELLER_SKU', value_name: v.sku }];
    if (v.gtin) vAttrs.push({ id: 'GTIN', value_name: v.gtin });
    const pics = (v.images || []).filter(Boolean);
    for (const p of pics) if (!pictures.some((x) => x.source === p)) pictures.push({ source: p });
    return {
      price: money2(d.price),
      available_quantity: Math.max(0, Math.floor(v.quantity)),
      attribute_combinations: Object.entries(v.attributes).map(([k, val]) => {
        const def = findAttr(catAttrs, k);
        return def ? { ...attrValue(def, def.id, val), name: def.name } : { name: k, value_name: val };
      }),
      attributes: vAttrs,
      ...(pics.length ? { picture_ids: pics } : {}),
    };
  });
  if (!d.variations.some((v) => v.gtin) && catAttrs.some((a) => a.id === 'GTIN' && required(a))) attributes.push({ id: 'EMPTY_GTIN_REASON', value_id: '17055160' });
  return body;
}

async function createListing(acc: AccountCtx, d: MkDraft): Promise<MkListing[]> {
  if (!d.images.length) throw new IntegrationError('Mercado Livre: o anúncio precisa de ao menos uma imagem — cadastre imagens no produto');
  const categoryId = d.categoryId || (await suggestCategories(acc, d.title))[0]?.id;
  if (!categoryId) throw new IntegrationError('Mercado Livre: não foi possível sugerir a categoria — informe a categoria (ex.: MLB1234)');
  const catAttrs = (await ml<any[]>(acc, `/categories/${categoryId}/attributes`)) || [];
  const item = await ml(acc, '/items', { method: 'POST', body: buildMlItem(d, categoryId, catAttrs) });
  // A descrição vai em chamada separada; falha aqui não desfaz o anúncio
  const description = stripHtml(d.description);
  if (description) await ml(acc, `/items/${item.id}/description`, { method: 'POST', body: { plain_text: description } }).catch(() => null);
  // O ML devolve as variações na ordem enviada; o SKU pode não vir na resposta
  const listings = mapMlItem(item);
  if (item.variations?.length) listings.forEach((l, i) => (l.sku = l.sku || d.variations[i]?.sku || null));
  else listings[0].sku = listings[0].sku || d.sku;
  return listings;
}

async function editListing(acc: AccountCtx, externalId: string, data: { active?: boolean; title?: string }) {
  const [itemId] = splitExternal(externalId);
  const body: Record<string, unknown> = {};
  if (data.active != null) body.status = data.active ? 'active' : 'paused';
  if (data.title) body.title = data.title.slice(0, 60);
  if (Object.keys(body).length) await ml(acc, `/items/${itemId}`, { method: 'PUT', body });
}

registerAdapter({ provider: P, fetchOrders, fetchListings, pushListing, uploadInvoice, createListing, editListing, suggestCategories });

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------
export async function mlRefresh(acc: AccountCtx): Promise<TokenResult> {
  if (!acc.secrets.refreshToken) throw new IntegrationError('Mercado Livre: sem refresh_token — reconecte a conta');
  const res = await httpRequest({
    provider: P, companyId: acc.companyId, url: `${ML_API}/oauth/token`, method: 'POST', redactRequest: true,
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId(acc), client_secret: clientSecret(acc), refresh_token: acc.secrets.refreshToken }),
  });
  // O refresh_token do ML é de uso único: o novo substitui o anterior
  return tokenResult(ensureOk(res, 'Mercado Livre').data);
}

registerProvider({
  key: P,
  name: 'Mercado Livre',
  category: 'MARKETPLACE',
  color: '#ffe600',
  description: 'Pedidos importados automaticamente (com CPF/CNPJ e endereço), anúncios vinculados por SKU, estoque e preço enviados a cada alteração e NF-e anexada ao pedido.',
  docsUrl: 'https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br',
  auth: 'OAUTH',
  fields: [
    { key: 'clientId', label: 'Client ID do app próprio (opcional)', help: 'Deixe em branco para usar o aplicativo da plataforma' },
    { key: 'clientSecret', label: 'Client Secret do app próprio (opcional)', secret: true },
  ],
  capabilities: ['Importação de pedidos pagos (notificações orders_v2 + verificação a cada 10 min)', 'Cancelamentos e envios refletidos no pedido', 'Criação de anúncios Clássico/Premium com variações a partir do produto', 'Pausar/ativar e editar preço/título', 'Vínculo de anúncios e variações por SKU', 'Estoque e preço em tempo real', 'Envio do XML da NF-e ao pacote'],
  oauth: {
    appConfigured: () => !!(process.env.ML_CLIENT_ID && process.env.ML_CLIENT_SECRET),
    authorizeUrl: (acc, state, redirectUri) => {
      const q = new URLSearchParams({ response_type: 'code', client_id: clientId(acc), redirect_uri: redirectUri, state, code_challenge: pkceChallenge(pkceVerifier(state)), code_challenge_method: 'S256' });
      return `${AUTH_URL}?${q}`;
    },
    exchange: async (acc, params, redirectUri) => {
      const code = params.get('code');
      if (!code) throw new IntegrationError('Mercado Livre: código de autorização ausente');
      const res = await httpRequest({
        provider: P, companyId: acc.companyId, url: `${ML_API}/oauth/token`, method: 'POST', redactRequest: true,
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId(acc), client_secret: clientSecret(acc), code, redirect_uri: redirectUri, code_verifier: pkceVerifier(params.get('state') || '') }),
      });
      return tokenResult(ensureOk(res, 'Mercado Livre').data);
    },
    refresh: mlRefresh,
  },
  test: async (acc) => {
    const me = await ml(acc, '/users/me');
    const accountName = me.nickname || fullName(me.first_name, me.last_name);
    await ensureChannelForAccount({ ...acc, externalAccountId: String(me.id), accountName }, { force: true, accountName });
    return { accountName, externalAccountId: String(me.id), message: `Conta ${accountName} (${me.site_id || 'MLB'})` };
  },
  poll: { everyMinutes: 10, run: pollMarketplace },
  webhook: {
    // O ML não assina as notificações: confere o application_id e localiza a conta pelo user_id
    verify: (acc, { raw }) => {
      try {
        const b = JSON.parse(raw || '{}');
        const app = clientId(acc || undefined);
        return !app || !b.application_id || String(b.application_id) === String(app);
      } catch {
        return false;
      }
    },
    findAccount: (body) => (body?.user_id ? findAccountByExternalId(P, String(body.user_id)) : Promise.resolve(null)),
    describe: (body) => ({ topic: body?.topic, externalId: String(body?.resource || '').split('/').filter(Boolean).pop() }),
    process: async (event, acc) => {
      const b = event.payload as any;
      const id = String(b?.resource || '').split('/').filter(Boolean)[1];
      if (!id) return 'Notificação sem recurso';
      if (b.topic === 'orders_v2' || b.topic === 'orders') {
        const o = await ml(acc, `/orders/${id}`);
        return ingestForAccount(acc, [await fullOrder(acc, o)]);
      }
      if (b.topic === 'shipments') {
        const s = await ml(acc, `/shipments/${id}`);
        if (!s?.order_id) return 'Envio sem pedido';
        const o = await ml(acc, `/orders/${s.order_id}`);
        return ingestForAccount(acc, [await fullOrder(acc, o)]);
      }
      if (b.topic === 'items') {
        const ch = await ensureChannelForAccount(acc);
        if (!ch) return 'Sem canal';
        const items = await getItems(acc, [id]);
        // Anúncio alterado no ML (inclusive pausado/encerrado): atualiza o vínculo e a situação local
        const r = await linkListings(await actorFor(acc.companyId), ch, items.flatMap(mapMlItem));
        return `Anúncio ${id}: ${r.linked} vínculo(s) atualizado(s)`;
      }
      return `Tópico ${b.topic} ignorado`;
    },
  },
});
