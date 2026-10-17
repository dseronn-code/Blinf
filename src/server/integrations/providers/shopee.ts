/**
 * Shopee Open Platform v2: autorização da loja (auth_partner), tokens (4h) com renovação,
 * pedidos (get_order_list + get_order_detail), estoque/preço por item/modelo e push assinado.
 * App da plataforma: SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY.
 */
import crypto from 'crypto';
import { registerProvider } from '../registry';
import { httpRequest, ensureOk, IntegrationError } from '../http';
import { findAccountByExternalId, appUrl } from '../accounts';
import type { AccountCtx, TokenResult } from '../types';
import { registerAdapter, type MkListing, type MkOrder, type MkStatus, type MkDraft, type MkInvoice, type MkCategory } from '@/server/services/marketplace/types';
import { loadImage } from '@/server/services/marketplace/images';
import { num, str, cep, doc, toUf, splitStreet, joinExternal, splitExternal, chunk, stripHtml, money2, variationOptions, multipart } from '@/server/services/marketplace/mappers';
import { ensureChannelForAccount, ingestForAccount, pollMarketplace } from '@/server/services/marketplace/sync';

const P = 'SHOPEE';
export const SHOPEE_HOSTS = { SANDBOX: 'https://partner.test-stable.shopeemobile.com', PRODUCAO: 'https://partner.shopeemobile.com' };

const host = (acc?: AccountCtx | null) => SHOPEE_HOSTS[acc?.environment === 'PRODUCAO' ? 'PRODUCAO' : 'SANDBOX'];
const partnerId = (acc?: AccountCtx | null) => String((acc?.settings.partnerId as string) || process.env.SHOPEE_PARTNER_ID || '');
const partnerKey = (acc?: AccountCtx | null) => acc?.secrets.partnerKey || process.env.SHOPEE_PARTNER_KEY || '';

/** Assinatura v2: HMAC-SHA256 (hex) de partner_id + path + timestamp (+ access_token + shop_id nas chamadas da loja) */
export function shopeeSign(key: string, pid: string | number, path: string, timestamp: number, accessToken = '', shopId: string | number = '') {
  return crypto.createHmac('sha256', key).update(`${pid}${path}${timestamp}${accessToken}${shopId}`).digest('hex');
}

/** URL assinada de uma chamada pública (auth) ou da loja (com access_token e shop_id) */
export function shopeeUrl(acc: AccountCtx | null, path: string, query: Record<string, string | number> = {}, shop = true, timestamp = Math.floor(Date.now() / 1000)) {
  const pid = partnerId(acc);
  const token = shop ? acc?.secrets.accessToken || '' : '';
  const shopId = shop ? acc?.externalAccountId || '' : '';
  const q = new URLSearchParams({ partner_id: pid, timestamp: String(timestamp), sign: shopeeSign(partnerKey(acc), pid, path, timestamp, token, shopId), ...(shop ? { access_token: token, shop_id: shopId } : {}) });
  for (const [k, v] of Object.entries(query)) q.set(k, String(v));
  return `${host(acc)}${path}?${q}`;
}

async function sp<T = any>(acc: AccountCtx, path: string, opts: { query?: Record<string, string | number>; body?: unknown; headers?: Record<string, string>; shop?: boolean } = {}) {
  const res = await httpRequest<T>({ provider: P, companyId: acc.companyId, url: shopeeUrl(acc, path, opts.query, opts.shop ?? true), method: opts.body ? 'POST' : 'GET', body: opts.body, headers: opts.headers });
  const d = ensureOk(res, 'Shopee').data as any;
  if (d?.error) throw new IntegrationError(`Shopee: ${d.message || d.error}`, res.status, d);
  return d as T;
}

function tokenResult(d: any, shopId?: string): TokenResult {
  if (d?.error || !d?.access_token) throw new IntegrationError(`Shopee: ${d?.message || d?.error || 'resposta de token inválida'}`);
  return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expire_in) || 14400, ...(shopId ? { externalAccountId: shopId } : {}) };
}

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------
const STATUS: Record<string, MkStatus> = { READY_TO_SHIP: 'PAGO', PROCESSED: 'PAGO', RETRY_SHIP: 'PAGO', SHIPPED: 'PAGO', TO_CONFIRM_RECEIVE: 'PAGO', COMPLETED: 'PAGO', INVOICE_PENDING: 'PAGO', TO_RETURN: 'PAGO', IN_CANCEL: 'CANCELADO', CANCELLED: 'CANCELADO' };
const DETAIL_FIELDS = 'buyer_user_id,buyer_username,buyer_cpf_id,recipient_address,item_list,total_amount,estimated_shipping_fee,actual_shipping_fee,shipping_carrier,payment_method,note,pay_time,order_status,message_to_seller';

export function mapShopeeOrder(o: any): MkOrder {
  const r = o.recipient_address || {};
  // full_address: "Rua X, 123, Apto 4, Bairro, Cidade, Estado, CEP" — logradouro e número vêm no início
  const st = splitStreet(String(r.full_address || '').split(',').slice(0, 2).join(','));
  const items = (o.item_list || []).map((it: any) => ({
    sku: str(it.model_sku) || str(it.item_sku),
    externalItemId: String(it.item_id),
    variationId: it.model_id ? String(it.model_id) : null,
    title: [it.item_name, it.model_name].filter(Boolean).join(' - '),
    quantity: num(it.model_quantity_purchased),
    unitPrice: num(it.model_discounted_price || it.model_original_price),
  }));
  const itemsTotal = items.reduce((a: number, i: any) => a + i.quantity * i.unitPrice, 0);
  // total_amount inclui o frete pago pelo comprador
  const freight = Math.max(0, Math.round((num(o.total_amount) - itemsTotal) * 100) / 100);
  const address = { name: str(r.name), phone: str(r.phone), zip: cep(r.zipcode), street: st.street, number: st.number, complement: st.complement, district: str(r.district), city: str(r.city), uf: toUf(r.state) };
  return {
    externalId: String(o.order_sn),
    date: o.create_time ? new Date(Number(o.create_time) * 1000) : null,
    status: STATUS[o.order_status] || 'PENDENTE',
    shipStatus: o.order_status === 'COMPLETED' ? 'ENTREGUE' : ['SHIPPED', 'TO_CONFIRM_RECEIVE'].includes(o.order_status) ? 'ENVIADO' : null,
    buyer: { name: str(r.name) || str(o.buyer_username) || 'Comprador Shopee', nickname: str(o.buyer_username), document: doc(o.buyer_cpf_id), phone: str(r.phone), address },
    shipTo: address,
    items,
    freight,
    discount: 0,
    // Conferir na documentação: a tarifa real vem em payment/get_escrow_detail após a conclusão; até lá usa o % do canal
    fee: null,
    paymentLabel: str(o.payment_method),
    carrier: str(o.shipping_carrier),
    notes: str(o.message_to_seller),
  };
}

async function orderDetails(acc: AccountCtx, sns: string[]) {
  const out: MkOrder[] = [];
  for (const part of chunk(sns, 50)) {
    const d = await sp(acc, '/api/v2/order/get_order_detail', { query: { order_sn_list: part.join(','), response_optional_fields: DETAIL_FIELDS } });
    for (const o of d?.response?.order_list || []) out.push(mapShopeeOrder(o));
  }
  return out;
}

async function fetchOrders(acc: AccountCtx, since: Date) {
  const sns: string[] = [];
  const now = Math.floor(Date.now() / 1000);
  // A janela máxima é de 15 dias por consulta
  for (let from = Math.floor(since.getTime() / 1000); from < now; from += 15 * 86400) {
    let cursor = '';
    for (let page = 0; page < 50; page++) {
      const d = await sp(acc, '/api/v2/order/get_order_list', { query: { time_range_field: 'update_time', time_from: from, time_to: Math.min(now, from + 15 * 86400), page_size: 100, cursor } });
      sns.push(...(d?.response?.order_list || []).map((o: any) => String(o.order_sn)));
      if (!d?.response?.more) break;
      cursor = d.response.next_cursor;
    }
  }
  return orderDetails(acc, [...new Set(sns)]);
}

// ---------------------------------------------------------------------------
// Anúncios
// ---------------------------------------------------------------------------
const stockOf = (x: any) => num(x?.stock_info_v2?.summary_info?.total_available_stock ?? x?.stock_info?.[0]?.normal_stock ?? 0);
const priceOf = (x: any) => num(x?.price_info?.[0]?.original_price ?? x?.price_info?.[0]?.current_price);
const lstatus = (s: string, qty: number) => (s === 'NORMAL' ? (qty > 0 ? 'ATIVO' : 'SEM_ESTOQUE') : s === 'UNLIST' ? 'PAUSADO' : 'ENCERRADO');

async function fetchListings(acc: AccountCtx) {
  const ids: number[] = [];
  for (const status of ['NORMAL', 'UNLIST']) {
    for (let offset = 0, page = 0; page < 100; page++) {
      const d = await sp(acc, '/api/v2/product/get_item_list', { query: { offset, page_size: 100, item_status: status } });
      ids.push(...(d?.response?.item || []).map((i: any) => i.item_id));
      if (!d?.response?.has_next_page) break;
      offset = d.response.next_offset;
    }
  }
  const out: MkListing[] = [];
  for (const part of chunk(ids, 50)) {
    const d = await sp(acc, '/api/v2/product/get_item_base_info', { query: { item_id_list: part.join(',') } });
    for (const it of d?.response?.item_list || []) {
      const permalink = `https://shopee.com.br/product/${acc.externalAccountId}/${it.item_id}`;
      if (!it.has_model) {
        out.push({ externalId: String(it.item_id), sku: str(it.item_sku), title: it.item_name, price: priceOf(it), stock: stockOf(it), status: lstatus(it.item_status, stockOf(it)), permalink });
        continue;
      }
      const m = await sp(acc, '/api/v2/product/get_model_list', { query: { item_id: it.item_id } });
      for (const md of m?.response?.model || []) {
        out.push({ externalId: joinExternal(it.item_id, md.model_id), sku: str(md.model_sku), title: `${it.item_name} - ${md.model_name || ''}`.trim(), price: priceOf(md), stock: stockOf(md), status: lstatus(it.item_status, stockOf(md)), permalink });
      }
    }
  }
  return out;
}

async function pushListing(acc: AccountCtx, externalId: string, data: { stock?: number; price?: number }) {
  const [itemId, modelId] = splitExternal(externalId);
  const model_id = Number(modelId || 0);
  if (data.stock != null) await sp(acc, '/api/v2/product/update_stock', { body: { item_id: Number(itemId), stock_list: [{ model_id, seller_stock: [{ stock: Math.max(0, Math.floor(data.stock)) }] }] } });
  if (data.price != null) await sp(acc, '/api/v2/product/update_price', { body: { item_id: Number(itemId), price_list: [{ model_id, original_price: Math.round(data.price * 100) / 100 }] } });
}

// ---------------------------------------------------------------------------
// Criação e edição de anúncios
// ---------------------------------------------------------------------------
/** Sugestão de categoria pelo nome do item */
async function suggestCategories(acc: AccountCtx, title: string): Promise<MkCategory[]> {
  const d = await sp(acc, '/api/v2/product/category_recommend', { query: { item_name: title.slice(0, 120) } });
  return ((d?.response?.category_id || []) as number[]).map((id) => ({ id: String(id), name: `Categoria ${id}` }));
}

/** Imagem → image_id (v2.media_space.upload_image, multipart campo "image") */
async function uploadImage(acc: AccountCtx, orgId: string, url: string) {
  const img = await loadImage(orgId, url);
  if (!img) throw new IntegrationError(`Shopee: não foi possível ler a imagem ${url.slice(0, 80)}`);
  const mp = multipart({ field: 'image', filename: img.filename, mime: img.mime, data: img.data });
  // Conferir na documentação: upload_image é chamada pública (assinada sem access_token/shop_id)
  const d = await sp(acc, '/api/v2/media_space/upload_image', { body: mp.body, headers: { 'Content-Type': mp.contentType }, shop: false });
  const id = d?.response?.image_info?.image_id;
  if (!id) throw new IntegrationError('Shopee: upload da imagem sem image_id');
  return String(id);
}

/** Canais logísticos habilitados na loja (logistic_info é obrigatório no add_item) */
async function logistics(acc: AccountCtx) {
  const d = await sp(acc, '/api/v2/logistics/get_channel_list');
  const list = (d?.response?.logistics_channel_list || []).filter((c: any) => c.enabled && !c.mask_channel_id);
  if (!list.length) throw new IntegrationError('Shopee: nenhum canal de envio habilitado na loja — ative ao menos um em Configurações de Envio no Seller Center');
  return list.map((c: any) => ({ logistic_id: c.logistics_channel_id, enabled: true }));
}

/** Corpo do v2.product.add_item */
export function buildShopeeItem(d: MkDraft, imageIds: string[], logisticInfo: { logistic_id: number; enabled: boolean }[]) {
  const desc = stripHtml(d.description);
  return {
    item_name: d.title.slice(0, 120),
    description: desc.length >= 20 ? desc.slice(0, 3000) : `${d.title}. ${desc}`.padEnd(20, '.'),
    original_price: money2(d.price),
    seller_stock: [{ stock: d.variations.length ? 0 : Math.max(0, Math.floor(d.quantity)) }],
    category_id: Number(d.categoryId),
    image: { image_id_list: imageIds.slice(0, 9) },
    item_sku: d.sku,
    weight: Math.max(0.01, Math.round(d.weight * 1000) / 1000),
    dimension: { package_length: Math.max(1, Math.round(d.length)), package_width: Math.max(1, Math.round(d.width)), package_height: Math.max(1, Math.round(d.height)) },
    logistic_info: logisticInfo,
    condition: 'NEW',
    item_status: 'NORMAL',
    // Conferir na documentação: categorias com marca obrigatória exigem brand_id da lista get_brand_list (0 = "NoBrand")
    brand: { brand_id: 0, original_brand_name: d.brand || 'NoBrand' },
    ...(d.gtin && !d.variations.length ? { gtin_code: d.gtin } : {}),
  };
}

/** Corpo do v2.product.init_tier_variation (até 2 níveis de variação) */
export function buildShopeeTiers(itemId: number, d: MkDraft) {
  const opts = variationOptions(d.variations).slice(0, 2);
  return {
    item_id: itemId,
    tier_variation: opts.map((o) => ({ name: o.name.slice(0, 14), option_list: o.values.map((option) => ({ option: option.slice(0, 20) })) })),
    model: d.variations.map((v) => ({
      tier_index: opts.map((o) => Math.max(0, o.values.indexOf(v.attributes[o.name]))),
      original_price: money2(v.price),
      model_sku: v.sku,
      seller_stock: [{ stock: Math.max(0, Math.floor(v.quantity)) }],
      ...(v.gtin ? { gtin_code: v.gtin } : {}),
    })),
  };
}

async function createListing(acc: AccountCtx, d: MkDraft): Promise<MkListing[]> {
  if (!d.categoryId || !/^\d+$/.test(String(d.categoryId))) throw new IntegrationError('Shopee: informe a categoria do anúncio (ID numérico da categoria Shopee — use "Sugerir categoria")');
  if (!d.images.length) throw new IntegrationError('Shopee: o anúncio precisa de ao menos uma imagem — cadastre imagens no produto');
  const imageIds: string[] = [];
  for (const url of d.images.slice(0, 9)) imageIds.push(await uploadImage(acc, d.orgId, url));
  const add = await sp(acc, '/api/v2/product/add_item', { body: buildShopeeItem(d, imageIds, await logistics(acc)) });
  const itemId = Number(add?.response?.item_id);
  if (!itemId) throw new IntegrationError('Shopee: add_item não devolveu o item_id');
  const permalink = `https://shopee.com.br/product/${acc.externalAccountId}/${itemId}`;
  if (!d.variations.length) return [{ externalId: String(itemId), sku: d.sku, title: d.title, price: money2(d.price), stock: d.quantity, status: d.quantity > 0 ? 'ATIVO' : 'SEM_ESTOQUE', permalink }];
  const tiers = await sp(acc, '/api/v2/product/init_tier_variation', { body: buildShopeeTiers(itemId, d) });
  let models: any[] = tiers?.response?.model || [];
  if (!models.some((m) => m.model_id)) models = (await sp(acc, '/api/v2/product/get_model_list', { query: { item_id: itemId } }))?.response?.model || [];
  return d.variations.map((v) => {
    const m = models.find((x) => str(x.model_sku) === v.sku);
    return { externalId: joinExternal(itemId, m?.model_id), sku: v.sku, title: `${d.title} - ${Object.values(v.attributes).join(' ')}`.trim(), price: money2(v.price), stock: v.quantity, status: v.quantity > 0 ? 'ATIVO' : 'SEM_ESTOQUE', permalink };
  });
}

async function editListing(acc: AccountCtx, externalId: string, data: { active?: boolean; title?: string }) {
  const [itemId] = splitExternal(externalId);
  if (data.active != null) await sp(acc, '/api/v2/product/unlist_item', { body: { item_list: [{ item_id: Number(itemId), unlist: !data.active }] } });
  if (data.title) await sp(acc, '/api/v2/product/update_item', { body: { item_id: Number(itemId), item_name: data.title.slice(0, 120) } });
}

// ---------------------------------------------------------------------------
// NF-e (Brasil): v2.order.add_invoice_data — pedidos em INVOICE_PENDING aguardam estes dados
// ---------------------------------------------------------------------------
export function buildShopeeInvoice(orderSn: string, inv: MkInvoice) {
  return {
    order_sn: orderSn,
    invoice_data: {
      number: String(inv.number),
      series_number: String(inv.series),
      access_key: inv.accessKey,
      issue_date: Math.floor(new Date(inv.issueDate).getTime() / 1000),
      total_value: money2(inv.total),
      products_total_value: money2(inv.productsTotal),
      tax_code: (inv.cfop || '').replace(/\D/g, '') || '5102',
    },
  };
}

async function uploadInvoice(acc: AccountCtx, ref: { externalId: string }, inv: MkInvoice) {
  await sp(acc, '/api/v2/order/add_invoice_data', { body: buildShopeeInvoice(ref.externalId, inv) });
  // Conferir na documentação: o XML pode ser exigido via v2.order.upload_invoice_doc (file_type 1 = XML) em alguns modelos logísticos
  const mp = multipart({ field: 'file', filename: `nfe-${inv.accessKey}.xml`, mime: 'text/xml', data: Buffer.from(inv.xml, 'utf8') }, { order_sn: ref.externalId, file_type: '1' });
  await sp(acc, '/api/v2/order/upload_invoice_doc', { body: mp.body, headers: { 'Content-Type': mp.contentType } }).catch(() => null);
}

registerAdapter({ provider: P, fetchOrders, fetchListings, pushListing, createListing, editListing, suggestCategories, uploadInvoice });

// ---------------------------------------------------------------------------
// Provedor
// ---------------------------------------------------------------------------
export async function shopeeRefresh(acc: AccountCtx) {
  const path = '/api/v2/auth/access_token/get';
  const res = await httpRequest({ provider: P, companyId: acc.companyId, url: shopeeUrl(acc, path, {}, false), method: 'POST', redactRequest: true, body: { refresh_token: acc.secrets.refreshToken, shop_id: Number(acc.externalAccountId), partner_id: Number(partnerId(acc)) } });
  return tokenResult(ensureOk(res, 'Shopee').data);
}

/** Push: Authorization = HMAC-SHA256(partner_key, URL de retorno + "|" + corpo) em hex */
export function verifyShopeePush(key: string, url: string, raw: string, authorization: string | null) {
  if (!key || !authorization) return false;
  const expected = crypto.createHmac('sha256', key).update(`${url}|${raw}`).digest('hex');
  return expected.length === authorization.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(authorization));
}

registerProvider({
  key: P,
  name: 'Shopee',
  category: 'MARKETPLACE',
  color: '#ee4d2d',
  description: 'Pedidos importados automaticamente, estoque e preço enviados por item/variação (Open Platform v2).',
  docsUrl: 'https://open.shopee.com/documents/v2/v2.order.get_order_list',
  auth: 'OAUTH',
  sandbox: true,
  fields: [
    { key: 'partnerId', label: 'Partner ID do app próprio (opcional)', help: 'Deixe em branco para usar o aplicativo da plataforma' },
    { key: 'partnerKey', label: 'Partner Key do app próprio (opcional)', secret: true },
  ],
  capabilities: ['Importação de pedidos pagos (push + verificação a cada 10 min)', 'Cancelamentos e envios refletidos no pedido', 'Criação de anúncios com variações, imagens e logística', 'Dados da NF-e enviados ao pedido (add_invoice_data)', 'Vínculo de itens e modelos por SKU', 'Estoque e preço em tempo real'],
  oauth: {
    appConfigured: () => !!(process.env.SHOPEE_PARTNER_ID && process.env.SHOPEE_PARTNER_KEY),
    authorizeUrl: (acc, state, redirectUri) => {
      // A Shopee devolve ?code=&shop_id= anexados à URL de retorno (que já leva o state)
      return shopeeUrl(acc, '/api/v2/shop/auth_partner', { redirect: `${redirectUri}?state=${state}` }, false);
    },
    exchange: async (acc, params) => {
      const code = params.get('code');
      const shopId = params.get('shop_id');
      if (!code || !shopId) throw new IntegrationError('Shopee: código de autorização ou loja ausente (autorize uma loja, não a conta principal)');
      const res = await httpRequest({ provider: P, companyId: acc.companyId, url: shopeeUrl(acc, '/api/v2/auth/token/get', {}, false), method: 'POST', redactRequest: true, body: { code, shop_id: Number(shopId), partner_id: Number(partnerId(acc)) } });
      return tokenResult(ensureOk(res, 'Shopee').data, shopId);
    },
    refresh: shopeeRefresh,
  },
  test: async (acc) => {
    if (!acc.externalAccountId) throw new IntegrationError('Shopee: loja não autorizada — clique em Conectar');
    const d = await sp(acc, '/api/v2/shop/get_shop_info');
    const accountName = d.shop_name || `Loja ${acc.externalAccountId}`;
    await ensureChannelForAccount({ ...acc, accountName }, { force: true, accountName });
    return { accountName, externalAccountId: acc.externalAccountId, message: `Loja ${accountName} (${d.region || 'BR'})` };
  },
  poll: { everyMinutes: 10, run: pollMarketplace },
  webhook: {
    verify: (acc, { headers, raw, query }) => {
      const auth = headers.get('authorization');
      const qs = query.toString();
      const bases = [appUrl(), headers.get('host') ? `https://${headers.get('host')}` : ''].filter(Boolean);
      return bases.some((b) => [`${b}/api/hooks/shopee`, `${b}/api/hooks/shopee${qs ? `?${qs}` : ''}`].some((u) => verifyShopeePush(partnerKey(acc), u, raw, auth)));
    },
    findAccount: (body) => (body?.shop_id ? findAccountByExternalId(P, String(body.shop_id)) : Promise.resolve(null)),
    describe: (body) => ({ topic: body?.code != null ? `code_${body.code}` : undefined, externalId: body?.data?.ordersn }),
    process: async (event, acc) => {
      const b = event.payload as any;
      // code 3 = mudança de situação do pedido; 4 = rastreio
      if ([3, 4].includes(Number(b?.code)) && b?.data?.ordersn) return ingestForAccount(acc, await orderDetails(acc, [String(b.data.ordersn)]));
      return `Push code ${b?.code} ignorado`;
    },
  },
});

