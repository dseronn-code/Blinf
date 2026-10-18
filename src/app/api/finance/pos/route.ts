import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { round2, randomDigits, pick } from '@/lib/utils';
import { defaultBankAccount } from '@/server/services/finance';
import { isDemoMode } from '@/lib/demo';

/** Dados do comprovante informados pelo operador (NSU/autorização/bandeira impressos pela maquininha) */
const slipField = (v: unknown, max = 20) => String(v ?? '').trim().slice(0, max);

export const GET = route('financeiro', 'view', async ({ ctx }) => {
  const rows = await prisma.posTransaction.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: 'desc' }, take: 200 });
  const terminals = await prisma.posTerminal.findMany({ where: { companyId: ctx.companyId } });
  return { rows: rows.map((r) => ({ ...r, terminal: terminals.find((t) => t.id === r.terminalId)?.name })), terminals };
});

/**
 * Venda na maquininha: registra a transação, a taxa e o crédito na conta.
 * Modo demonstração: simula o POS integrado (aprovação, NSU, autorização e bandeira gerados).
 * Produção: a cobrança é feita na maquininha externa e aqui só se registra o que o operador informar
 * (NSU/autorização/bandeira opcionais — nada é inventado).
 */
export const POST = route('financeiro', 'edit', async ({ ctx, body }) => {
  const t = await prisma.posTerminal.findFirst({ where: { id: body.terminalId, companyId: ctx.companyId } });
  if (!t) fail(400, 'Terminal inválido');
  const amount = round2(Number(body.amount));
  if (!(amount > 0)) fail(400, 'Informe o valor');
  const method = body.method || 'CREDITO';
  const demo = isDemoMode();
  const approved = demo ? amount < 50000 : true;
  const rate = method === 'CREDITO' ? t!.creditFee + (Number(body.installments) > 1 ? 1.5 : 0) : method === 'DEBITO' ? t!.debitFee : t!.pixFee;
  const fee = round2((amount * rate) / 100);
  const tx = await prisma.posTransaction.create({ data: { companyId: ctx.companyId, terminalId: t!.id, method, installments: Number(body.installments) || 1, amount, fee, netAmount: round2(amount - fee), nsu: demo ? randomDigits(9) : slipField(body.nsu), authCode: demo ? randomDigits(6) : slipField(body.authCode), brand: method === 'PIX' ? null : demo ? pick(['Visa', 'Mastercard', 'Elo', 'Amex']) : slipField(body.brand, 30) || null, status: approved ? 'APROVADA' : 'NEGADA' } });
  if (approved) {
    // Cartão: entra na conta de recebíveis (liquidação conforme agenda); Pix cai direto na conta digital
    const bank = method === 'PIX' ? await defaultBankAccount(prisma, ctx.companyId, 'CONTA_DIGITAL') : await defaultBankAccount(prisma, ctx.companyId, 'CARTAO');
    if (bank) {
      await prisma.bankTransaction.create({ data: { companyId: ctx.companyId, bankAccountId: bank.id, date: new Date(), description: `Venda ${t!.acquirer} ${method}${tx.nsu ? ` NSU ${tx.nsu}` : ''}`, amount, source: 'POS', reconciled: true } });
      await prisma.bankTransaction.create({ data: { companyId: ctx.companyId, bankAccountId: bank.id, date: new Date(), description: `Taxa ${t!.acquirer}${tx.nsu ? ` NSU ${tx.nsu}` : ''}`, amount: -fee, source: 'TARIFA', reconciled: true } });
    }
  }
  return tx;
});
