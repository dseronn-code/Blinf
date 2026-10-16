import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { round2 } from '@/lib/utils';

export const GET = route('financeiro', 'view', async ({ ctx, query }) => {
  const where: any = { companyId: ctx.companyId };
  if (query.get('bankAccountId')) where.bankAccountId = query.get('bankAccountId');
  if (query.get('reconciled')) where.reconciled = query.get('reconciled') === 'true';
  if (query.get('from') || query.get('to')) where.date = { ...(query.get('from') ? { gte: new Date(query.get('from')!) } : {}), ...(query.get('to') ? { lte: new Date(query.get('to') + 'T23:59:59') } : {}) };
  const rows = await prisma.bankTransaction.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: Number(query.get('pageSize')) || 300, include: { bankAccount: { select: { name: true } } } });
  // saldo corrente (do mais antigo para o mais novo)
  let running = 0;
  if (query.get('bankAccountId')) {
    const acc = await prisma.bankAccount.findUnique({ where: { id: query.get('bankAccountId')! } });
    const all = await prisma.bankTransaction.aggregate({ where: { bankAccountId: query.get('bankAccountId')! }, _sum: { amount: true } });
    running = round2((acc?.initialBalance || 0) + (all._sum.amount || 0));
  }
  const withBalance = rows.map((r) => {
    const b = running;
    running = round2(running - r.amount);
    return { ...r, balanceAfter: b };
  });
  return { rows: withBalance };
});

/** Lançamento manual em conta (tarifa, rendimento, ajuste) */
export const POST = route('financeiro', 'edit', async ({ ctx, body }) => {
  const acc = await prisma.bankAccount.findFirst({ where: { id: body.bankAccountId, companyId: ctx.companyId } });
  if (!acc) fail(400, 'Conta inválida');
  const amount = round2(Number(body.amount));
  if (!amount) fail(400, 'Informe o valor');
  return prisma.bankTransaction.create({ data: { companyId: ctx.companyId, bankAccountId: acc!.id, date: body.date ? new Date(body.date + 'T12:00:00') : new Date(), description: body.description || 'Lançamento manual', amount, source: 'MANUAL', reconciled: true } });
});
