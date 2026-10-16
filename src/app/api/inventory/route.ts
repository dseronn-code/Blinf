import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { createInventoryCount } from '@/server/services/operations';

/** Inventários (sessões de contagem de estoque) */
export const GET = route('estoque', 'view', async ({ ctx }) => {
  const rows = await prisma.inventoryCount.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { items: true } }, items: { select: { counted: true, expected: true } } } });
  const whs = await prisma.warehouse.findMany({ where: { companyId: ctx.companyId }, select: { id: true, name: true } });
  return rows.map(({ items, ...r }) => ({
    ...r,
    warehouse: whs.find((w) => w.id === r.warehouseId)?.name,
    counted: items.filter((i) => i.counted !== null).length,
    divergent: items.filter((i) => i.counted !== null && Math.abs((i.counted || 0) - i.expected) > 1e-9).length,
  }));
});

export const POST = route('estoque', 'edit', async ({ ctx, body }) => createInventoryCount(ctx, body));
