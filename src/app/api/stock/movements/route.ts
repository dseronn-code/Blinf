import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { moveStock, adjustStock, transferStock } from '@/server/services/stock';
import { emit } from '@/server/events';

export const GET = route('estoque', 'view', async ({ ctx, query }) => {
  const where: any = { companyId: ctx.consolidated ? { in: ctx.companyIds } : ctx.companyId };
  if (query.get('productId')) where.productId = query.get('productId');
  if (query.get('warehouseId')) where.warehouseId = query.get('warehouseId');
  if (query.get('type')) where.type = query.get('type');
  if (query.get('origin')) where.origin = query.get('origin');
  if (query.get('from') || query.get('to')) where.createdAt = { ...(query.get('from') ? { gte: new Date(query.get('from')!) } : {}), ...(query.get('to') ? { lte: new Date(query.get('to') + 'T23:59:59') } : {}) };
  const pageSize = Math.min(Number(query.get('pageSize')) || 100, 1000);
  const page = Math.max(Number(query.get('page')) || 1, 1);
  const [rows, total] = await Promise.all([prisma.stockMovement.findMany({ where, orderBy: { createdAt: 'desc' }, take: pageSize, skip: (page - 1) * pageSize }), prisma.stockMovement.count({ where })]);
  const products = await prisma.product.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.productId))] } }, select: { id: true, sku: true, name: true, unit: true } });
  const whs = await prisma.warehouse.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.warehouseId))] } }, select: { id: true, name: true } });
  return { rows: rows.map((r) => ({ ...r, product: products.find((p) => p.id === r.productId), warehouse: whs.find((w) => w.id === r.warehouseId)?.name })), total, page, pageSize };
});

/** Lançamento manual: ENTRADA | SAIDA | AJUSTE (balanço) | TRANSFERENCIA */
export const POST = route('estoque', 'edit', async ({ ctx, body }) => {
  const qty = Number(String(body.quantity ?? '').replace(',', '.'));
  if (!body.productId || !body.warehouseId) fail(400, 'Informe produto e depósito');
  const wh = await prisma.warehouse.findFirst({ where: { id: body.warehouseId, company: { organizationId: ctx.orgId } } });
  if (!wh) fail(400, 'Depósito inválido');
  let changed: string[] = [];
  await prisma.$transaction(async (tx) => {
    if (body.type === 'AJUSTE') {
      changed = await adjustStock(tx, { companyId: wh!.companyId, productId: body.productId, warehouseId: body.warehouseId, newQuantity: qty, notes: body.notes, userName: ctx.userName });
    } else if (body.type === 'TRANSFERENCIA') {
      if (!(qty > 0)) fail(400, 'Quantidade inválida');
      changed = await transferStock(tx, { companyId: ctx.companyId, productId: body.productId, fromWarehouseId: body.warehouseId, toWarehouseId: body.toWarehouseId, quantity: qty, notes: body.notes, userName: ctx.userName });
    } else {
      if (!(qty > 0)) fail(400, 'Quantidade inválida');
      changed = await moveStock(tx, {
        companyId: wh!.companyId, productId: body.productId, warehouseId: body.warehouseId, quantity: qty, direction: body.type === 'SAIDA' ? 'OUT' : 'IN',
        origin: 'MANUAL', unitCost: body.unitCost ? Number(body.unitCost) : undefined, lotNumber: body.lotNumber || null, expiresAt: body.expiresAt ? new Date(body.expiresAt) : null, notes: body.notes, userName: ctx.userName,
      });
    }
  });
  await emit('stock.changed', { companyId: ctx.companyId, orgId: ctx.orgId, productIds: changed, userName: ctx.userName });
  return { ok: true, changed };
});
