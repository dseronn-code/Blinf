import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { getAvailability, moveStock } from '@/server/services/stock';
import { saveProduct } from '@/server/services/products';
import { emit } from '@/server/events';

// Lista de produtos com saldo físico/reservado/disponível
export const GET = route('cadastros', 'view', async ({ ctx, query }) => {
  const q = query.get('q')?.trim();
  const sellable = query.get('sellable') === '1';
  const where: any = { organizationId: ctx.orgId };
  if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }, { gtin: q }];
  if (query.get('kind')) where.kind = query.get('kind');
  if (query.get('categoryId')) where.categoryId = query.get('categoryId');
  if (query.get('active')) where.active = query.get('active') === 'true';
  if (sellable) where.kind = { notIn: ['VARIACAO_PAI'] };
  else if (!q && !query.get('kind') && query.get('withVariations') !== '1') where.kind = { not: 'VARIACAO' };
  const pageSize = Math.min(Number(query.get('pageSize')) || 50, 500);
  const page = Math.max(Number(query.get('page')) || 1, 1);
  const [rows, total] = await Promise.all([
    prisma.product.findMany({ where, include: { category: { select: { name: true } }, _count: { select: { variations: true, components: true } } }, orderBy: { name: 'asc' }, take: pageSize, skip: (page - 1) * pageSize }),
    prisma.product.count({ where }),
  ]);
  const avail = await getAvailability(prisma, ctx, rows.map((r) => r.id));
  let out = rows.map((r) => ({ ...r, stock: avail.get(r.id) }));
  if (query.get('lowStock') === '1') out = out.filter((r) => r.minStock > 0 && (r.stock?.available ?? 0) < r.minStock);
  return { rows: out, total, page, pageSize };
});

export const POST = route('cadastros', 'edit', async ({ ctx, body }) => {
  const product = await saveProduct(ctx, body);
  if (body.initialStock?.quantity > 0) {
    const changed = await moveStock(prisma, { companyId: ctx.companyId, productId: product.id, warehouseId: body.initialStock.warehouseId, quantity: Number(body.initialStock.quantity), direction: 'IN', origin: 'INVENTARIO', notes: 'Saldo inicial no cadastro', unitCost: product.costPrice, userName: ctx.userName });
    await emit('stock.changed', { companyId: ctx.companyId, orgId: ctx.orgId, productIds: changed });
  }
  return product;
});
