/**
 * Cobranças reais (boleto, Pix e cartão) via Asaas ou Mercado Pago — como as
 * integrações de cobrança do Bling: a empresa conecta a conta, o sistema
 * registra a cobrança no provedor, envia ao cliente e dá baixa sozinho quando
 * o pagamento cai (webhook ou sincronização periódica).
 * Sem conta conectada: cobrança simulada (billingData) só no modo demonstração;
 * em produção apenas o Pix estático da chave cadastrada (baixa manual).
 */
import type { FinancialEntry } from '@prisma/client';
import { prisma } from '@/lib/db';
import { round2, onlyDigits } from '@/lib/utils';
import { fail } from '../errors';
import { firstAccount, getAccount, appUrl, webhookUrl } from '../integrations/accounts';
import type { AccountCtx } from '../integrations/types';
import { asaasGateway } from '../integrations/providers/asaas';
import { mercadoPagoGateway } from '../integrations/providers/mercadopago';
import { billingData, defaultBankAccount, payEntry, createEntries, realPixKey, PAYMENT_HOWTO } from './finance';
import { isDemoMode, requireRealOrDemo } from '@/lib/demo';
import { notify } from './notify';
import { registerJob, enqueue } from './jobs';

export const PAYMENT_PROVIDERS = ['ASAAS', 'MERCADO_PAGO'];

/** PIX | BOLETO | CARTAO | UNDEFINED (o cliente escolhe na fatura do provedor) */
export type ChargeMethod = 'PIX' | 'BOLETO' | 'CARTAO' | 'UNDEFINED';

export type Payer = {
  contactId?: string | null;
  name: string;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  zip?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  uf?: string | null;
};

export type ChargeRequest = {
  entryId: string;
  description: string;
  amount: number;
  dueDate: Date;
  method: ChargeMethod;
  payer: Payer;
  /** URL pública do webhook (só enviada ao provedor quando for HTTPS) */
  notificationUrl?: string | null;
  /** retorno do checkout (Checkout Pro) */
  backUrl?: string | null;
};

export type ChargeResult = {
  ref: string;
  paymentUrl?: string | null;
  boletoLine?: string | null;
  boletoBarcode?: string | null;
  boletoNumber?: string | null;
  pixPayload?: string | null;
  pixImage?: string | null;
  status?: string;
};

export type Gateway = {
  key: string;
  name: string;
  create: (acc: AccountCtx, req: ChargeRequest) => Promise<ChargeResult>;
  cancel: (acc: AccountCtx, ref: string) => Promise<void>;
  refund: (acc: AccountCtx, ref: string, amount?: number, externalReference?: string) => Promise<void>;
  /** consulta a situação de uma cobrança (sincronização sem webhook) */
  status?: (acc: AccountCtx, ref: string, externalReference: string) => Promise<ProviderPayment | null>;
};

/** Pagamento informado pelo provedor (webhook/consulta) */
export type ProviderPayment = { ref: string; externalReference?: string | null; status: 'PAGO' | 'ESTORNADO' | 'CANCELADO' | 'VENCIDO' | 'PENDENTE'; gross?: number; net?: number | null; date?: Date | null; method?: string | null };

// Resolvido na chamada (os provedores importam este módulo — ciclo de importação)
export const gatewayFor = (key: string | null | undefined): Gateway | undefined => (key === 'ASAAS' ? asaasGateway : key === 'MERCADO_PAGO' ? mercadoPagoGateway : undefined);

/** Conta de cobrança conectada (respeita "provedor padrão"); null → simulado */
export async function paymentAccount(companyId: string) {
  try {
    return await firstAccount(companyId, PAYMENT_PROVIDERS);
  } catch {
    return null;
  }
}

export function methodFromPayment(paymentMethod: string | null | undefined): ChargeMethod {
  if (paymentMethod === 'PIX') return 'PIX';
  if (paymentMethod?.startsWith('CARTAO')) return 'CARTAO';
  if (paymentMethod === 'LINK') return 'UNDEFINED';
  return 'BOLETO';
}

async function payerOf(entry: FinancialEntry): Promise<Payer> {
  const c = entry.contactId ? await prisma.contact.findUnique({ where: { id: entry.contactId } }) : null;
  if (!c) return { name: entry.contactName || 'Cliente' };
  return { contactId: c.id, name: c.name, document: onlyDigits(c.document), email: c.email, phone: c.mobile || c.phone, zip: onlyDigits(c.zip), street: c.street, number: c.number, complement: c.complement, district: c.district, city: c.city, uf: c.uf };
}

/** A cobrança atual do título já atende ao meio pedido? */
function covers(e: FinancialEntry, method: ChargeMethod) {
  if (!e.provider || !e.providerRef) return false;
  if (method === 'PIX') return !!e.pixPayload;
  if (method === 'BOLETO') return !!e.boletoLine;
  if (e.provider === 'MERCADO_PAGO') return e.providerRef.startsWith('pref-');
  // Asaas: fatura com cartão (CREDIT_CARD) ou "cliente escolhe" (UNDEFINED, tem boleto e Pix)
  return !!e.paymentUrl && ((!e.boletoLine && !e.pixPayload) || (!!e.boletoLine && !!e.pixPayload));
}

const CLEAR = { provider: null, providerRef: null, paymentUrl: null, boletoLine: null, boletoBarcode: null, boletoNumber: null, pixPayload: null };

/**
 * Registra a cobrança do título no provedor conectado e grava linha digitável,
 * Pix copia e cola e link da fatura. Sem provedor: mantém/gera a cobrança simulada.
 */
export async function createCharge(companyId: string, entryId: string, method?: ChargeMethod, opts: { backUrl?: string } = {}) {
  const entry = await prisma.financialEntry.findFirst({ where: { id: entryId, companyId } });
  if (!entry) fail(404, 'Lançamento não encontrado');
  const e = entry!;
  if (e.type !== 'RECEBER') fail(400, 'Cobranças são emitidas apenas para contas a receber');
  if (!['ABERTO', 'PARCIAL'].includes(e.status)) fail(400, 'O título não está em aberto');
  const amount = round2(e.amount - e.paidAmount);
  const m = method || methodFromPayment(e.paymentMethod);
  const acc = await paymentAccount(companyId);
  if (!acc && !isDemoMode()) {
    // Produção sem provedor: não existe boleto/cartão sem registro. Só o Pix estático da chave cadastrada (baixa manual).
    if (m === 'PIX') {
      const company = await prisma.company.findUnique({ where: { id: companyId } });
      const bank = await defaultBankAccount(prisma, companyId, 'CONTA_DIGITAL');
      if (company && realPixKey(bank)) {
        const data = billingData(company, bank!, amount, e.dueDate, 'PIX');
        return { entry: await prisma.financialEntry.update({ where: { id: e.id }, data: { ...CLEAR, ...data } }), simulated: false as const, manual: true as const };
      }
    }
    requireRealOrDemo('Emissão de cobrança (boleto/Pix/cartão)', `${PAYMENT_HOWTO}${m === 'PIX' ? ' Ou cadastre a chave Pix da conta bancária (Finanças → Contas bancárias) para gerar o Pix copia e cola com baixa manual.' : ''}`);
  }
  if (!acc) {
    // Simulado: boleto FEBRABAN + BR Code gerados localmente
    if (e.boletoLine && e.pixPayload) return { entry: e, simulated: true as const };
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    const bank = await defaultBankAccount(prisma, companyId, 'CONTA_DIGITAL');
    if (!company || !bank) return { entry: e, simulated: true as const };
    return { entry: await prisma.financialEntry.update({ where: { id: e.id }, data: billingData(company, bank, amount, e.dueDate) }), simulated: true as const };
  }
  if (e.provider === acc!.provider && covers(e, m)) return { entry: e, simulated: false as const, redirectUrl: m === 'CARTAO' ? e.paymentUrl : null };
  const gw = gatewayFor(acc.provider)!;
  // Uma cobrança ativa por título: cancela a anterior antes de registrar outra (evita pagamento em dobro)
  if (e.provider && e.providerRef) await cancelAtProvider(companyId, e.provider, e.providerRef).catch(() => {});
  const hook = webhookUrl(acc.provider, acc.id);
  const r = await gw.create(acc, {
    entryId: e.id, description: e.description, amount, dueDate: e.dueDate, method: m, payer: await payerOf(e),
    notificationUrl: hook.startsWith('https://') ? hook : null, backUrl: opts.backUrl || `${appUrl()}/`,
  });
  const updated = await prisma.financialEntry.update({
    where: { id: e.id },
    data: {
      ...CLEAR, provider: acc.provider, providerRef: r.ref, paymentUrl: r.paymentUrl || null, boletoLine: r.boletoLine || null, boletoBarcode: r.boletoBarcode || null, boletoNumber: r.boletoNumber || null, pixPayload: r.pixPayload || null,
      paymentMethod: e.paymentMethod || (m === 'PIX' ? 'PIX' : m === 'CARTAO' ? 'CARTAO_CREDITO' : 'BOLETO'),
    },
  });
  return { entry: updated, simulated: false as const, redirectUrl: m === 'CARTAO' || m === 'UNDEFINED' ? r.paymentUrl || null : null, pixImage: r.pixImage || null };
}

async function cancelAtProvider(companyId: string, provider: string, ref: string) {
  const acc = await getAccount(companyId, provider).catch(() => null);
  if (acc) await gatewayFor(provider)?.cancel(acc, ref);
}

/** Cancela a cobrança no provedor (o título continua em aberto, sem cobrança) */
export async function cancelCharge(companyId: string, entryId: string) {
  const e = await prisma.financialEntry.findFirst({ where: { id: entryId, companyId } });
  if (!e) fail(404, 'Lançamento não encontrado');
  if (e!.provider && e!.providerRef) await cancelAtProvider(companyId, e!.provider, e!.providerRef);
  return prisma.financialEntry.update({ where: { id: e!.id }, data: CLEAR });
}

/** Estorna o pagamento no provedor e reabre o título */
export async function refundCharge(companyId: string, entryId: string, amount?: number) {
  const e = await prisma.financialEntry.findFirst({ where: { id: entryId, companyId } });
  if (!e) fail(404, 'Lançamento não encontrado');
  if (!e!.provider || !e!.providerRef) fail(400, 'O título não tem cobrança registrada em provedor');
  if (!(e!.paidAmount > 0)) fail(400, 'O título não foi pago');
  const acc = await getAccount(companyId, e!.provider!);
  if (!acc) fail(400, 'Conta do provedor desconectada');
  await gatewayFor(e!.provider)!.refund(acc!, e!.providerRef!, amount, e!.id);
  await reverseEntry(e!, `Estorno solicitado no ${gatewayFor(e!.provider)!.name}`);
  return prisma.financialEntry.findUnique({ where: { id: e!.id } });
}

// ---------------------------------------------------------------------------
// Notificações do provedor → financeiro
// ---------------------------------------------------------------------------
async function findEntry(companyId: string, provider: string, ref: string, externalReference?: string | null) {
  if (externalReference) {
    const e = await prisma.financialEntry.findFirst({ where: { id: externalReference, companyId } });
    if (e) return e;
  }
  return prisma.financialEntry.findFirst({ where: { companyId, provider, providerRef: ref } });
}

async function settlementBank(acc: AccountCtx) {
  const name = String(acc.settings.bankAccountName || '').trim();
  return (name && (await prisma.bankAccount.findFirst({ where: { companyId: acc.companyId, active: true, name: { equals: name, mode: 'insensitive' } } }))) || defaultBankAccount(prisma, acc.companyId, 'CONTA_DIGITAL');
}

const LINK_METHOD = (m?: string | null) => (m === 'PIX' ? 'PIX' : m === 'BOLETO' ? 'BOLETO' : 'CARTAO');

/** Aplica a situação informada pelo provedor ao título (idempotente) */
export async function applyProviderPayment(acc: AccountCtx, p: ProviderPayment): Promise<string> {
  const name = gatewayFor(acc.provider)?.name || acc.provider;
  const e = await findEntry(acc.companyId, acc.provider, p.ref, p.externalReference);
  if (!e) return `Cobrança ${p.ref} sem título vinculado`;
  const company = await prisma.company.findUnique({ where: { id: acc.companyId } });
  if (p.status === 'PAGO') {
    if (e.status === 'PAGO') return `Título "${e.description}" já quitado`;
    if (e.status === 'CANCELADO') {
      await notify(acc.companyId, 'Pagamento de título cancelado', `${name} confirmou o pagamento de "${e.description}", mas o título está cancelado. Verifique.`, { level: 'warning', link: '/financeiro/receber?status=CANCELADO' });
      return 'Título cancelado — pagamento não baixado';
    }
    const gross = round2(p.gross ?? e.amount - e.paidAmount);
    const open = round2(e.amount - e.paidAmount);
    const bank = await settlementBank(acc);
    const date = p.date || new Date();
    await payEntry(acc.companyId, company!.organizationId, e.id, { amount: gross, interest: gross > open ? round2(gross - open) : 0, date, bankAccountId: bank?.id, method: p.method || e.paymentMethod, transactionSource: p.method === 'BOLETO' ? 'BOLETO' : p.method === 'PIX' ? 'PIX' : acc.provider, userName: name });
    // Tarifa do provedor (valor bruto − líquido) como despesa bancária
    const fee = p.net != null ? round2(gross - p.net) : 0;
    if (fee > 0.004) {
      const [t] = await createEntries(prisma, { companyId: acc.companyId, type: 'PAGAR', description: `Tarifa ${name} - ${e.description}`, contactName: name, total: fee, firstDueDate: date, origin: 'INTEGRACAO', originId: e.id, chartAccountCode: '2.5.01', paymentMethod: 'TRANSFERENCIA', documentNumber: p.ref, competenceDate: date });
      await payEntry(acc.companyId, company!.organizationId, t.id, { date, bankAccountId: bank?.id, method: 'TRANSFERENCIA', transactionSource: 'TARIFA', userName: name });
    }
    await prisma.paymentLink.updateMany({ where: { entryId: e.id, status: 'ATIVO' }, data: { status: 'PAGO', paidAt: date, paidMethod: LINK_METHOD(p.method) } });
    await notify(acc.companyId, 'Pagamento recebido', `${name}: "${e.description}" — R$ ${gross.toFixed(2)}${fee > 0.004 ? ` (tarifa R$ ${fee.toFixed(2)})` : ''}`, { level: 'success', link: '/financeiro/receber?status=PAGO' });
    return `Título "${e.description}" quitado (${gross.toFixed(2)})`;
  }
  if (p.status === 'ESTORNADO') {
    if (!(e.paidAmount > 0)) return 'Título sem baixa para estornar';
    await reverseEntry(e, `Pagamento estornado no ${name}`);
    return `Baixa de "${e.description}" estornada`;
  }
  if (p.status === 'CANCELADO') {
    if (e.providerRef !== p.ref || e.paidAmount > 0) return 'Cobrança substituída ou já paga — nada a fazer';
    await prisma.financialEntry.update({ where: { id: e.id }, data: CLEAR });
    await notify(acc.companyId, 'Cobrança cancelada', `${name}: a cobrança de "${e.description}" foi cancelada/removida no provedor. Emita uma nova se necessário.`, { level: 'warning', link: '/financeiro/cobrancas' });
    return 'Cobrança cancelada no provedor';
  }
  if (p.status === 'VENCIDO') {
    await notify(acc.companyId, 'Cobrança vencida', `${name}: "${e.description}" (${e.contactName || 'cliente'}) venceu sem pagamento — R$ ${(e.amount - e.paidAmount).toFixed(2)}`, { level: 'warning', link: '/financeiro/receber?status=VENCIDO' });
    return 'Vencimento notificado';
  }
  return 'Aguardando pagamento';
}

/** Estorno da baixa (igual à ação "Estornar baixa"): remove movimentos e reabre o título */
async function reverseEntry(e: FinancialEntry, reason: string) {
  const fresh = await prisma.financialEntry.findUnique({ where: { id: e.id } });
  if (!fresh || !(fresh.paidAmount > 0)) return;
  await prisma.bankTransaction.deleteMany({ where: { entryId: e.id, source: { not: 'OFX' } } });
  await prisma.bankTransaction.updateMany({ where: { entryId: e.id }, data: { entryId: null, reconciled: false } });
  await prisma.financialEntry.update({ where: { id: e.id }, data: { status: 'ABERTO', paidAmount: 0, paymentDate: null, interest: 0, fine: 0, discountAmount: 0, notes: [fresh.notes, `${reason} em ${new Date().toLocaleDateString('pt-BR')}`].filter(Boolean).join('\n') } });
  await notify(e.companyId, 'Pagamento estornado', `${reason}: "${e.description}" voltou para em aberto.`, { level: 'warning', link: '/financeiro/receber' });
}

/** Sincronização periódica (quando o webhook não alcança o servidor, ex.: localhost) */
export async function syncOpenCharges(acc: AccountCtx) {
  const gw = gatewayFor(acc.provider);
  if (!gw?.status) return;
  const open = await prisma.financialEntry.findMany({ where: { companyId: acc.companyId, provider: acc.provider, providerRef: { not: null }, status: { in: ['ABERTO', 'PARCIAL'] } }, orderBy: { dueDate: 'asc' }, take: 50 });
  let paid = 0;
  for (const e of open) {
    const p = await gw.status(acc, e.providerRef!, e.id).catch(() => null);
    if (p && p.status === 'PAGO') {
      await applyProviderPayment(acc, p);
      paid++;
    }
  }
  return `${open.length} cobrança(s) consultada(s), ${paid} paga(s)`;
}

// ---------------------------------------------------------------------------
// Emissão automática ao lançar recebíveis por boleto/Pix (faturamento, OS...)
// ---------------------------------------------------------------------------
/** Chamado por createEntries: agenda a emissão fora da transação, se houver conta com "emitir automaticamente" */
export async function queueAutoCharge(companyId: string, entryIds: string[]) {
  try {
    const accs = await prisma.integrationAccount.findMany({ where: { companyId, provider: { in: PAYMENT_PROVIDERS }, status: 'CONECTADO' }, select: { settings: true } });
    if (!accs.some((a) => (a.settings as any)?.autoCharge !== false)) return;
    await enqueue('payments.autoCharge', { companyId, entryIds }, { delayMs: 3000, maxAttempts: 3 });
  } catch {}
}

/** Registra as cobranças no provedor; falha não quebra o faturamento (fica a cobrança simulada) */
export async function autoCharge(companyId: string, entryIds: string[]) {
  const acc = await paymentAccount(companyId);
  if (!acc || acc.settings.autoCharge === false) return 0;
  const name = gatewayFor(acc.provider)?.name || acc.provider;
  let n = 0;
  for (const id of entryIds) {
    const e = await prisma.financialEntry.findFirst({ where: { id, companyId } });
    if (!e || e.type !== 'RECEBER' || !['ABERTO', 'PARCIAL'].includes(e.status) || e.provider) continue;
    try {
      await createCharge(companyId, id);
      n++;
    } catch (err) {
      await notify(companyId, 'Falha ao emitir cobrança', `${name}: "${e.description}" — ${(err as Error).message}. ${isDemoMode() ? 'Mantida a cobrança simulada' : 'Título mantido sem cobrança registrada'}; use "Emitir cobrança" para tentar de novo.`, { level: 'error', link: '/financeiro/receber' });
    }
  }
  return n;
}

registerJob('payments.autoCharge', async ({ companyId, entryIds }) => {
  await autoCharge(companyId, entryIds || []);
});
