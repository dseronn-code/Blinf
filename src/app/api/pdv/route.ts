import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { round2 } from '@/lib/utils';

/** Sessão de caixa atual com resumo por forma de pagamento */
export const GET = route('pdv', 'view', async ({ ctx }) => {
  const session = await prisma.cashSession.findFirst({ where: { companyId: ctx.companyId, status: 'ABERTO' }, include: { movements: { orderBy: { createdAt: 'asc' } } }, orderBy: { openedAt: 'desc' } });
  const history = await prisma.cashSession.findMany({ where: { companyId: ctx.companyId, status: 'FECHADO' }, orderBy: { openedAt: 'desc' }, take: 10 });
  const terminals = await prisma.posTerminal.findMany({ where: { companyId: ctx.companyId, active: true } });
  const warehouses = await prisma.warehouse.findMany({ where: { companyId: ctx.companyId, active: true } });
  let summary = null;
  if (session) {
    const by: Record<string, number> = {};
    for (const m of session.movements) if (m.type === 'VENDA') by[m.method] = round2((by[m.method] || 0) + m.amount);
    const cash = round2(session.movements.filter((m) => m.method === 'DINHEIRO' || m.type !== 'VENDA').reduce((a, m) => a + (m.type === 'FECHAMENTO' ? 0 : m.amount), 0));
    summary = { byMethod: by, sales: session.movements.filter((m) => m.type === 'VENDA').length, total: round2(Object.values(by).reduce((a, v) => a + v, 0)), expectedCash: cash };
  }
  return { session, summary, history, terminals, warehouses };
});

export const POST = route('pdv', 'edit', async ({ ctx, body }) => {
  const open = await prisma.cashSession.findFirst({ where: { companyId: ctx.companyId, status: 'ABERTO' }, include: { movements: true } });
  const amount = round2(Number(body.amount) || 0);
  switch (body.action) {
    case 'open': {
      if (open) fail(400, 'Já existe um caixa aberto');
      return prisma.cashSession.create({ data: { companyId: ctx.companyId, userName: ctx.userName, register: body.register || 'Caixa 01', openingAmount: amount, movements: { create: { type: 'ABERTURA', amount, notes: 'Abertura de caixa' } } } });
    }
    case 'sangria':
    case 'suprimento': {
      if (!open) fail(400, 'Nenhum caixa aberto');
      if (amount <= 0) fail(400, 'Informe o valor');
      return prisma.cashMovement.create({ data: { sessionId: open!.id, type: body.action === 'sangria' ? 'SANGRIA' : 'SUPRIMENTO', amount: body.action === 'sangria' ? -amount : amount, notes: body.notes || null } });
    }
    case 'close': {
      if (!open) fail(400, 'Nenhum caixa aberto');
      const expected = round2(open!.movements.filter((m) => m.method === 'DINHEIRO' || m.type !== 'VENDA').reduce((a, m) => a + m.amount, 0));
      await prisma.cashMovement.create({ data: { sessionId: open!.id, type: 'FECHAMENTO', amount: 0, notes: `Contado: ${amount.toFixed(2)} | Esperado: ${expected.toFixed(2)} | Diferença: ${(amount - expected).toFixed(2)}` } });
      return prisma.cashSession.update({ where: { id: open!.id }, data: { status: 'FECHADO', closedAt: new Date(), closingAmount: amount, expectedAmount: expected } });
    }
    default:
      fail(400, 'Ação inválida');
  }
});
