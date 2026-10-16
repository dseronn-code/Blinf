import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { round2 } from '@/lib/utils';
import { createEntries } from '@/server/services/finance';

export const GET = route('vendas', 'view', async ({ ctx, query }) => {
  const where: any = { companyId: ctx.companyId };
  if (query.get('status')) where.status = query.get('status');
  if (query.get('sellerId')) where.sellerId = query.get('sellerId');
  const rows = await prisma.commission.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 });
  const sellers = await prisma.seller.findMany({ where: { organizationId: ctx.orgId } });
  const summary = sellers.map((s) => {
    const mine = rows.filter((r) => r.sellerId === s.id);
    return { sellerId: s.id, seller: s.name, rate: s.commissionRate, base: s.commissionBase, pending: round2(mine.filter((r) => r.status === 'PENDENTE').reduce((a, r) => a + r.amount, 0)), released: round2(mine.filter((r) => r.status === 'LIBERADA').reduce((a, r) => a + r.amount, 0)), paid: round2(mine.filter((r) => r.status === 'PAGA').reduce((a, r) => a + r.amount, 0)) };
  }).filter((s) => s.pending || s.released || s.paid);
  return { rows: rows.map((r) => ({ ...r, seller: sellers.find((s) => s.id === r.sellerId)?.name })), summary };
});

/** Fecha as comissões liberadas de um vendedor gerando conta a pagar */
export const POST = route('vendas', 'edit', async ({ ctx, body }) => {
  const list = await prisma.commission.findMany({ where: { companyId: ctx.companyId, sellerId: body.sellerId, status: 'LIBERADA' } });
  if (!list.length) fail(400, 'Nenhuma comissão liberada para este vendedor');
  const seller = await prisma.seller.findUnique({ where: { id: body.sellerId } });
  const total = round2(list.reduce((a, c) => a + c.amount, 0));
  const [entry] = await createEntries(prisma, { companyId: ctx.companyId, type: 'PAGAR', description: `Comissões ${seller?.name} (${list.length} pedidos)`, contactName: seller?.name, total, firstDueDate: new Date(), origin: 'COMISSAO', chartAccountCode: '2.3.03', paymentMethod: 'PIX' });
  await prisma.commission.updateMany({ where: { id: { in: list.map((c) => c.id) } }, data: { status: 'PAGA', paidAt: new Date(), payableId: entry.id } });
  return { ok: true, total, entryId: entry.id };
});
