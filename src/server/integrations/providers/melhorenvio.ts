/**
 * Melhor Envio — cotação multi-transportadora, compra de etiquetas e rastreio.
 * Autenticação: token pessoal gerado no painel (Configurações → Tokens) ou
 * OAuth do aplicativo da plataforma (MELHORENVIO_CLIENT_ID/SECRET).
 * Docs: https://docs.melhorenvio.com.br
 */
import crypto from 'crypto';
import { registerProvider } from '../registry';
import { httpRequest, ensureOk, IntegrationError } from '../http';
import type { AccountCtx, TokenResult } from '../types';

const P = 'MELHOR_ENVIO';
export const meBase = (acc: Pick<AccountCtx, 'environment'>) => (acc.environment === 'PRODUCAO' ? 'https://melhorenvio.com.br' : 'https://sandbox.melhorenvio.com.br');
const token = (acc: AccountCtx) => acc.secrets.token || acc.secrets.accessToken;
const appId = (acc: AccountCtx) => (acc.settings.clientId as string) || process.env.MELHORENVIO_CLIENT_ID || '';
const appSecret = (acc: AccountCtx) => acc.secrets.clientSecret || process.env.MELHORENVIO_CLIENT_SECRET || '';

/** O Melhor Envio exige User-Agent no formato "Aplicação (e-mail de contato técnico)" */
function headers(acc: AccountCtx) {
  const t = token(acc);
  if (!t) throw new IntegrationError('Melhor Envio: informe o token de acesso (ou conecte via OAuth)');
  return { Authorization: `Bearer ${t}`, 'User-Agent': `${acc.settings.appName || 'GestaoPro'} (${acc.settings.email || process.env.MELHORENVIO_EMAIL || 'contato@gestaopro.com.br'})` };
}

async function me<T = any>(acc: AccountCtx, path: string, body?: unknown, method?: 'GET' | 'POST' | 'DELETE') {
  const res = await httpRequest<T>({ provider: P, companyId: acc.companyId, url: `${meBase(acc)}${path}`, method: method || (body !== undefined ? 'POST' : 'GET'), headers: headers(acc), body });
  return ensureOk(res, 'Melhor Envio').data;
}

// ---------------------------------------------------------------------------
// Cotação
// ---------------------------------------------------------------------------
export type QuotePackage = { fromZip: string; toZip: string; weight: number; height?: number; width?: number; length?: number; value?: number };
export type RealFreightOption = { provider: string; carrier: string; service: string; price: number; deadlineDays: number; simulated: false; serviceId: string };

/** Converte a resposta de /shipment/calculate em opções de frete (ignora serviços indisponíveis) */
export function mapMeQuote(rows: any[]): RealFreightOption[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => !r.error && (r.custom_price ?? r.price) != null)
    .map((r) => ({
      provider: P, carrier: r.company?.name || 'Melhor Envio', service: r.name, serviceId: String(r.id), simulated: false as const,
      price: Math.round(Number(r.custom_price ?? r.price) * 100) / 100,
      deadlineDays: Number(r.custom_delivery_time ?? r.delivery_time ?? r.delivery_range?.max ?? 0),
    }));
}

export async function meQuote(acc: AccountCtx, p: QuotePackage) {
  const rows = await me<any[]>(acc, '/api/v2/me/shipment/calculate', {
    from: { postal_code: p.fromZip.replace(/\D/g, '') },
    to: { postal_code: p.toZip.replace(/\D/g, '') },
    package: { height: Math.max(2, Math.round(p.height || 10)), width: Math.max(11, Math.round(p.width || 15)), length: Math.max(16, Math.round(p.length || 20)), weight: Math.max(0.1, p.weight || 0.3) },
    options: { insurance_value: Math.round((p.value || 0) * 100) / 100, receipt: !!acc.settings.receipt, own_hand: !!acc.settings.ownHand },
    ...(acc.settings.services ? { services: String(acc.settings.services) } : {}),
  });
  return mapMeQuote(rows);
}

// ---------------------------------------------------------------------------
// Compra de etiqueta: carrinho → checkout (débito do saldo) → gerar → imprimir
// ---------------------------------------------------------------------------
export type ShipParty = { name: string; phone?: string | null; email?: string | null; document?: string | null; ie?: string | null; street?: string | null; number?: string | null; complement?: string | null; district?: string | null; city?: string | null; uf?: string | null; zip?: string | null };
export type ShipPurchase = {
  serviceId: string;
  from: ShipParty;
  to: ShipParty;
  products: { name: string; quantity: number; unitValue: number }[];
  /** count = quantidade de volumes (peso dividido igualmente) */
  volume: { weight: number; height: number; width: number; length: number; count?: number };
  value: number;
  invoiceKey?: string | null;
  invoiceNumber?: number | null;
  orderNumber?: number | string;
};
export type PurchaseResult = { providerRef: string; trackingCode: string | null; labelUrl: string | null; price?: number; status: string };

const digits = (s?: string | null) => (s || '').replace(/\D/g, '');
function meParty(p: ShipParty, company = false) {
  const doc = digits(p.document);
  return {
    name: p.name, phone: digits(p.phone), email: p.email || undefined,
    ...(doc.length === 14 ? { company_document: doc, ...(company || p.ie ? { state_register: p.ie || undefined } : {}) } : { document: doc }),
    address: p.street, complement: p.complement || undefined, number: p.number || 'S/N', district: p.district, city: p.city, state_abbr: p.uf, country_id: 'BR', postal_code: digits(p.zip),
  };
}

/** Corpo do POST /api/v2/me/cart */
export function meCartBody(acc: Pick<AccountCtx, 'settings'>, p: ShipPurchase) {
  const n = Math.max(1, Math.floor(p.volume.count || 1));
  return {
    service: Number(p.serviceId),
    // Jadlog, Azul Cargo e Latam exigem agência de postagem — Conferir na documentação: lista em /api/v2/me/shipment/agencies
    ...(acc.settings.agency ? { agency: Number(acc.settings.agency) } : {}),
    from: meParty(p.from, true),
    to: meParty(p.to),
    products: p.products.map((i) => ({ name: i.name.slice(0, 100), quantity: i.quantity, unitary_value: Math.round(i.unitValue * 100) / 100 })),
    // Conferir na documentação: Correios aceitam um volume por etiqueta; transportadoras (Jadlog etc.) aceitam vários
    volumes: Array.from({ length: n }, () => ({ height: Math.max(2, Math.round(p.volume.height)), width: Math.max(11, Math.round(p.volume.width)), length: Math.max(16, Math.round(p.volume.length)), weight: Math.max(0.1, Math.round((p.volume.weight / n) * 1000) / 1000) })),
    options: {
      insurance_value: Math.round(p.value * 100) / 100, receipt: !!acc.settings.receipt, own_hand: !!acc.settings.ownHand, reverse: false, non_commercial: !p.invoiceKey,
      ...(p.invoiceKey ? { invoice: { key: p.invoiceKey } } : {}), platform: 'GestãoPro', ...(p.orderNumber ? { tags: [{ tag: String(p.orderNumber), url: null }] } : {}),
    },
  };
}

export async function meBuyLabel(acc: AccountCtx, p: ShipPurchase): Promise<PurchaseResult> {
  const cart = await me(acc, '/api/v2/me/cart', meCartBody(acc, p));
  const id = String(cart.id);
  await me(acc, '/api/v2/me/shipment/checkout', { orders: [id] });
  await me(acc, '/api/v2/me/shipment/generate', { orders: [id] });
  const print = await me(acc, '/api/v2/me/shipment/print', { mode: 'public', orders: [id] });
  const tr = await meTracking(acc, [id]).catch(() => ({}) as Record<string, MeTracking>);
  return { providerRef: id, trackingCode: tr[id]?.tracking || cart.tracking || cart.protocol || null, labelUrl: print?.url || null, price: cart.price != null ? Number(cart.price) : undefined, status: tr[id]?.status || 'released' };
}

/** Cancela a etiqueta (estorna o saldo quando ainda não postada) */
export async function meCancel(acc: AccountCtx, id: string) {
  return me(acc, '/api/v2/me/shipment/cancel', { order: { id, reason_id: '2', description: 'Cancelado pelo ERP' } });
}

// ---------------------------------------------------------------------------
// Rastreio
// ---------------------------------------------------------------------------
export type MeTracking = { status: string; tracking: string | null; postedAt?: string | null; deliveredAt?: string | null };
export async function meTracking(acc: AccountCtx, ids: string[]): Promise<Record<string, MeTracking>> {
  const r = await me<Record<string, any>>(acc, '/api/v2/me/shipment/tracking', { orders: ids });
  const out: Record<string, MeTracking> = {};
  for (const [id, v] of Object.entries(r || {})) out[id] = { status: v.status, tracking: v.tracking || v.melhorenvio_tracking || null, postedAt: v.posted_at, deliveredAt: v.delivered_at };
  return out;
}

/** Status do Melhor Envio → status do envio no GestãoPro */
export function meStatus(s: string | null | undefined): string | null {
  switch (s) {
    case 'posted': return 'POSTADO';
    case 'delivered': return 'ENTREGUE';
    case 'canceled': case 'cancelled': return 'CANCELADO';
    case 'undelivered': return 'EM_TRANSITO';
    default: return null; // pending, released, generated → etiqueta aguardando postagem
  }
}

async function syncCompany(acc: AccountCtx) {
  const { syncProviderTracking } = await import('@/server/services/logistics');
  return syncProviderTracking(acc.companyId, P);
}

// ---------------------------------------------------------------------------
// OAuth (opcional — app da plataforma)
// ---------------------------------------------------------------------------
const SCOPES = 'cart-read cart-write companies-read companies-write coupons-read coupons-write notifications-read orders-read products-read products-write purchases-read shipping-calculate shipping-cancel shipping-checkout shipping-companies shipping-generate shipping-preview shipping-print shipping-share shipping-tracking ecommerce-shipping transactions-read users-read users-write webhooks-read webhooks-write';

async function tokenCall(acc: AccountCtx, form: Record<string, string>): Promise<TokenResult> {
  const res = await httpRequest({ provider: P, companyId: acc.companyId, url: `${meBase(acc)}/oauth/token`, body: { ...form, client_id: appId(acc), client_secret: appSecret(acc) }, headers: { 'User-Agent': `GestaoPro (${acc.settings.email || 'contato@gestaopro.com.br'})` }, redactRequest: true });
  const d = ensureOk(res, 'Melhor Envio').data;
  return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: d.expires_in };
}

registerProvider({
  key: P,
  name: 'Melhor Envio',
  category: 'LOGISTICA',
  color: '#0550a0',
  description: 'Cotação com Correios, Jadlog, Loggi, J&T, Azul Cargo e outras com o seu contrato; compra e impressão de etiquetas e rastreio automático.',
  docsUrl: 'https://docs.melhorenvio.com.br',
  auth: 'API_KEY',
  sandbox: true,
  fields: [
    { key: 'token', label: 'Token de acesso', secret: true, type: 'textarea', help: 'Painel do Melhor Envio → Gerenciar → Tokens → Novo token (marque todas as permissões de envio). Use um token do sandbox enquanto estiver em testes. Alternativa: conectar via OAuth em /api/integration-accounts/melhor_envio/connect.' },
    { key: 'email', label: 'E-mail técnico (User-Agent)', required: true, help: 'O Melhor Envio exige um e-mail de contato técnico no cabeçalho das chamadas.' },
    { key: 'agency', label: 'Agência de postagem (Jadlog/Azul/Latam)', type: 'number', help: 'ID da agência — necessário para transportadoras que exigem postagem em agência própria.' },
    { key: 'services', label: 'Serviços cotados', placeholder: '1,2,3,4,17', help: 'IDs de serviços separados por vírgula (vazio = todos os habilitados na sua conta).' },
    { key: 'autoBuy', label: 'Comprar etiqueta automaticamente ao faturar', type: 'switch', help: 'Desligado: o envio fica "aguardando compra" e a etiqueta é comprada em Logística → Envios.' },
    { key: 'rebuyOnVolumes', label: 'Recomprar etiqueta ao alterar volumes', type: 'switch', help: 'Ligado: alterar volumes/peso de um envio com etiqueta já comprada cancela a etiqueta e compra outra automaticamente. Desligado: o sistema pede para cancelar e comprar novamente.' },
    { key: 'receipt', label: 'Aviso de recebimento (AR)', type: 'switch' },
    { key: 'ownHand', label: 'Mão própria', type: 'switch' },
    { key: 'webhookSecret', label: 'Segredo do webhook (app)', secret: true, help: 'Opcional: secret do aplicativo para validar X-ME-Signature das notificações de rastreio.' },
  ],
  capabilities: ['Cotação de frete real com as transportadoras do seu contrato', 'Compra da etiqueta com a chave da NF-e (débito do saldo)', 'PDF oficial da etiqueta em Logística → Envios', 'Rastreio automático a cada 30 minutos e por webhook'],
  oauth: {
    appConfigured: () => !!(process.env.MELHORENVIO_CLIENT_ID && process.env.MELHORENVIO_CLIENT_SECRET),
    authorizeUrl: (acc, state, redirectUri) => `${meBase(acc)}/oauth/authorize?${new URLSearchParams({ client_id: appId(acc), redirect_uri: redirectUri, response_type: 'code', state, scope: SCOPES })}`,
    exchange: (acc, params, redirectUri) => tokenCall(acc, { grant_type: 'authorization_code', code: params.get('code') || '', redirect_uri: redirectUri }),
    refresh: (acc) => tokenCall(acc, { grant_type: 'refresh_token', refresh_token: acc.secrets.refreshToken || '' }),
  },
  test: async (acc) => {
    const u = await me(acc, '/api/v2/me');
    const balance = await me(acc, '/api/v2/me/balance').catch(() => null);
    return { accountName: [u.firstname, u.lastname].filter(Boolean).join(' ') || u.email, externalAccountId: String(u.id), message: balance?.balance != null ? `Saldo: R$ ${Number(balance.balance).toFixed(2)}` : undefined };
  },
  poll: { everyMinutes: 30, run: syncCompany },
  webhook: {
    // Notificações do app: X-ME-Signature = base64(HMAC-SHA256(corpo, secret do app)) — Conferir na documentação: "Webhooks"
    verify: (acc, req) => {
      const secret = acc?.secrets.webhookSecret || (acc ? appSecret(acc) : '');
      const sig = req.headers.get('x-me-signature');
      if (!secret || !sig) return !!acc; // sem segredo: vale o token da URL
      const expected = crypto.createHmac('sha256', secret).update(req.raw).digest('base64');
      return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    },
    describe: (b) => ({ topic: b?.event, externalId: b?.data?.id }),
    process: async (ev, acc) => {
      const b = ev.payload as any;
      const id = b?.data?.id;
      if (!id) return 'Notificação sem pedido';
      const { applyProviderTracking } = await import('@/server/services/logistics');
      return applyProviderTracking(acc.companyId, P, String(id), { status: meStatus(b.data.status || String(b.event || '').replace('order.', '')), trackingCode: b.data.tracking || null, events: [] });
    },
  },
});
