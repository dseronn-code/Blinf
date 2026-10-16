import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { round2, addDays } from '@/lib/utils';
import { payEntry } from '@/server/services/finance';

/** Transações não conciliadas + sugestões de títulos (valor igual, data próxima, nome parecido) */
export const GET = route('financeiro', 'view', async ({ ctx, query }) => {
  const where: any = { companyId: ctx.companyId, reconciled: false };
  if (query.get('bankAccountId')) where.bankAccountId = query.get('bankAccountId');
  const txs = await prisma.bankTransaction.findMany({ where, orderBy: { date: 'asc' }, include: { bankAccount: { select: { name: true } } } });
  const open = await prisma.financialEntry.findMany({ where: { companyId: ctx.companyId, status: { in: ['ABERTO', 'PARCIAL'] } } });
  const rows = txs.map((t) => {
    const type = t.amount >= 0 ? 'RECEBER' : 'PAGAR';
    const abs = Math.abs(t.amount);
    const candidates = open
      .filter((e) => e.type === type && Math.abs(round2(e.amount - e.paidAmount) - abs) < 0.01 && Math.abs(e.dueDate.getTime() - t.date.getTime()) < 30 * 86400000)
      .map((e) => {
        const words = (e.contactName || e.description).toUpperCase().split(/\s+/).filter((w) => w.length > 3);
        const nameScore = words.filter((w) => t.description.toUpperCase().includes(w)).length;
        const days = Math.abs(e.dueDate.getTime() - t.date.getTime()) / 86400000;
        return { id: e.id, description: e.description, contactName: e.contactName, dueDate: e.dueDate, open: round2(e.amount - e.paidAmount), score: nameScore * 10 - days };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    return { ...t, suggestions: candidates };
  });
  return { rows };
});

/**
 * Concilia: { transactionId, entryId } baixa o título usando a transação do extrato;
 * { transactionId, create: { description, chartAccountId } } cria lançamento já pago;
 * { transactionId, ignore: true } marca como conciliada sem vínculo.
 */
export const POST = route('financeiro', 'edit', async ({ ctx, body }) => {
  const tx = await prisma.bankTransaction.findFirst({ where: { id: body.transactionId, companyId: ctx.companyId } });
  if (!tx) fail(404, 'Transação não encontrada');
  if (tx!.reconciled) fail(400, 'Transação já conciliada');
  if (body.entryId) {
    await payEntry(ctx.companyId, ctx.orgId, body.entryId, { amount: Math.abs(tx!.amount), date: tx!.date, bankAccountId: tx!.bankAccountId, skipTransaction: true, userName: ctx.userName });
    return prisma.bankTransaction.update({ where: { id: tx!.id }, data: { reconciled: true, entryId: body.entryId } });
  }
  if (body.create) {
    const e = await prisma.financialEntry.create({ data: { companyId: ctx.companyId, type: tx!.amount >= 0 ? 'RECEBER' : 'PAGAR', description: body.create.description || tx!.description, dueDate: tx!.date, amount: Math.abs(tx!.amount), paidAmount: Math.abs(tx!.amount), status: 'PAGO', paymentDate: tx!.date, bankAccountId: tx!.bankAccountId, chartAccountId: body.create.chartAccountId || null, origin: 'MANUAL', competenceDate: tx!.date } });
    return prisma.bankTransaction.update({ where: { id: tx!.id }, data: { reconciled: true, entryId: e.id } });
  }
  if (body.ignore) return prisma.bankTransaction.update({ where: { id: tx!.id }, data: { reconciled: true } });
  fail(400, 'Informe o título, a criação ou ignore');
  void addDays;
});
