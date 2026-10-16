import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { round2, randomDigits, pick } from '@/lib/utils';
import { defaultBankAccount } from '@/server/services/finance';

export const GET = route('financeiro', 'view', async ({ ctx }) => {
  const rows = await prisma.posTransaction.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: 'desc' }, take: 200 });
  const terminals = await prisma.posTerminal.findMany({ where: { companyId: ctx.companyId } });
  return { rows: rows.map((r) => ({ ...r, terminal: terminals.find((t) => t.id === r.terminalId)?.name })), terminals };
});

/** Simula uma cobrança na maquininha (POS integrado): aprova, registra taxa e crédito na conta */
export const POST = route('financeiro', 'edit', async ({ ctx, body }) => {
  const t = await prisma.posTerminal.findFirst({ where: { id: body.terminalId, companyId: ctx.companyId } });
  if (!t) fail(400, 'Terminal inválido');
  const amount = round2(Number(body.amount));
  if (!(amount > 0)) fail(400, 'Informe o valor');
  const method = body.method || 'CREDITO';
  const approved = amount < 50000;
  const rate = method === 'CREDITO' ? t!.creditFee + (Number(body.installments) > 1 ? 1.5 : 0) : method === 'DEBITO' ? t!.debitFee : t!.pixFee;
  const fee = round2((amount * rate) / 100);
  const tx = await prisma.posTransaction.create({ data: { companyId: ctx.companyId, terminalId: t!.id, method, installments: Number(body.installments) || 1, amount, fee, netAmount: round2(amount - fee), nsu: randomDigits(9), authCode: randomDigits(6), brand: method === 'PIX' ? null : pick(['Visa', 'Mastercard', 'Elo', 'Amex']), status: approved ? 'APROVADA' : 'NEGADA' } });
  if (approved) {
    // Cartão: entra na conta de recebíveis (liquidação conforme agenda); Pix cai direto na conta digital
    const bank = method === 'PIX' ? await defaultBankAccount(prisma, ctx.companyId, 'CONTA_DIGITAL') : await defaultBankAccount(prisma, ctx.companyId, 'CARTAO');
    if (bank) {
      await prisma.bankTransaction.create({ data: { companyId: ctx.companyId, bankAccountId: bank.id, date: new Date(), description: `Venda ${t!.acquirer} ${method} NSU ${tx.nsu}`, amount, source: 'POS', reconciled: true } });
      await prisma.bankTransaction.create({ data: { companyId: ctx.companyId, bankAccountId: bank.id, date: new Date(), description: `Taxa ${t!.acquirer} NSU ${tx.nsu}`, amount: -fee, source: 'TARIFA', reconciled: true } });
    }
  }
  return tx;
});
