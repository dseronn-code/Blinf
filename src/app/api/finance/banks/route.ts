import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { bankBalance } from '@/server/services/finance';

export const GET = route('financeiro', 'view', async ({ ctx }) => {
  const accounts = await prisma.bankAccount.findMany({ where: { companyId: ctx.consolidated ? { in: ctx.companyIds } : ctx.companyId }, orderBy: { name: 'asc' } });
  const rows = await Promise.all(accounts.map(async (a) => ({ ...a, balance: await bankBalance(prisma, a.id), pending: await prisma.bankTransaction.count({ where: { bankAccountId: a.id, reconciled: false } }) })));
  return { rows, total: rows.reduce((s, r) => s + r.balance, 0) };
});
