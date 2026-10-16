import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { createProductionOrder } from '@/server/services/production';

export const GET = route('producao', 'view', async ({ ctx, query }) => {
  const where: any = { companyId: ctx.companyId };
  if (query.get('status')) where.status = query.get('status');
  const rows = await prisma.productionOrder.findMany({ where, include: { items: true }, orderBy: { number: 'desc' } });
  const products = await prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, sku: true, name: true, unit: true } });
  return { rows: rows.map((r) => ({ ...r, product: products.find((p) => p.id === r.productId) })) };
});
export const POST = route('producao', 'edit', async ({ ctx, body }) => createProductionOrder(ctx, body));
