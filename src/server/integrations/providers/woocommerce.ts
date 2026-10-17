/**
 * WooCommerce (REST API /wp-json/wc/v3): URL da loja + consumer key/secret (Basic auth sobre HTTPS).
 * Pedidos (webhook com X-WC-Webhook-Signature + verificação periódica), produtos e variações
 * por SKU (stock_quantity, regular_price). Compatível com os campos do plugin "Brazilian Market".
 */
import { registerProvider } from '../registry';
import { httpRequest, ensureOk, IntegrationError } from '../http';
import type { AccountCtx } from '../types';
import { registerAdapter, type MkListing, type MkOrder, type MkStatus, type MkAddress, type MkDraft, type MkInvoice } from '@/server/services/marketplace/types';
import { num, str, cep, doc, toUf, fullName, splitStreet, joinExternal, splitExternal, hmacMatches, money2, variationOptions } from '@/server/services/marketplace/mappers';
import { ensureChannelForAccount, ingestForAccount, pollMarketplace } from '@/server/services/marketplace/sync';

const P = 'WOOCOMMERCE';

export function storeBase(v: unknown) {
  return String(v || '').trim().replace(/\/+$/, '').replace(/\/wp-json.*$/, '');
}

async function wc<T = any>(acc: AccountCtx, path: string, init: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}) {
  const b = storeBase(acc.settings.storeUrl);
  if (!/^https:\/\//i.test(b)) throw new IntegrationError('WooCommerce: informe a URL da loja com HTTPS (a autenticação por chave exige HTTPS)');
  const auth = Buffer.from(`${acc.secrets.consumerKey || ''}:${acc.secrets.consumerSecret || ''}`).toString('base64');
  const res = await httpRequest<T>({ provider: P, companyId: acc.companyId, url: `${b}/wp-json/wc/v3${path}`, method: init.method, body: init.body, headers: { Authorization: `Basic ${auth}` } });
  // Erros: { code, message, data: { status, params? } } — message já é legível
  ensureOk(res, 'WooCommerce');
  return res;
}

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------
const STATUS: Record<string, MkStatus> = { processing: 'PAGO', completed: 'PAGO', cancelled: 'CANCELADO', refunded: 'CANCELADO', failed: 'CANCELADO' };

function meta(o: any, key: string) {
  return (o.meta_data || []).find((m: any) => m.key === key)?.value;
}

function addr(a: any, o: any, kind: 'billing' | 'shipping'): MkAddress | null {
  if (!a || !(a.address_1 || a.postcode)) return null;
  // Com o plugin "Brazilian Market" o número vem separado; sem ele, vem junto do logradouro
  const own = str(a.number) || str(meta(o, `_${kind}_number`));
  const st = own ? { street: str(a.address_1), number: own, complement: null } : splitStreet(a.address_1);
  return {
    name: fullName(a.first_name, a.last_name) || str(a.company), phone: str(a.phone), zip: cep(a.postcode), street: st.street, number: st.number,
    complement: str(a.address_2) || st.complement, district: str(a.neighborhood) || str(meta(o, `_${kind}_neighborhood`)), city: str(a.city), uf: toUf(a.state),
  };
}

export function mapWooOrder(o: any): MkOrder {
  const b = o.billing || {};
  const document = doc(b.cpf) || doc(b.cnpj) || doc(meta(o, '_billing_cpf')) || doc(meta(o, '_billing_cnpj'));
  const bill = addr(b, o, 'billing');
  const ship = addr(o.shipping, o, 'shipping');
  const pj = document?.length === 14;
  return {
    externalId: String(o.id),
    number: o.number ? `#${o.number}` : null,
    date: o.date_paid_gmt ? `${o.date_paid_gmt}Z` : o.date_created_gmt ? `${o.date_created_gmt}Z` : o.date_created,
    status: STATUS[o.status] || 'PENDENTE',
    shipStatus: o.status === 'completed' ? 'ENVIADO' : null,
    buyer: { name: (pj && str(b.company)) || fullName(b.first_name, b.last_name) || 'Cliente WooCommerce', document, ie: str(b.ie) || str(meta(o, '_billing_ie')), email: str(b.email), phone: str(b.cellphone) || str(b.phone), address: bill || ship },
    shipTo: ship || bill,
    // subtotal = antes do cupom; total = depois do cupom (por linha)
    items: (o.line_items || []).map((li: any) => ({ sku: str(li.sku), externalItemId: String(li.product_id), variationId: li.variation_id ? String(li.variation_id) : null, title: str(li.name) || '', quantity: num(li.quantity), unitPrice: num(li.quantity) ? num(li.subtotal) / num(li.quantity) : num(li.price), discount: Math.max(0, Math.round((num(li.subtotal) - num(li.total)) * 100) / 100) })),
    freight: num(o.shipping_total),
    discount: 0,
    fee: null,
    paymentLabel: str(o.payment_method_title),
    shippingService: str(o.shipping_lines?.[0]?.method_title),
    notes: str(o.customer_note),
  };
}

async function fetchOrders(acc: AccountCtx, since: Date) {
  const out: MkOrder[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await wc<any[]>(acc, `/orders?modified_after=${encodeURIComponent(since.toISOString())}&per_page=100&page=${page}&orderby=date&order=asc`);
    const rows = Array.isArray(res.data) ? res.data : [];
    out.push(...rows.map(mapWooOrder));
    if (page >= Number(res.headers['x-wp-totalpages'] || 1) || rows.length < 100) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Produtos / variações
// ---------------------------------------------------------------------------
const lstatus = (p: any, stock: number) => (p.status !== 'publish' ? 'PAUSADO' : p.stock_status === 'outofstock' || (p.manage_stock && stock <= 0) ? 'SEM_ESTOQUE' : 'ATIVO');

async function fetchListings(acc: AccountCtx) {
  const out: MkListing[] = [];
  for (let page = 1; page <= 100; page++) {
    const res = await wc<any[]>(acc, `/products?per_page=100&page=${page}&status=any`);
    const rows = Array.isArray(res.data) ? res.data : [];
    for (const p of rows) {
      if (p.type === 'variable') {
        for (let vp = 1; vp <= 20; vp++) {
          const vr = await wc<any[]>(acc, `/products/${p.id}/variations?per_page=100&page=${vp}`);
          const vars = Array.isArray(vr.data) ? vr.data : [];
          for (const v of vars) {
            const stock = num(v.stock_quantity);
            const values = (v.attributes || []).map((a: any) => a.option).join(' ');
            out.push({ externalId: joinExternal(p.id, v.id), sku: str(v.sku), title: `${p.name}${values ? ` - ${values}` : ''}`, price: num(v.regular_price || v.price), stock, status: lstatus({ ...v, status: v.status === 'private' ? 'private' : p.status }, stock), permalink: str(v.permalink) || str(p.permalink), listingType: 'Loja' });
          }
          if (vars.length < 100) break;
        }
      } else {
        const stock = num(p.stock_quantity);
        out.push({ externalId: String(p.id), sku: str(p.sku), title: p.name, price: num(p.regular_price || p.price), stock, status: lstatus(p, stock), permalink: str(p.permalink), listingType: 'Loja' });
      }
    }
    if (page >= Number(res.headers['x-wp-totalpages'] || 1) || rows.length < 100) break;
  }
  return out;
}

async function pushListing(acc: AccountCtx, externalId: string, data: { stock?: number; price?: number }) {
  const [productId, variationId] = splitExternal(externalId);
  const body: Record<string, unknown> = {};
  if (data.stock != null) Object.assign(body, { manage_stock: true, stock_quantity: Math.max(0, Math.floor(data.stock)) });
  if (data.price != null) body.regular_price = (Math.round(data.price * 100) / 100).toFixed(2);
  if (!Object.keys(body).length) return;
  await wc(acc, variationId ? `/products/${productId}/variations/${variationId}` : `/products/${productId}`, { method: 'PUT', body });
}

// ---------------------------------------------------------------------------
// Criação e edição de produtos
// ---------------------------------------------------------------------------
export function buildWooProduct(d: MkDraft) {
  const opts = variationOptions(d.variations);
  const common = { name: d.title, description: d.description, status: 'publish', weight: String(Math.round(d.weight * 1000) / 1000), dimensions: { length: String(d.length), width: String(d.width), height: String(d.height) }, images: d.images.filter((u) => /^https?:/.test(u)).map((src) => ({ src })) };
  if (!d.variations.length) return { ...common, type: 'simple', sku: d.sku, regular_price: money2(d.price).toFixed(2), manage_stock: true, stock_quantity: Math.max(0, Math.floor(d.quantity)), ...(d.gtin ? { meta_data: [{ key: '_gtin', value: d.gtin }] } : {}) };
  return { ...common, type: 'variable', sku: d.sku, attributes: opts.map((o, i) => ({ name: o.name, position: i, visible: true, variation: true, options: o.values })) };
}

export function buildWooVariations(d: MkDraft) {
  return {
    create: d.variations.map((v) => ({
      sku: v.sku, regular_price: money2(v.price).toFixed(2), manage_stock: true, stock_quantity: Math.max(0, Math.floor(v.quantity)),
      attributes: Object.entries(v.attributes).map(([name, option]) => ({ name, option })),
      ...(v.gtin ? { meta_data: [{ key: '_gtin', value: v.gtin }] } : {}),
    })),
  };
}

async function createListing(acc: AccountCtx, d: MkDraft): Promise<MkListing[]> {
  const p = (await wc(acc, '/products', { method: 'POST', body: buildWooProduct(d) })).data as any;
  if (!p?.id) throw new IntegrationError('WooCommerce: produto não criado');
  if (!d.variations.length) {
    const stock = num(p.stock_quantity);
    return [{ externalId: String(p.id), sku: str(p.sku) || d.sku, title: p.name, price: num(p.regular_price || p.price), stock, status: stock > 0 ? 'ATIVO' : 'SEM_ESTOQUE', permalink: str(p.permalink), listingType: 'Loja' }];
  }
  const batch = (await wc(acc, `/products/${p.id}/variations/batch`, { method: 'POST', body: buildWooVariations(d) })).data as any;
  const out: MkListing[] = [];
  for (const v of batch?.create || []) {
    // Itens recusados no lote voltam com { error: { message } }
    if (v.error || !v.id) throw new IntegrationError(`WooCommerce: variação recusada — ${v.error?.message || 'erro desconhecido'}`);
    const stock = num(v.stock_quantity);
    const values = (v.attributes || []).map((a: any) => a.option).join(' ');
    out.push({ externalId: joinExternal(p.id, v.id), sku: str(v.sku), title: `${p.name}${values ? ` - ${values}` : ''}`, price: num(v.regular_price || v.price), stock, status: stock > 0 ? 'ATIVO' : 'SEM_ESTOQUE', permalink: str(v.permalink) || str(p.permalink), listingType: 'Loja' });
  }
  return out;
}

async function editListing(acc: AccountCtx, externalId: string, data: { active?: boolean; title?: string }) {
  const [productId] = splitExternal(externalId);
  const body: Record<string, unknown> = {};
  if (data.active != null) body.status = data.active ? 'publish' : 'draft';
  if (data.title) body.name = data.title;
  if (Object.keys(body).length) await wc(acc, `/products/${productId}`, { method: 'PUT', body });
}

// ---------------------------------------------------------------------------
// NF-e: meta_data do pedido + nota interna
// ---------------------------------------------------------------------------
export function wooInvoiceMeta(inv: MkInvoice) {
  return {
    meta_data: [
      { key: '_nfe_chave', value: inv.accessKey },
      { key: '_nfe_numero', value: String(inv.number) },
      { key: '_nfe_serie', value: String(inv.series) },
      ...(inv.danfeUrl ? [{ key: '_nfe_url', value: inv.danfeUrl }] : []),
    ],
  };
}

async function uploadInvoice(acc: AccountCtx, ref: { externalId: string }, inv: MkInvoice) {
  await wc(acc, `/orders/${ref.externalId}`, { method: 'PUT', body: wooInvoiceMeta(inv) });
  await wc(acc, `/orders/${ref.externalId}/notes`, { method: 'POST', body: { note: `NF-e nº ${inv.number} série ${inv.series} emitida. Chave de acesso: ${inv.accessKey}`, customer_note: false } });
}

registerAdapter({ provider: P, fetchOrders, fetchListings, pushListing, createListing, editListing, uploadInvoice });

// ---------------------------------------------------------------------------
// Provedor
// ---------------------------------------------------------------------------
/** X-WC-Webhook-Signature = base64(HMAC-SHA256(segredo do webhook, corpo bruto)) */
export const verifyWooSignature = (secret: string, raw: string, header: string | null) => hmacMatches(secret, raw, header, 'base64');

registerProvider({
  key: P,
  name: 'WooCommerce',
  category: 'ECOMMERCE',
  color: '#7f54b3',
  description: 'Pedidos importados por webhook, estoque e preço de produtos e variações atualizados a cada alteração.',
  docsUrl: 'https://woocommerce.github.io/woocommerce-rest-api-docs/',
  auth: 'API_KEY',
  fields: [
    { key: 'storeUrl', label: 'URL da loja', required: true, placeholder: 'https://minhaloja.com.br' },
    { key: 'consumerKey', label: 'Consumer key', secret: true, required: true, help: 'WooCommerce → Configurações → Avançado → API REST (permissão Leitura/Escrita)' },
    { key: 'consumerSecret', label: 'Consumer secret', secret: true, required: true },
    { key: 'webhookSecret', label: 'Segredo do webhook', secret: true, help: 'Cadastre em WooCommerce → Avançado → Webhooks os tópicos "Pedido criado" e "Pedido atualizado" com a URL abaixo e este segredo' },
  ],
  capabilities: ['Importação de pedidos pagos (webhooks + verificação a cada 10 min)', 'Cancelamentos e conclusões refletidos no pedido', 'Criação de produtos simples e variáveis', 'NF-e no pedido (meta_data _nfe_chave/_nfe_numero + nota)', 'Vínculo de produtos e variações por SKU', 'Estoque e preço em tempo real'],
  test: async (acc) => {
    await wc(acc, '/products?per_page=1');
    const accountName = (() => {
      try {
        return new URL(storeBase(acc.settings.storeUrl)).host;
      } catch {
        return String(acc.settings.storeUrl);
      }
    })();
    await ensureChannelForAccount({ ...acc, accountName }, { force: true, accountName });
    return { accountName, externalAccountId: accountName, message: `Loja ${accountName} conectada` };
  },
  poll: { everyMinutes: 10, run: pollMarketplace },
  webhook: {
    verify: (acc, { headers, raw }) => {
      // O "ping" de criação do webhook (webhook_id=...) não é assinado
      if (/^webhook_id=\d+$/.test(raw.trim())) return true;
      return acc?.secrets.webhookSecret ? verifyWooSignature(acc.secrets.webhookSecret, raw, headers.get('x-wc-webhook-signature')) : true;
    },
    describe: (body) => ({ topic: body?.line_items ? 'order' : body?.webhook_id ? 'ping' : undefined, externalId: body?.id != null ? String(body.id) : undefined }),
    process: async (event, acc) => {
      const o = event.payload as any;
      if (!o?.id || !Array.isArray(o.line_items)) return 'Notificação sem pedido — ignorada';
      return ingestForAccount(acc, [mapWooOrder(o)]);
    },
  },
});
