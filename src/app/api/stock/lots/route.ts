import { prisma } from '@/lib/db';
import { route } from '@/server/http';

export const GET = route('estoque', 'view', async ({ ctx, query }) => {
  const days = Number(query.get('expiringDays')) || 0;
  const lots = await prisma.productLot.findMany({
    where: { product: { organizationId: ctx.orgId }, quantity: query.get('all') ? undefined : { gt: 0 }, ...(days ? { expiresAt: { lte: new Date(Date.now() + days * 86400000) } } : {}) },
    include: { product: { select: { sku: true, name: true, unit: true } } },
    orderBy: [{ expiresAt: 'asc' }],
  });
  const whs = await prisma.warehouse.findMany({ where: { company: { organizationId: ctx.orgId } }, select: { id: true, name: true } });
  return { rows: lots.map((l) => ({ ...l, warehouse: whs.find((w) => w.id === l.warehouseId)?.name, daysToExpire: l.expiresAt ? Math.ceil((l.expiresAt.getTime() - Date.now()) / 86400000) : null })) };
});
