/**
 * Financeiro: contas a pagar/receber, parcelamento, baixas (com movimento
 * bancário), boletos e Pix, conta digital e utilidades de plano de contas.
 */
import type { Db } from '@/lib/db';
import { prisma } from '@/lib/db';
import { addDays, round2, randomDigits, onlyDigits } from '@/lib/utils';
import { buildBoleto, buildPixPayload } from '@/lib/br';
import { fail } from '../errors';
import { emit } from '../events';
import { isDemoMode } from '@/lib/demo';

export async function chartAccountId(db: Db, companyId: string, code: string) {
  const acc = await db.chartAccount.findFirst({ where: { companyId, code } });
  return acc?.id ?? null;
}

export async function defaultBankAccount(db: Db, companyId: string, type?: string) {
  return (
    (type && (await db.bankAccount.findFirst({ where: { companyId, type, active: true } }))) ||
    (await db.bankAccount.findFirst({ where: { companyId, isDefault: true, active: true } })) ||
    (await db.bankAccount.findFirst({ where: { companyId, active: true } }))
  );
}

/** Divide um valor em N parcelas com ajuste de centavos na última */
export function splitInstallments(total: number, n: number) {
  const count = Math.max(1, Math.floor(n));
  const part = round2(total / count);
  const arr = Array.from({ length: count }, () => part);
  arr[count - 1] = round2(total - part * (count - 1));
  return arr;
}

export type CreateEntriesInput = {
  companyId: string;
  type: 'RECEBER' | 'PAGAR';
  description: string;
  contactId?: string | null;
  contactName?: string | null;
  total: number;
  installments?: number;
  firstDueDate?: Date;
  intervalDays?: number;
  origin?: string;
  originId?: string | null;
  chartAccountCode?: string;
  chartAccountId?: string | null;
  costCenterId?: string | null;
  paymentMethod?: string | null;
  documentNumber?: string | null;
  competenceDate?: Date;
  notes?: string | null;
};

export async function createEntries(db: Db, input: CreateEntriesInput) {
  const n = input.installments || 1;
  const parts = splitInstallments(input.total, n);
  const first = input.firstDueDate || addDays(new Date(), 30);
  const interval = input.intervalDays ?? 30;
  const chartId = input.chartAccountId || (input.chartAccountCode ? await chartAccountId(db, input.companyId, input.chartAccountCode) : null);
  const company = await db.company.findUnique({ where: { id: input.companyId } });
  const bank = await defaultBankAccount(db, input.companyId, 'CONTA_DIGITAL');
  const created = [];
  for (let i = 0; i < parts.length; i++) {
    const dueDate = addDays(first, i * interval);
    const data: any = {
      companyId: input.companyId,
      type: input.type,
      description: n > 1 ? `${input.description} (${i + 1}/${n})` : input.description,
      contactId: input.contactId || null,
      contactName: input.contactName || null,
      documentNumber: input.documentNumber ? (n > 1 ? `${input.documentNumber}/${i + 1}` : input.documentNumber) : null,
      dueDate,
      competenceDate: input.competenceDate || new Date(),
      amount: parts[i],
      installment: i + 1,
      installments: n,
      origin: input.origin || 'MANUAL',
      originId: input.originId || null,
      chartAccountId: chartId,
      costCenterId: input.costCenterId || null,
      paymentMethod: input.paymentMethod || null,
      notes: input.notes || null,
    };
    // Recebíveis por boleto/Pix já nascem com os dados de cobrança (simulados no modo demonstração;
    // em produção, sem provedor, só o Pix estático da chave cadastrada — boleto só via Asaas/Mercado Pago)
    if (input.type === 'RECEBER' && company && bank && (input.paymentMethod === 'BOLETO' || input.paymentMethod === 'PIX')) {
      Object.assign(data, billingData(company, bank, parts[i], dueDate, input.paymentMethod));
    }
    created.push(await db.financialEntry.create({ data }));
  }
  // Com Asaas/Mercado Pago conectado, a cobrança real é registrada pela fila (fora da transação)
  if (input.type === 'RECEBER' && created.length && (input.paymentMethod === 'BOLETO' || input.paymentMethod === 'PIX')) {
    await (await import('./payments')).queueAutoCharge(input.companyId, created.map((c) => c.id));
  }
  return created;
}

/** Onde conectar a cobrança real (boleto/Pix registrados com baixa automática) */
export const PAYMENT_HOWTO = 'Conecte o Asaas ou o Mercado Pago em Integrações → Contas e credenciais.';
/** Conta fictícia da demonstração ("GestãoPro Bank", código 999) */
export const isSimulatedBank = (bank: { bankCode?: string | null } | null | undefined) => !!bank && bank.bankCode === '999';
/** Chave Pix real cadastrada na conta bancária (em produção a conta fictícia 999 não conta) */
export const realPixKey = (bank: { bankCode?: string | null; pixKey: string | null } | null | undefined) => (bank?.pixKey && (isDemoMode() || !isSimulatedBank(bank)) ? bank.pixKey : null);

/**
 * Dados de cobrança sem provedor conectado.
 * - Modo demonstração: boleto FEBRABAN + BR Code Pix gerados localmente (simulação).
 * - Produção: NADA de boleto inventado. Só o Pix "copia e cola" estático para a chave Pix cadastrada
 *   na conta bancária (BR Code legítimo — o pagador paga direto para a chave; a baixa é manual).
 */
export function billingData(company: { cnpj: string; tradeName: string | null; name: string; city: string | null }, bank: { bankCode: string | null; agency: string | null; accountNumber: string | null; pixKey: string | null }, amount: number, dueDate: Date, method?: string | null): { boletoNumber?: string; boletoLine?: string; boletoBarcode?: string; pixPayload?: string } {
  const ourNumber = randomDigits(11);
  if (!isDemoMode()) {
    const key = realPixKey(bank);
    if (!key || method === 'BOLETO') return {};
    return { pixPayload: buildPixPayload({ key, name: company.tradeName || company.name, city: company.city || 'Sao Paulo', amount, txid: `GP${ourNumber}` }) };
  }
  const b = buildBoleto({ bankCode: bank.bankCode || '999', amount, dueDate, ourNumber, agency: onlyDigits(bank.agency || '0001'), account: onlyDigits(bank.accountNumber || '1234567') });
  const pix = buildPixPayload({
    key: bank.pixKey || onlyDigits(company.cnpj),
    name: company.tradeName || company.name,
    city: company.city || 'Sao Paulo',
    amount,
    txid: `GP${ourNumber}`,
  });
  return { boletoNumber: ourNumber, boletoLine: b.formatted, boletoBarcode: b.barcode, pixPayload: pix };
}

export type PayInput = {
  amount?: number;
  date?: Date;
  bankAccountId?: string | null;
  method?: string | null;
  interest?: number;
  fine?: number;
  discount?: number;
  /** quando true, não cria movimento bancário (ex.: conciliação já possui a transação) */
  skipTransaction?: boolean;
  transactionSource?: string;
  userName?: string;
};

/** Baixa (total ou parcial) de uma conta, gerando o movimento bancário correspondente */
export async function payEntry(companyId: string, orgId: string, entryId: string, input: PayInput, db: Db = prisma) {
  const entry = await db.financialEntry.findFirst({ where: { id: entryId, companyId } });
  if (!entry) fail(404, 'Lançamento não encontrado');
  const e = entry!;
  if (e.status === 'PAGO') fail(400, 'Lançamento já está quitado');
  if (e.status === 'CANCELADO') fail(400, 'Lançamento cancelado');
  const open = round2(e.amount - e.paidAmount);
  const interest = round2(input.interest || 0);
  const fine = round2(input.fine || 0);
  const discount = round2(input.discount || 0);
  const amount = round2(input.amount ?? open + interest + fine - discount);
  const principal = round2(amount - interest - fine + discount);
  const paidAmount = round2(e.paidAmount + principal);
  const status = paidAmount + 0.009 >= e.amount ? 'PAGO' : 'PARCIAL';
  const date = input.date || new Date();
  const bank = input.bankAccountId ? await db.bankAccount.findFirst({ where: { id: input.bankAccountId, companyId } }) : await defaultBankAccount(db, companyId);
  if (!bank) fail(400, 'Cadastre uma conta bancária/caixa para registrar a baixa');

  const updated = await db.financialEntry.update({
    where: { id: e.id },
    data: {
      paidAmount,
      status,
      paymentDate: date,
      bankAccountId: bank!.id,
      paymentMethod: input.method || e.paymentMethod,
      interest: round2(e.interest + interest),
      fine: round2(e.fine + fine),
      discountAmount: round2(e.discountAmount + discount),
    },
  });
  if (!input.skipTransaction) {
    await db.bankTransaction.create({
      data: {
        companyId,
        bankAccountId: bank!.id,
        date,
        description: `${e.type === 'RECEBER' ? 'Recebimento' : 'Pagamento'}: ${e.description}`,
        amount: e.type === 'RECEBER' ? amount : -amount,
        source: input.transactionSource || 'PAGAMENTO',
        reconciled: true,
        entryId: e.id,
        counterpart: e.contactName,
      },
    });
  }
  if (status === 'PAGO') {
    await emit(e.type === 'RECEBER' ? 'receivable.paid' : 'payable.paid', { companyId, orgId, entryId: e.id, origin: e.origin, originId: e.originId, userName: input.userName });
  }
  return updated;
}

/** Cancela lançamentos em aberto de uma origem (ex.: pedido cancelado) */
export async function cancelEntriesByOrigin(db: Db, companyId: string, origin: string[], originId: string) {
  const r = await db.financialEntry.updateMany({
    where: { companyId, origin: { in: origin }, originId, status: { in: ['ABERTO', 'PARCIAL'] } },
    data: { status: 'CANCELADO' },
  });
  return r.count;
}

/** Saldo atual de uma conta bancária (saldo inicial + movimentos) */
export async function bankBalance(db: Db, bankAccountId: string) {
  const acc = await db.bankAccount.findUnique({ where: { id: bankAccountId } });
  const s = await db.bankTransaction.aggregate({ where: { bankAccountId }, _sum: { amount: true } });
  return round2((acc?.initialBalance || 0) + (s._sum.amount || 0));
}

/** Status efetivo considerando vencimento */
export function effectiveStatus(e: { status: string; dueDate: Date }) {
  if ((e.status === 'ABERTO' || e.status === 'PARCIAL') && new Date(e.dueDate) < new Date(new Date().toDateString())) return 'VENCIDO';
  return e.status;
}
