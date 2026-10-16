/**
 * Mercado Pago — Pix e boleto pela API de pagamentos (/v1/payments) e cartão
 * pelo Checkout Pro (/checkout/preferences), com baixa automática por webhook.
 * Autenticação: Access Token (credenciais de teste começam com TEST-).
 * Webhook: valida o cabeçalho x-signature (HMAC-SHA256) quando a assinatura secreta é informada.
 */
import crypto from 'crypto';
import { registerProvider } from '../registry';
import { httpRequest, ensureOk, IntegrationError } from '../http';
import { updateAccount } from '../accounts';
import type { AccountCtx } from '../types';
import { round2, onlyDigits } from '@/lib/utils';
import type { Gateway, ChargeRequest, ChargeResult, ProviderPayment, Payer } from '@/server/services/payments';
import { applyProviderPayment, syncOpenCharges } from '@/server/services/payments';
import { formatLine } from './asaas';

const BASE = 'https://api.mercadopago.com';

async function call<T = any>(acc: AccountCtx, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, idempotent = false): Promise<T> {
  if (!acc.secrets.token) throw new IntegrationError('Mercado Pago: informe o Access Token');
  const res = await httpRequest<T>({
    provider: 'MERCADO_PAGO', companyId: acc.companyId, url: BASE + path, method, body,
    headers: { Authorization: `Bearer ${acc.secrets.token}`, ...(idempotent ? { 'X-Idempotency-Key': crypto.randomUUID() } : {}) },
  });
  return ensureOk(res, 'Mercado Pago').data;
}

const isTest = (acc: AccountCtx) => acc.environment === 'SANDBOX' || String(acc.secrets.token || '').startsWith('TEST-');

/** Fim do dia do vencimento no horário de Brasília (formato exigido: yyyy-MM-ddTHH:mm:ss.SSS-03:00) */
function expiration(due: Date, minDays: number) {
  const min = new Date(Date.now() + minDays * 86400_000);
  const d = due < min ? min : due;
  return `${new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10)}T23:59:59.000-03:00`;
}

function payerOf(p: Payer, full: boolean) {
  const doc = onlyDigits(p.document);
  const [first, ...rest] = (p.name || 'Cliente').trim().split(/\s+/);
  if (!p.email) throw new IntegrationError('Mercado Pago: o cliente precisa de e-mail no cadastro');
  const payer: any = { email: p.email, first_name: first, last_name: rest.join(' ') || first };
  if (doc) payer.identification = { type: doc.length === 14 ? 'CNPJ' : 'CPF', number: doc };
  if (full) {
    if (!doc) throw new IntegrationError('Mercado Pago: o boleto exige CPF/CNPJ do cliente');
    if (!p.zip || !p.street || !p.city || !p.uf) throw new IntegrationError('Mercado Pago: o boleto exige o endereço completo do cliente');
    payer.address = { zip_code: onlyDigits(p.zip), street_name: p.street, street_number: p.number || 'S/N', neighborhood: p.district || '', city: p.city, federal_unit: p.uf };
  }
  return payer;
}

export async function createMpCharge(acc: AccountCtx, req: ChargeRequest): Promise<ChargeResult> {
  const common = { external_reference: req.entryId, ...(req.notificationUrl ? { notification_url: req.notificationUrl } : {}) };
  if (req.method === 'CARTAO' || req.method === 'UNDEFINED') {
    // Checkout Pro: o cliente paga na página do Mercado Pago (cartão, Pix, boleto, saldo)
    const back = req.backUrl || undefined;
    const pref = await call(acc, 'POST', '/checkout/preferences', {
      items: [{ id: req.entryId, title: req.description.slice(0, 250), quantity: 1, unit_price: round2(req.amount), currency_id: 'BRL' }],
      payer: req.payer.email ? { name: req.payer.name, email: req.payer.email } : undefined,
      ...common,
      ...(back && back.startsWith('https://') ? { back_urls: { success: back, pending: back, failure: back }, auto_return: 'approved' } : back ? { back_urls: { success: back, pending: back, failure: back } } : {}),
    });
    return { ref: `pref-${pref.id}`, paymentUrl: (isTest(acc) && pref.sandbox_init_point) || pref.init_point, status: 'pending' };
  }
  const boleto = req.method === 'BOLETO';
  const p = await call(acc, 'POST', '/v1/payments', {
    transaction_amount: round2(req.amount), description: req.description.slice(0, 250), payment_method_id: boleto ? 'bolbradesco' : 'pix',
    payer: payerOf(req.payer, boleto), date_of_expiration: expiration(req.dueDate, boleto ? 1 : 0.05), ...common,
  }, true);
  if (boleto) {
    const td = p.transaction_details || {};
    // Conferir na documentação: linha digitável em transaction_details.digitable_line; código de barras em barcode.content
    return { ref: String(p.id), status: p.status, paymentUrl: td.external_resource_url || null, boletoLine: formatLine(td.digitable_line || p.barcode?.content) || null, boletoBarcode: p.barcode?.content || null };
  }
  const t = p.point_of_interaction?.transaction_data || {};
  return { ref: String(p.id), status: p.status, pixPayload: t.qr_code || null, pixImage: t.qr_code_base64 ? `data:image/png;base64,${t.qr_code_base64}` : null, paymentUrl: t.ticket_url || null };
}

const METHOD: Record<string, string> = { bank_transfer: 'PIX', ticket: 'BOLETO', credit_card: 'CARTAO_CREDITO', debit_card: 'CARTAO_DEBITO', account_money: 'TRANSFERENCIA' };

/** Pagamento do Mercado Pago → situação do ERP */
export function mpPayment(p: any): ProviderPayment {
  const s = p?.status;
  const status: ProviderPayment['status'] = s === 'approved' ? 'PAGO' : s === 'refunded' || s === 'charged_back' ? 'ESTORNADO' : s === 'cancelled' ? 'CANCELADO' : 'PENDENTE';
  const net = p?.transaction_details?.net_received_amount;
  return { ref: String(p?.id), externalReference: p?.external_reference || null, status, gross: p?.transaction_amount != null ? Number(p.transaction_amount) : undefined, net: net != null ? Number(net) : null, date: p?.date_approved ? new Date(p.date_approved) : null, method: METHOD[p?.payment_type_id] || null };
}

/** Pagamento aprovado de uma preferência (busca pela referência externa) */
async function searchByReference(acc: AccountCtx, externalReference: string) {
  const r = await call(acc, 'GET', `/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}&sort=date_created&criteria=desc`);
  const rows: any[] = r?.results || [];
  return rows.find((x) => x.status === 'approved') || rows[0] || null;
}

/**
 * Valida o x-signature do webhook: "ts=<ts>,v1=<hmac>" onde hmac = HMAC-SHA256(secret,
 * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"). Partes ausentes saem do manifesto.
 */
export function verifyMpSignature(secret: string, p: { signature: string | null; requestId: string | null; dataId: string | null }) {
  if (!p.signature) return false;
  const parts = Object.fromEntries(p.signature.split(',').map((kv) => kv.trim().split('=').map((s) => s.trim()) as [string, string]));
  if (!parts.ts || !parts.v1) return false;
  const id = p.dataId ? (/^[a-z0-9]+$/i.test(p.dataId) ? p.dataId.toLowerCase() : p.dataId) : '';
  const manifest = `${id ? `id:${id};` : ''}${p.requestId ? `request-id:${p.requestId};` : ''}ts:${parts.ts};`;
  const good = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return good.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(good), Buffer.from(parts.v1));
}

export const mercadoPagoGateway: Gateway = {
  key: 'MERCADO_PAGO',
  name: 'Mercado Pago',
  create: createMpCharge,
  cancel: async (acc, ref) => {
    // Preferência do Checkout Pro não tem cobrança pendente a cancelar
    if (ref.startsWith('pref-')) return;
    await call(acc, 'PUT', `/v1/payments/${ref}`, { status: 'cancelled' });
  },
  refund: async (acc, ref, amount, externalReference) => {
    let id = ref;
    if (ref.startsWith('pref-')) {
      const p = externalReference ? await searchByReference(acc, externalReference) : null;
      if (!p || p.status !== 'approved') throw new IntegrationError('Mercado Pago: pagamento aprovado não encontrado para esta cobrança');
      id = String(p.id);
    }
    await call(acc, 'POST', `/v1/payments/${id}/refunds`, amount ? { amount: round2(amount) } : {}, true);
  },
  status: async (acc, ref, externalReference) => {
    const p = ref.startsWith('pref-') ? await searchByReference(acc, externalReference) : await call(acc, 'GET', `/v1/payments/${ref}`);
    return p ? mpPayment(p) : null;
  },
};

registerProvider({
  key: 'MERCADO_PAGO',
  name: 'Mercado Pago',
  category: 'PAGAMENTO',
  description: 'Pix e boleto pela API do Mercado Pago e cartão pelo Checkout Pro, com baixa automática do contas a receber.',
  color: '#00b1ea',
  docsUrl: 'https://www.mercadopago.com.br/developers/pt/docs',
  auth: 'API_KEY',
  sandbox: true,
  fields: [
    { key: 'token', label: 'Access Token', secret: true, required: true, help: 'Suas integrações → aplicação → Credenciais de produção (APP_USR-...) ou de teste (TEST-...).' },
    { key: 'webhookSecret', label: 'Assinatura secreta do webhook', secret: true, help: 'Suas integrações → Webhooks → "Assinatura secreta". Com ela, cada notificação tem o x-signature conferido.' },
    { key: 'autoCharge', label: 'Emitir cobrança automaticamente ao faturar', type: 'switch', help: 'Registra no Mercado Pago os recebíveis por boleto/Pix gerados pelas vendas, OS e loja virtual.' },
    { key: 'default', label: 'Provedor padrão de cobranças', type: 'switch', help: 'Se houver mais de um provedor conectado, usa este.' },
    { key: 'bankAccountName', label: 'Conta para as baixas', placeholder: 'Conta digital', help: 'Nome da conta bancária do GestãoPro que recebe os pagamentos (vazio = conta digital).' },
  ],
  capabilities: ['Pix com QR Code', 'Boleto (Bradesco) com linha digitável', 'Cartão pelo Checkout Pro', 'Baixa automática por webhook (valor líquido + tarifa)', 'Cancelamento e estorno'],
  test: async (acc) => {
    const me = await call(acc, 'GET', '/users/me');
    if (acc.settings.autoCharge === undefined) await updateAccount(acc, { settings: { autoCharge: true } });
    return { accountName: me?.nickname || me?.email || 'Conta Mercado Pago', externalAccountId: me?.id != null ? String(me.id) : undefined, message: isTest(acc) ? 'Credenciais de teste' : undefined };
  },
  poll: { everyMinutes: 30, run: async (acc) => (await syncOpenCharges(acc)) || undefined },
  webhook: {
    verify: (acc, req) => {
      const secret = acc?.secrets.webhookSecret;
      if (!secret) return true;
      let dataId = req.query.get('data.id');
      if (!dataId) {
        try {
          dataId = JSON.parse(req.raw)?.data?.id?.toString() || null;
        } catch {}
      }
      return verifyMpSignature(secret, { signature: req.headers.get('x-signature'), requestId: req.headers.get('x-request-id'), dataId });
    },
    describe: (body) => ({ topic: body?.type || body?.topic || body?.action, externalId: body?.data?.id != null ? String(body.data.id) : body?.id != null ? String(body.id) : undefined }),
    process: async (event, acc) => {
      const body = event.payload as any;
      const type = body?.type || body?.topic;
      // Webhooks (type=payment, data.id) e IPN antigo (topic=payment, id)
      const id = body?.data?.id ?? (type === 'payment' ? body?.id || body?.resource : null);
      if (type !== 'payment' || !id) return `Notificação ${type || '?'} ignorada`;
      const p = await call(acc, 'GET', `/v1/payments/${String(id).split('/').pop()}`);
      const info = mpPayment(p);
      if (info.status === 'PENDENTE') return `Pagamento ${p?.status} — aguardando`;
      return applyProviderPayment(acc, info);
    },
  },
});
