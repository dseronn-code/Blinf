import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { getAvailability } from '@/server/services/stock';

export const GET = route('producao', 'view', async ({ ctx, params }) => {
  const op = await prisma.productionOrder.findFirst({ where: { id: params.id, companyId: ctx.companyId }, include: { items: true } });
  if (!op) fail(404, 'OP não encontrada');
  const product = await prisma.product.findUnique({ where: { id: op!.productId } });
  const avail = await getAvailability(prisma, ctx, op!.items.map((i) => i.componentId));
  const movements = await prisma.stockMovement.findMany({ where: { originId: op!.id } });
  return { ...op, product, items: op!.items.map((i) => ({ ...i, available: avail.get(i.componentId)?.available ?? 0 })), movements };
});
