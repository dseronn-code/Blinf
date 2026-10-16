/**
 * Asaas — cobranças por boleto, Pix e cartão (fatura) com baixa automática.
 * Autenticação: chave de API no header `access_token`.
 * Webhook: o Asaas envia o "token de autenticação" configurado no header `asaas-access-token`.
 */
import crypto from 'crypto';
import { registerProvider } from '../registry';
import { httpRequest, ensureOk, IntegrationError } from '../http';
import { updateAccount } from '../accounts';
import type { AccountCtx } from '../types';
import { round2, onlyDigits } from '@/lib/utils';
import type { Gateway, ChargeRequest, ChargeResult, ProviderPayment, Payer } from '@/server/services/payments';
import { applyProviderPayment, syncOpenCharges } from '@/server/services/payments';

const base = (acc: AccountCtx) => (acc.environment === 'PRODUCAO' ? 'https://api.asaas.com/v3' : 'https://sandbox.asaas.com/api/v3');

async function call<T = any>(acc: AccountCtx, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  if (!acc.secrets.apiKey) throw new IntegrationError('Asaas: informe a chave de API');
  const res = await httpRequest<T>({ provider: 'ASAAS', companyId: acc.companyId, url: base(acc) + path, method, headers: { access_token: acc.secrets.apiKey }, body });
  return ensureOk(res, 'Asaas').data;
}

const ymd = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);

/** Linha digitável com a máscara padrão (47 dígitos) */
export function formatLine(line: string | null | undefined) {
  const d = onlyDigits(line);
  if (d.length !== 47) return line || null;
  return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d.slice(32, 33)} ${d.slice(33)}`;
}

/** Cliente no Asaas: reaproveita pelo CPF/CNPJ (cache no settings da conta) */
async function customerId(acc: AccountCtx, payer: Payer) {
  const doc = onlyDigits(payer.document);
  if (doc.length !== 11 && doc.length !== 14) throw new IntegrationError('Asaas: o cliente precisa de CPF/CNPJ no cadastro para registrar a cobrança');
  const map: Record<string, string> = acc.settings.customers || {};
  if (map[doc]) return map[doc];
  const found = await call(acc, 'GET', `/customers?cpfCnpj=${doc}`);
  let id: string | undefined = found?.data?.[0]?.id;
  if (!id) {
    const c = await call(acc, 'POST', '/customers', {
      name: payer.name, cpfCnpj: doc, email: payer.email || undefined, mobilePhone: onlyDigits(payer.phone) || undefined, postalCode: onlyDigits(payer.zip) || undefined,
      address: payer.street || undefined, addressNumber: payer.number || undefined, complement: payer.complement || undefined, province: payer.district || undefined, externalReference: payer.contactId || undefined,
    });
    id = c.id;
  }
  await updateAccount(acc, { settings: { customers: { ...map, [doc]: id } } });
  return id!;
}

const BILLING: Record<string, string> = { PIX: 'PIX', BOLETO: 'BOLETO', CARTAO: 'CREDIT_CARD', UNDEFINED: 'UNDEFINED' };
const METHOD: Record<string, string> = { PIX: 'PIX', BOLETO: 'BOLETO', CREDIT_CARD: 'CARTAO_CREDITO', DEBIT_CARD: 'CARTAO_DEBITO', UNDEFINED: 'BOLETO' };

export async function createAsaasCharge(acc: AccountCtx, req: ChargeRequest): Promise<ChargeResult> {
  const customer = await customerId(acc, req.payer);
  const billingType = BILLING[req.method] || 'UNDEFINED';
  const today = new Date();
  const fine = Number(acc.settings.finePercent) || 0;
  const interest = Number(acc.settings.interestPercent) || 0;
  const p = await call(acc, 'POST', '/payments', {
    customer, billingType, value: round2(req.amount), dueDate: ymd(req.dueDate < today ? today : req.dueDate), description: req.description.slice(0, 500), externalReference: req.entryId,
    ...(fine > 0 ? { fine: { value: fine } } : {}), ...(interest > 0 ? { interest: { value: interest } } : {}),
  });
  const r: ChargeResult = { ref: p.id, paymentUrl: p.invoiceUrl || p.bankSlipUrl || null, status: p.status, boletoNumber: p.nossoNumero || null };
  if (billingType === 'BOLETO' || billingType === 'UNDEFINED') {
    try {
      const f = await call(acc, 'GET', `/payments/${p.id}/identificationField`);
      Object.assign(r, { boletoLine: formatLine(f.identificationField), boletoBarcode: f.barCode || null, boletoNumber: f.nossoNumero || r.boletoNumber });
    } catch (e) {
      if (billingType === 'BOLETO') throw e;
    }
  }
  if (billingType === 'PIX' || billingType === 'UNDEFINED') {
    try {
      const q = await call(acc, 'GET', `/payments/${p.id}/pixQrCode`);
      Object.assign(r, { pixPayload: q.payload || null, pixImage: q.encodedImage ? `data:image/png;base64,${q.encodedImage}` : null });
    } catch (e) {
      // Conferir na documentação: o QR Pix exige chave Pix cadastrada na conta Asaas
      if (billingType === 'PIX') throw e;
    }
  }
  return r;
}

/** Situação Asaas → situação do ERP */
export function asaasPayment(p: any, event?: string): ProviderPayment {
  const status = p?.status as string;
  const ev = event || '';
  const st: ProviderPayment['status'] =
    ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED_IN_CASH'].includes(ev) || (!ev && ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(status)) ? 'PAGO'
    : ev === 'PAYMENT_REFUNDED' || (!ev && status === 'REFUNDED') ? 'ESTORNADO'
    : ev === 'PAYMENT_DELETED' || (!ev && p?.deleted) ? 'CANCELADO'
    : ev === 'PAYMENT_OVERDUE' ? 'VENCIDO' : 'PENDENTE';
  const date = p?.clientPaymentDate || p?.paymentDate || p?.confirmedDate;
  return { ref: p?.id, externalReference: p?.externalReference || null, status: st, gross: p?.value != null ? Number(p.value) : undefined, net: p?.netValue != null ? Number(p.netValue) : null, date: date ? new Date(`${String(date).slice(0, 10)}T12:00:00`) : null, method: METHOD[p?.billingType] || null };
}

export const asaasGateway: Gateway = {
  key: 'ASAAS',
  name: 'Asaas',
  create: createAsaasCharge,
  cancel: async (acc, ref) => {
    await call(acc, 'DELETE', `/payments/${ref}`);
  },
  refund: async (acc, ref, amount) => {
    await call(acc, 'POST', `/payments/${ref}/refund`, amount ? { value: round2(amount) } : {});
  },
  status: async (acc, ref) => asaasPayment(await call(acc, 'GET', `/payments/${ref}`)),
};

const safeEqual = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

registerProvider({
  key: 'ASAAS',
  name: 'Asaas',
  category: 'PAGAMENTO',
  description: 'Boletos, Pix e cartão registrados no Asaas, com baixa automática do contas a receber quando o pagamento cai.',
  color: '#0030b9',
  docsUrl: 'https://docs.asaas.com',
  auth: 'API_KEY',
  sandbox: true,
  fields: [
    { key: 'apiKey', label: 'Chave de API', secret: true, required: true, help: 'Asaas → Integrações → Chave de API. No ambiente de testes use a chave da conta sandbox ($aact_hmlg_...).' },
    { key: 'webhookToken', label: 'Token do webhook', help: 'Gerado ao salvar. Cadastre-o em Asaas → Integrações → Webhooks → "Token de autenticação", junto com a URL abaixo.' },
    { key: 'autoCharge', label: 'Emitir cobrança automaticamente ao faturar', type: 'switch', help: 'Registra no Asaas os recebíveis por boleto/Pix gerados pelas vendas, OS e loja virtual.' },
    { key: 'default', label: 'Provedor padrão de cobranças', type: 'switch', help: 'Se houver mais de um provedor conectado, usa este.' },
    { key: 'bankAccountName', label: 'Conta para as baixas', placeholder: 'Conta digital', help: 'Nome da conta bancária do GestãoPro que recebe os pagamentos (vazio = conta digital).' },
    { key: 'finePercent', label: 'Multa por atraso (%)', type: 'number' },
    { key: 'interestPercent', label: 'Juros ao mês (%)', type: 'number' },
  ],
  capabilities: ['Boleto registrado com linha digitável', 'Pix com QR Code dinâmico', 'Fatura com cartão de crédito', 'Baixa automática por webhook (valor líquido + tarifa)', 'Cancelamento e estorno'],
  test: async (acc) => {
    const bal = await call(acc, 'GET', '/finance/balance');
    let name: string | undefined;
    try {
      // Conferir na documentação: dados comerciais da conta (nome/razão social)
      const info = await call(acc, 'GET', '/myAccount/commercialInfo');
      name = info?.companyName || info?.name;
    } catch {}
    const patch: Record<string, unknown> = {};
    if (!acc.settings.webhookToken) patch.webhookToken = crypto.randomBytes(18).toString('hex');
    if (acc.settings.autoCharge === undefined) patch.autoCharge = true;
    if (Object.keys(patch).length) await updateAccount(acc, { settings: patch });
    return { accountName: name || 'Conta Asaas', message: `Saldo disponível: R$ ${Number(bal?.balance || 0).toFixed(2)}` };
  },
  poll: { everyMinutes: 30, run: async (acc) => (await syncOpenCharges(acc)) || undefined },
  webhook: {
    verify: (acc, req) => {
      const token = String(acc?.settings.webhookToken || '');
      return !token || safeEqual(req.headers.get('asaas-access-token') || '', token);
    },
    describe: (body) => ({ topic: body?.event, externalId: body?.payment?.id }),
    process: async (event, acc) => {
      const body = event.payload as any;
      if (!body?.payment?.id) return 'Notificação sem cobrança';
      const p = asaasPayment(body.payment, body.event);
      if (p.status === 'PENDENTE') return `Evento ${body.event} ignorado`;
      return applyProviderPayment(acc, p);
    },
  },
});
