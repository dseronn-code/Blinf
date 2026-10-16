/**
 * Shopify (Admin REST API 2024-07, app personalizado da loja): domínio + token de acesso.
 * Pedidos (webhook orders/create, orders/paid, orders/cancelled com HMAC + verificação periódica),
 * estoque por inventory_item_id da variante (inventory_levels/set) e preço da variante.
 */
import { registerProvider } from '../registry';
import { httpRequest, ensureOk, IntegrationError } from '../http';
import { updateAccount } from '../accounts';
import type { AccountCtx } from '../types';
import { registerAdapter, type MkListing, type MkOrder, type MkStatus, type MkAddress } from '@/server/services/marketplace/types';
import { num, str, cep, doc, toUf, fullName, splitStreet, joinExternal, splitExternal, hmacMatches } from '@/server/services/marketplace/mappers';
import { ensureChannelForAccount, ingestForAccount, pollMarketplace } from '@/server/services/marketplace/sync';

const P = 'SHOPIFY';
const VERSION = '2024-07';

export function shopDomain(v: unknown) {
  const d = String(v || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (!d) return '';
  return d.includes('.') ? d : `${d}.myshopify.com`;
}
const base = (acc: AccountCtx) => `https://${shopDomain(acc.settings.shopDomain)}/admin/api/${VERSION}`;

async function sh<T = any>(acc: AccountCtx, path: string, init: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}) {
  if (!shopDomain(acc.settings.shopDomain)) throw new IntegrationError('Shopify: informe o domínio da loja (minhaloja.myshopify.com)');
  const res = await httpRequest<T>({ provider: P, companyId: acc.companyId, url: path.startsWith('https://') ? path : `${base(acc)}${path}`, method: init.method, body: init.body, headers: { 'X-Shopify-Access-Token': acc.secrets.accessToken || '' } });
  ensureOk(res, 'Shopify');
  return res;
}

/** Paginação por cursor: Link: <...page_info=...>; rel="next" */
const nextLink = (h: Record<string, string>) => (h.link || h.Link || '').split(',').find((p) => /rel="next"/.test(p))?.match(/<([^>]+)>/)?.[1] || null;

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------
function addr(a: any): MkAddress | null {
  if (!a) return null;
  const st = splitStreet(a.address1);
  return { name: str(a.name) || fullName(a.first_name, a.last_name), phone: str(a.phone), zip: cep(a.zip), street: st.street, number: st.number, complement: st.complement, district: str(a.address2), city: str(a.city), uf: toUf(a.province_code || a.province) };
}

export function mapShopifyOrder(o: any): MkOrder {
  const cancelled = !!o.cancelled_at || ['refunded', 'voided'].includes(o.financial_status);
  const status: MkStatus = cancelled ? 'CANCELADO' : ['paid', 'partially_refunded'].includes(o.financial_status) ? 'PAGO' : 'PENDENTE';
  // CPF/CNPJ: atributos do checkout (note_attributes) ou campo "empresa" do endereço de cobrança (prática comum no Brasil)
  const attrs: Record<string, string> = {};
  for (const n of o.note_attributes || []) attrs[String(n.name).toLowerCase()] = n.value;
  const document = doc(attrs.cpf || attrs.cnpj || attrs['cpf/cnpj'] || attrs.documento) || doc(o.billing_address?.company) || doc(o.shipping_address?.company);
  const ship = addr(o.shipping_address);
  const bill = addr(o.billing_address);
  return {
    externalId: String(o.id),
    number: str(o.name) || (o.order_number ? `#${o.order_number}` : null),
    date: o.processed_at || o.created_at,
    status,
    shipStatus: o.fulfillment_status === 'fulfilled' ? 'ENVIADO' : null,
    buyer: { name: fullName(o.customer?.first_name, o.customer?.last_name) || bill?.name || ship?.name || 'Cliente Shopify', document, email: str(o.email || o.customer?.email), phone: str(o.phone || o.customer?.phone) || ship?.phone, address: bill?.street ? bill : ship },
    shipTo: ship || bill,
    items: (o.line_items || []).map((li: any) => ({ sku: str(li.sku), externalItemId: li.product_id ? String(li.product_id) : null, variationId: li.variant_id ? String(li.variant_id) : null, title: [li.title, li.variant_title].filter(Boolean).join(' - '), quantity: num(li.quantity), unitPrice: num(li.price) })),
    freight: (o.shipping_lines || []).reduce((a: number, s: any) => a + num(s.discounted_price ?? s.price), 0),
    discount: num(o.total_discounts),
    fee: null,
    paymentLabel: (o.payment_gateway_names || []).join(', ') || null,
    shippingService: str(o.shipping_lines?.[0]?.title),
    notes: str(o.note),
  };
}

async function fetchOrders(acc: AccountCtx, since: Date) {
  const out: MkOrder[] = [];
  let url: string | null = `/orders.json?status=any&updated_at_min=${encodeURIComponent(since.toISOString())}&limit=250`;
  for (let page = 0; url && page < 40; page++) {
    const res: any = await sh(acc, url);
    out.push(...(res.data?.orders || []).map(mapShopifyOrder));
    url = nextLink(res.headers);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Produtos / variantes
// ---------------------------------------------------------------------------
async function fetchListings(acc: AccountCtx) {
  const out: MkListing[] = [];
  const domain = shopDomain(acc.settings.publicDomain || acc.settings.shopDomain);
  let url: string | null = '/products.json?limit=250&fields=id,title,handle,status,variants';
  for (let page = 0; url && page < 100; page++) {
    const res: any = await sh(acc, url);
    for (const p of res.data?.products || []) {
      for (const v of p.variants || []) {
        const stock = num(v.inventory_quantity);
        out.push({
          // produto/variante/item de estoque (o estoque é gravado pelo inventory_item_id)
          externalId: joinExternal(p.id, v.id, v.inventory_item_id), sku: str(v.sku), title: `${p.title}${v.title && v.title !== 'Default Title' ? ` - ${v.title}` : ''}`, price: num(v.price), stock,
          status: p.status !== 'active' ? (p.status === 'archived' ? 'ENCERRADO' : 'PAUSADO') : stock > 0 ? 'ATIVO' : 'SEM_ESTOQUE', permalink: `https://${domain}/products/${p.handle}`, listingType: 'Loja',
        });
      }
    }
    url = nextLink(res.headers);
  }
  return out;
}

async function locationId(acc: AccountCtx) {
  if (acc.settings.locationId) return String(acc.settings.locationId);
  const res = await sh(acc, '/locations.json');
  const loc = (res.data?.locations || []).find((l: any) => l.active) || res.data?.locations?.[0];
  if (!loc) throw new IntegrationError('Shopify: nenhuma localização de estoque encontrada');
  await updateAccount(acc, { settings: { locationId: String(loc.id) } });
  return String(loc.id);
}

async function pushListing(acc: AccountCtx, externalId: string, data: { stock?: number; price?: number }) {
  const [, variantId, inventoryItemId] = splitExternal(externalId);
  if (!variantId) throw new IntegrationError('Shopify: anúncio sem variante — refaça o vínculo por SKU');
  if (data.stock != null) {
    if (!inventoryItemId) throw new IntegrationError('Shopify: variante sem item de estoque — refaça o vínculo por SKU');
    await sh(acc, '/inventory_levels/set.json', { method: 'POST', body: { location_id: Number(await locationId(acc)), inventory_item_id: Number(inventoryItemId), available: Math.max(0, Math.floor(data.stock)) } });
  }
  if (data.price != null) await sh(acc, `/variants/${variantId}.json`, { method: 'PUT', body: { variant: { id: Number(variantId), price: (Math.round(data.price * 100) / 100).toFixed(2) } } });
}

registerAdapter({ provider: P, fetchOrders, fetchListings, pushListing });

// ---------------------------------------------------------------------------
// Provedor
// ---------------------------------------------------------------------------
/** X-Shopify-Hmac-Sha256 = base64(HMAC-SHA256(segredo do app, corpo bruto)) */
export const verifyShopifyHmac = (secret: string, raw: string, header: string | null) => hmacMatches(secret, raw, header, 'base64');

registerProvider({
  key: P,
  name: 'Shopify',
  category: 'ECOMMERCE',
  color: '#95bf47',
  description: 'Pedidos importados por webhook, estoque e preço das variantes atualizados a cada alteração (app personalizado da loja).',
  docsUrl: 'https://shopify.dev/docs/api/admin-rest/2024-07',
  auth: 'API_KEY',
  fields: [
    { key: 'shopDomain', label: 'Domínio da loja', required: true, placeholder: 'minhaloja.myshopify.com' },
    { key: 'accessToken', label: 'Admin API access token', secret: true, required: true, help: 'Configurações → Apps → Desenvolver apps → crie um app com read/write de pedidos, produtos e estoque (shpat_…)' },
    { key: 'webhookSecret', label: 'Chave secreta do app (assinatura dos webhooks)', secret: true, help: 'Usada para conferir o X-Shopify-Hmac-Sha256. Cadastre os webhooks orders/create, orders/paid e orders/cancelled com a URL abaixo' },
    { key: 'locationId', label: 'ID da localização de estoque (opcional)', help: 'Em branco = primeira localização ativa' },
    { key: 'publicDomain', label: 'Domínio público da loja (opcional)', placeholder: 'www.minhaloja.com.br' },
  ],
  capabilities: ['Importação de pedidos pagos (webhooks + verificação a cada 10 min)', 'Cancelamentos e envios refletidos no pedido', 'Vínculo de variantes por SKU', 'Estoque (inventory_levels) e preço em tempo real'],
  test: async (acc) => {
    const res = await sh(acc, '/shop.json');
    const shop = res.data?.shop || {};
    const accountName = shop.name || shopDomain(acc.settings.shopDomain);
    await ensureChannelForAccount({ ...acc, accountName, externalAccountId: shop.id ? String(shop.id) : acc.externalAccountId }, { force: true, accountName });
    return { accountName, externalAccountId: shop.id ? String(shop.id) : undefined, message: `Loja ${accountName} (${shop.myshopify_domain || ''})` };
  },
  poll: { everyMinutes: 10, run: pollMarketplace },
  webhook: {
    // URL com o ID da conta + token; se a chave do app estiver salva, a assinatura também é exigida
    verify: (acc, { headers, raw }) => (acc?.secrets.webhookSecret ? verifyShopifyHmac(acc.secrets.webhookSecret, raw, headers.get('x-shopify-hmac-sha256')) : true),
    describe: (body) => ({ topic: body?.line_items ? (body.cancelled_at ? 'orders/cancelled' : 'orders') : undefined, externalId: body?.id != null ? String(body.id) : undefined }),
    process: async (event, acc) => {
      const o = event.payload as any;
      if (!o?.id || !Array.isArray(o.line_items)) return 'Notificação sem pedido — ignorada';
      return ingestForAccount(acc, [mapShopifyOrder(o)]);
    },
  },
});
