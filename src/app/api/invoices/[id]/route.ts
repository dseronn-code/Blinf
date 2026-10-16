import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';

export const GET = route('fiscal', 'view', async ({ ctx, params }) => {
  const inv = await prisma.invoice.findFirst({ where: { id: params.id, companyId: { in: ctx.companyIds } }, include: { items: true, events: { orderBy: { createdAt: 'asc' } } } });
  if (!inv) fail(404, 'Nota não encontrada');
  const order = inv!.salesOrderId ? await prisma.salesOrder.findUnique({ where: { id: inv!.salesOrderId }, select: { id: true, number: true } }) : null;
  return { ...inv, order };
});
