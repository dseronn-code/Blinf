/**
 * Nuvemshop: OAuth com o app da plataforma (NUVEMSHOP_CLIENT_ID/NUVEMSHOP_CLIENT_SECRET),
 * pedidos (webhooks order/paid e order/cancelled + verificação periódica) e
 * estoque/preço por variante (SKU). Header "Authentication: bearer", User-Agent obrigatório.
 */
import { registerProvider } from '../registry';
import { httpRequest, ensureOk, IntegrationError } from '../http';
import { findAccountByExternalId, appUrl } from '../accounts';
import type { AccountCtx } from '../types';
import { registerAdapter, type MkListing, type MkOrder, type MkStatus, type MkAddress } from '@/server/services/marketplace/types';
import { num, str, cep, doc, toUf, fullName, joinExternal, splitExternal, hmacMatches } from '@/server/services/marketplace/mappers';
import { ensureChannelForAccount, ingestForAccount, pollMarketplace } from '@/server/services/marketplace/sync';

const P = 'NUVEMSHOP';
const API = 'https://api.nuvemshop.com.br/v1';
const clientId = (acc?: AccountCtx | null) => (acc?.settings.clientId as string) || process.env.NUVEMSHOP_CLIENT_ID || '';
const clientSecret = (acc?: AccountCtx | null) => acc?.secrets.clientSecret || process.env.NUVEMSHOP_CLIENT_SECRET || '';
const userAgent = () => `GestaoPro ERP (${process.env.NUVEMSHOP_CONTACT_EMAIL || 'suporte@gestaopro.com.br'})`;

async function ns<T = any>(acc: AccountCtx, path: string, init: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown; allow404?: boolean } = {}) {
  const res = await httpRequest<T>({ provider: P, companyId: acc.companyId, url: `${API}/${acc.externalAccountId}${path}`, method: init.method, body: init.body, headers: { Authentication: `bearer ${acc.secrets.accessToken}`, 'User-Agent': userAgent() } });
  if (init.allow404 && res.status === 404) return null;
  return ensureOk(res, 'Nuvemshop').data;
}

const pt = (v: any) => (typeof v === 'string' ? v : v?.pt || v?.es || (v ? Object.values(v)[0] : '') || '') as string;

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------
export function mapNuvemshopOrder(o: any): MkOrder {
  const cancelled = o.status === 'cancelled' || ['voided', 'refunded'].includes(o.payment_status);
  const status: MkStatus = cancelled ? 'CANCELADO' : o.payment_status === 'paid' ? 'PAGO' : 'PENDENTE';
  const s = o.shipping_address || {};
  const ship: MkAddress = { name: str(s.name), phone: str(s.phone), zip: cep(s.zipcode), street: str(s.address), number: str(s.number), complement: str(s.floor), district: str(s.locality), city: str(s.city), uf: toUf(s.province) };
  const billing: MkAddress = { name: str(o.billing_name), phone: str(o.billing_phone), zip: cep(o.billing_zipcode), street: str(o.billing_address), number: str(o.billing_number), complement: str(o.billing_floor), district: str(o.billing_locality), city: str(o.billing_city), uf: toUf(o.billing_province) };
  return {
    externalId: String(o.id),
    number: o.number != null ? `#${o.number}` : null,
    date: o.paid_at || o.created_at,
    status,
    shipStatus: ['shipped', 'fulfilled'].includes(o.shipping_status) ? 'ENVIADO' : null,
    buyer: { name: str(o.customer?.name) || fullName(o.billing_name) || ship.name || 'Cliente Nuvemshop', document: doc(o.contact_identification || o.customer?.identification), email: str(o.contact_email || o.customer?.email), phone: str(o.contact_phone || o.customer?.phone), address: billing.street ? billing : ship },
    shipTo: ship.street ? ship : billing,
    items: (o.products || []).map((p: any) => ({ sku: str(p.sku), externalItemId: String(p.product_id), variationId: p.variant_id ? String(p.variant_id) : null, title: pt(p.name), quantity: num(p.quantity), unitPrice: num(p.price) })),
    freight: num(o.shipping_cost_customer),
    // Conferir na documentação: "discount" é o desconto total (cupom + meio de pagamento)
    discount: num(o.discount) || num(o.discount_coupon) + num(o.discount_gateway),
    fee: null,
    paymentLabel: str(o.payment_details?.method) || str(o.gateway_name) || str(o.gateway),
    shippingService: str(o.shipping_option),
    carrier: str(o.shipping_carrier_name),
    notes: str(o.note),
  };
}

async function fetchOrders(acc: AccountCtx, since: Date) {
  const out: MkOrder[] = [];
  for (let page = 1; page <= 50; page++) {
    // 404 = página além da última
    const rows = await ns<any[]>(acc, `/orders?updated_at_min=${encodeURIComponent(since.toISOString())}&per_page=200&page=${page}`, { allow404: true });
    if (!rows?.length) break;
    out.push(...rows.map(mapNuvemshopOrder));
    if (rows.length < 200) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Produtos / variantes
// ---------------------------------------------------------------------------
async function fetchListings(acc: AccountCtx) {
  const out: MkListing[] = [];
  for (let page = 1; page <= 100; page++) {
    const rows = await ns<any[]>(acc, `/products?per_page=200&page=${page}`, { allow404: true });
    if (!rows?.length) break;
    for (const p of rows) {
      for (const v of p.variants || []) {
        // stock null = estoque infinito na Nuvemshop
        const stock = v.stock == null ? 0 : num(v.stock);
        const values = (v.values || []).map(pt).filter(Boolean).join(' ');
        out.push({
          externalId: joinExternal(p.id, v.id), sku: str(v.sku), title: `${pt(p.name)}${values ? ` - ${values}` : ''}`, price: num(v.promotional_price || v.price), stock,
          status: !p.published ? 'PAUSADO' : stock > 0 || v.stock == null ? 'ATIVO' : 'SEM_ESTOQUE', permalink: str(p.canonical_url), listingType: 'Loja',
        });
      }
    }
    if (rows.length < 200) break;
  }
  return out;
}

async function pushListing(acc: AccountCtx, externalId: string, data: { stock?: number; price?: number }) {
  const [productId, variantId] = splitExternal(externalId);
  if (!variantId) throw new IntegrationError('Nuvemshop: anúncio sem variante — refaça o vínculo por SKU');
  const body: Record<string, unknown> = {};
  if (data.stock != null) body.stock = Math.max(0, Math.floor(data.stock));
  if (data.price != null) body.price = (Math.round(data.price * 100) / 100).toFixed(2);
  if (Object.keys(body).length) await ns(acc, `/products/${productId}/variants/${variantId}`, { method: 'PUT', body });
}

registerAdapter({ provider: P, fetchOrders, fetchListings, pushListing });

// ---------------------------------------------------------------------------
// Provedor
// ---------------------------------------------------------------------------
const EVENTS = ['order/paid', 'order/cancelled', 'order/updated'];

/** Cadastra os webhooks da loja (idempotente) */
async function ensureWebhooks(acc: AccountCtx) {
  const url = `${appUrl()}/api/hooks/nuvemshop`;
  if (!/^https:\/\//.test(url)) return 'Webhooks não cadastrados: a URL pública precisa ser HTTPS (NEXTAUTH_URL)';
  const existing = ((await ns<any[]>(acc, '/webhooks')) || []).filter((w) => w.url === url).map((w) => w.event);
  for (const event of EVENTS) if (!existing.includes(event)) await ns(acc, '/webhooks', { method: 'POST', body: { event, url } });
  return null;
}

registerProvider({
  key: P,
  name: 'Nuvemshop',
  category: 'ECOMMERCE',
  color: '#2c3357',
  description: 'Pedidos pagos importados por webhook, estoque e preço das variantes atualizados a cada alteração.',
  docsUrl: 'https://tiendanube.github.io/api-documentation/',
  auth: 'OAUTH',
  fields: [
    { key: 'clientId', label: 'ID do app próprio (opcional)', help: 'Deixe em branco para usar o aplicativo da plataforma' },
    { key: 'clientSecret', label: 'Client Secret do app próprio (opcional)', secret: true },
  ],
  capabilities: ['Importação de pedidos pagos (webhooks order/paid + verificação a cada 10 min)', 'Cancelamentos refletidos no pedido', 'Vínculo de variantes por SKU', 'Estoque e preço em tempo real'],
  oauth: {
    appConfigured: () => !!(process.env.NUVEMSHOP_CLIENT_ID && process.env.NUVEMSHOP_CLIENT_SECRET),
    // A URL de retorno é a cadastrada no app (Portal de Parceiros); o state volta na query
    authorizeUrl: (acc, state) => `https://www.nuvemshop.com.br/apps/${clientId(acc)}/authorize?state=${state}`,
    exchange: async (acc, params) => {
      const code = params.get('code');
      if (!code) throw new IntegrationError('Nuvemshop: código de autorização ausente');
      const res = await httpRequest({ provider: P, companyId: acc.companyId, url: 'https://www.tiendanube.com/apps/authorize/token', method: 'POST', redactRequest: true, body: { client_id: clientId(acc), client_secret: clientSecret(acc), grant_type: 'authorization_code', code } });
      const d = ensureOk(res, 'Nuvemshop').data as any;
      if (!d?.access_token) throw new IntegrationError(`Nuvemshop: ${d?.error_description || d?.error || 'token não recebido'}`);
      // O token da Nuvemshop não expira; user_id é o ID da loja
      return { accessToken: d.access_token, externalAccountId: String(d.user_id) };
    },
  },
  test: async (acc) => {
    if (!acc.externalAccountId) throw new IntegrationError('Nuvemshop: loja não autorizada — clique em Conectar');
    const store = await ns(acc, '/store');
    const accountName = pt(store?.name) || `Loja ${acc.externalAccountId}`;
    await ensureChannelForAccount({ ...acc, accountName }, { force: true, accountName });
    const warn = await ensureWebhooks(acc).catch((e) => `Webhooks: ${(e as Error).message}`);
    return { accountName, externalAccountId: acc.externalAccountId, message: warn || `Loja ${accountName} conectada; webhooks cadastrados` };
  },
  poll: { everyMinutes: 10, run: pollMarketplace },
  webhook: {
    // x-linkedstore-hmac-sha256 = HMAC-SHA256 (hex) do corpo com o client secret do app
    verify: (acc, { headers, raw }) => hmacMatches(clientSecret(acc), raw, headers.get('x-linkedstore-hmac-sha256'), 'hex'),
    findAccount: (body) => (body?.store_id ? findAccountByExternalId(P, String(body.store_id)) : Promise.resolve(null)),
    describe: (body) => ({ topic: body?.event, externalId: body?.id != null ? String(body.id) : undefined }),
    process: async (event, acc) => {
      const b = event.payload as any;
      if (!String(b?.event || '').startsWith('order/') || !b.id) return `Evento ${b?.event} ignorado`;
      const o = await ns(acc, `/orders/${b.id}`);
      return ingestForAccount(acc, [mapNuvemshopOrder(o)]);
    },
  },
});
