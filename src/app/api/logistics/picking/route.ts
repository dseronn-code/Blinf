import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { setOrderStatus } from '@/server/services/sales';

/** Lista de separação (picking) consolidada dos pedidos faturados aguardando separação */
export const GET = route('logistica', 'view', async ({ ctx, query }) => {
  const ids = query.get('orderIds')?.split(',').filter(Boolean);
  const orders = await prisma.salesOrder.findMany({ where: { companyId: ctx.companyId, status: 'FATURADO', origin: { not: 'PDV' }, ...(ids ? { id: { in: ids } } : {}) }, include: { items: true, customer: { select: { name: true } }, shipments: { select: { id: true, trackingCode: true, carrier: true, service: true, status: true } } }, orderBy: { number: 'asc' } });
  const productIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.productId).filter(Boolean)))] as string[];
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, gtin: true, name: true, location: true, kind: true } });
  // Consolidação por produto e localização (rota de coleta)
  const map = new Map<string, { productId: string; sku: string; name: string; location: string | null; quantity: number; orders: number[] }>();
  for (const o of orders) for (const i of o.items) {
    if (!i.productId) continue;
    const p = products.find((x) => x.id === i.productId);
    const m = map.get(i.productId) || { productId: i.productId, sku: p?.sku || '', name: p?.name || i.description, location: p?.location || null, quantity: 0, orders: [] };
    m.quantity += i.quantity;
    m.orders.push(o.number);
    map.set(i.productId, m);
  }
  const pickList = [...map.values()].sort((a, b) => (a.location || 'ZZZ').localeCompare(b.location || 'ZZZ'));
  return { orders: orders.map((o) => ({ ...o, items: o.items.map((i) => ({ ...i, gtin: products.find((p) => p.id === i.productId)?.gtin })) })), pickList };
});

/**
 * Conferência de embalagem (packing): { orderId, code } bipa SKU/GTIN e
 * incrementa a quantidade conferida. Quando todos os itens conferem, o pedido
 * passa para SEPARADO (automação gera/garante a etiqueta).
 */
export const POST = route('logistica', 'edit', async ({ ctx, body }) => {
  const order = await prisma.salesOrder.findFirst({ where: { id: body.orderId, companyId: ctx.companyId }, include: { items: true } });
  if (!order) fail(404, 'Pedido não encontrado');
  if (order!.status !== 'FATURADO') fail(400, 'Pedido não está aguardando separação');
  if (body.reset) {
    await prisma.salesOrderItem.updateMany({ where: { salesOrderId: order!.id }, data: { packedQty: 0, pickedQty: 0 } });
    return { ok: true };
  }
  const code = String(body.code || '').trim();
  const products = await prisma.product.findMany({ where: { id: { in: order!.items.map((i) => i.productId).filter(Boolean) as string[] } } });
  const product = products.find((p) => p.sku.toLowerCase() === code.toLowerCase() || p.gtin === code);
  if (!product) fail(400, `Código "${code}" não pertence a este pedido`);
  const item = order!.items.find((i) => i.productId === product!.id && i.packedQty < i.quantity);
  if (!item) fail(400, `Quantidade de "${product!.name}" já conferida`);
  const qty = Math.min(Number(body.quantity) || 1, item!.quantity - item!.packedQty);
  await prisma.salesOrderItem.update({ where: { id: item!.id }, data: { packedQty: item!.packedQty + qty, pickedQty: item!.packedQty + qty } });
  const fresh = await prisma.salesOrderItem.findMany({ where: { salesOrderId: order!.id } });
  const done = fresh.filter((i) => i.productId).every((i) => i.packedQty >= i.quantity);
  if (done) await setOrderStatus(ctx, order!.id, 'SEPARADO');
  return { ok: true, done, items: fresh };
});
