import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';

export const GET = route('estoque', 'view', async ({ ctx, params }) => {
  const c = await prisma.inventoryCount.findFirst({ where: { id: params.id, companyId: ctx.companyId }, include: { items: true } });
  if (!c) fail(404, 'Inventário não encontrado');
  const products = await prisma.product.findMany({ where: { id: { in: c!.items.map((i) => i.productId) } }, select: { id: true, sku: true, name: true, gtin: true, unit: true, location: true, costPrice: true } });
  const wh = await prisma.warehouse.findUnique({ where: { id: c!.warehouseId }, select: { name: true } });
  const items = c!.items
    .map((i) => {
      const p = products.find((x) => x.id === i.productId);
      const diff = i.counted === null ? null : i.counted - i.expected;
      return { ...i, product: p, diff, diffValue: diff === null ? null : Math.round(diff * (p?.costPrice || 0) * 100) / 100 };
    })
    .sort((a, b) => (a.product?.location || '').localeCompare(b.product?.location || '') || (a.product?.name || '').localeCompare(b.product?.name || ''));
  return { ...c, warehouse: wh?.name, items };
});
