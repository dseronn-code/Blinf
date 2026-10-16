import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { getAvailability } from '@/server/services/stock';

/** Posição de estoque por produto e depósito (com situação: ruptura/baixo/excesso) */
export const GET = route('estoque', 'view', async ({ ctx, query }) => {
  const q = query.get('q')?.trim();
  const whFilter = query.get('warehouseId');
  const situation = query.get('situation');
  const warehouses = await prisma.warehouse.findMany({
    where: ctx.stockMode === 'UNIFICADO' || ctx.consolidated ? { company: { organizationId: ctx.orgId }, active: true } : { companyId: ctx.companyId, active: true },
    include: { company: { select: { tradeName: true } } },
    orderBy: { name: 'asc' },
  });
  const whIds = whFilter ? [whFilter] : warehouses.map((w) => w.id);
  const products = await prisma.product.findMany({
    where: {
      organizationId: ctx.orgId,
      controlsStock: true,
      kind: { notIn: ['VARIACAO_PAI', 'KIT'] },
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }, { gtin: q }] } : {}),
    },
    include: { balances: { where: { warehouseId: { in: whIds } } }, category: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  const avail = await getAvailability(prisma, ctx, products.map((p) => p.id));
  let rows = products.map((p) => {
    const quantity = p.balances.reduce((a, b) => a + b.quantity, 0);
    const reserved = p.balances.reduce((a, b) => a + b.reserved, 0);
    const available = whFilter ? quantity - reserved : avail.get(p.id)?.available ?? 0;
    const avgCost = p.balances.find((b) => b.avgCost)?.avgCost || p.costPrice;
    const status = available <= 0 ? 'RUPTURA' : p.minStock && available < p.minStock ? 'BAIXO' : p.maxStock && quantity > p.maxStock ? 'EXCESSO' : 'OK';
    return {
      id: p.id, sku: p.sku, name: p.name, unit: p.unit, kind: p.kind, category: p.category?.name, location: p.location, controlsLot: p.controlsLot, minStock: p.minStock, maxStock: p.maxStock, price: p.price,
      quantity, reserved, available, avgCost, value: Math.round(quantity * avgCost * 100) / 100, status,
      byWarehouse: Object.fromEntries(p.balances.map((b) => [b.warehouseId, { quantity: b.quantity, reserved: b.reserved }])),
    };
  });
  if (situation) rows = rows.filter((r) => r.status === situation);
  const totals = { items: rows.length, quantity: rows.reduce((a, r) => a + r.quantity, 0), value: Math.round(rows.reduce((a, r) => a + r.value, 0) * 100) / 100, ruptura: rows.filter((r) => r.status === 'RUPTURA').length, baixo: rows.filter((r) => r.status === 'BAIXO').length };
  return { rows, warehouses: warehouses.map((w) => ({ id: w.id, name: warehouses.length && ctx.stockMode === 'UNIFICADO' ? `${w.name} (${w.company.tradeName})` : w.name, isDefault: w.isDefault, companyId: w.companyId })), totals };
});
