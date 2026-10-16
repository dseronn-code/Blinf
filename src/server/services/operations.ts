/**
 * Operações complementares de estoque, vendas, logística e loja:
 * - Inventário por sessão de contagem (com bipagem) e ajuste automático
 * - Desmembramento de pedido (faturamento parcial / pendência de entrega)
 * - Volumes por envio
 * - Cupons de desconto e frete grátis por região na loja virtual
 * - Leitura de etiqueta de balança (EAN-13 iniciado em 2)
 */
import { prisma } from '@/lib/db';
import { round2, round3 } from '@/lib/utils';
import { fail } from '../errors';
import { nextNumber } from '../sequence';
import { emit } from '../events';
import { adjustStock, getAvailability } from './stock';
import { createOrder, updateOrder, type Actor } from './sales';

// ---------------------------------------------------------------------------
// Inventário
// ---------------------------------------------------------------------------
export async function createInventoryCount(actor: Actor, input: { warehouseId: string; categoryId?: string | null; productIds?: string[]; notes?: string }) {
  const wh = await prisma.warehouse.findFirst({ where: { id: input.warehouseId, companyId: actor.companyId } });
  if (!wh) fail(400, 'Depósito inválido');
  const open = await prisma.inventoryCount.findFirst({ where: { companyId: actor.companyId, warehouseId: wh!.id, status: 'ABERTO' } });
  if (open) fail(400, `Já existe o inventário nº ${open.number} em aberto para este depósito`);
  const products = await prisma.product.findMany({
    where: { organizationId: actor.orgId, active: true, controlsStock: true, kind: { notIn: ['KIT', 'VARIACAO_PAI'] }, ...(input.categoryId ? { categoryId: input.categoryId } : {}), ...(input.productIds?.length ? { id: { in: input.productIds } } : {}) },
    include: { balances: { where: { warehouseId: wh!.id } } },
    orderBy: [{ location: 'asc' }, { name: 'asc' }],
  });
  if (!products.length) fail(400, 'Nenhum produto para contar');
  const number = await nextNumber(prisma, actor.companyId, 'INVENTARIO', 1);
  return prisma.inventoryCount.create({
    data: { companyId: actor.companyId, number, warehouseId: wh!.id, notes: input.notes || null, userName: actor.userName, items: { create: products.map((p) => ({ productId: p.id, expected: p.balances[0]?.quantity ?? 0 })) } },
    include: { items: true },
  });
}

export async function countScan(actor: Actor, id: string, code: string, quantity = 1) {
  const c = await prisma.inventoryCount.findFirst({ where: { id, companyId: actor.companyId, status: 'ABERTO' }, include: { items: true } });
  if (!c) fail(404, 'Inventário não encontrado ou encerrado');
  const p = await prisma.product.findFirst({ where: { organizationId: actor.orgId, OR: [{ sku: code }, { gtin: code }] } });
  if (!p) fail(400, `Código ${code} não encontrado`);
  let item = c!.items.find((i) => i.productId === p!.id);
  if (!item) {
    const bal = await prisma.stockBalance.findUnique({ where: { productId_warehouseId: { productId: p!.id, warehouseId: c!.warehouseId } } });
    item = await prisma.inventoryCountItem.create({ data: { countId: c!.id, productId: p!.id, expected: bal?.quantity ?? 0 } });
  }
  return prisma.inventoryCountItem.update({ where: { id: item.id }, data: { counted: round3((item.counted || 0) + quantity) } });
}

export async function setCounts(actor: Actor, id: string, items: { productId: string; counted: number | null }[]) {
  const c = await prisma.inventoryCount.findFirst({ where: { id, companyId: actor.companyId, status: 'ABERTO' } });
  if (!c) fail(404, 'Inventário não encontrado ou encerrado');
  for (const it of items) await prisma.inventoryCountItem.updateMany({ where: { countId: id, productId: it.productId }, data: { counted: it.counted === null || (it.counted as unknown) === '' ? null : Number(it.counted) } });
  return { ok: true };
}

/** Encerra o inventário: ajusta o saldo dos itens contados (não contados permanecem como estão, ou zera se pedido) */
export async function finishInventoryCount(actor: Actor, id: string, opts: { zeroNotCounted?: boolean } = {}) {
  const c = await prisma.inventoryCount.findFirst({ where: { id, companyId: actor.companyId, status: 'ABERTO' }, include: { items: true } });
  if (!c) fail(404, 'Inventário não encontrado ou encerrado');
  const changed: string[] = [];
  let adjusted = 0;
  await prisma.$transaction(async (tx) => {
    for (const it of c!.items) {
      const counted = it.counted ?? (opts.zeroNotCounted ? 0 : null);
      if (counted === null) continue;
      const r = await adjustStock(tx, { companyId: actor.companyId, productId: it.productId, warehouseId: c!.warehouseId, newQuantity: counted, notes: `Inventário nº ${c!.number}: esperado ${it.expected}, contado ${counted}`, userName: actor.userName });
      if (r.length) adjusted++;
      changed.push(...r);
    }
    await tx.inventoryCount.update({ where: { id }, data: { status: 'CONCLUIDO', finishedAt: new Date() } });
  }, { timeout: 60000 });
  if (changed.length) await emit('stock.changed', { ...actor, productIds: [...new Set(changed)] });
  await emit('inventory.finished', { ...actor, inventoryId: id });
  return { adjusted };
}

// ---------------------------------------------------------------------------
// Desmembramento de pedido
// ---------------------------------------------------------------------------
/** Move as quantidades informadas para um novo pedido (o original fica com o restante) */
export async function splitOrder(actor: Actor, orderId: string, moves: { itemId: string; quantity: number }[]) {
  const o = await prisma.salesOrder.findFirst({ where: { id: orderId, companyId: actor.companyId }, include: { items: true } });
  if (!o) fail(404, 'Pedido não encontrado');
  if (o!.status !== 'ABERTO') fail(400, 'Somente pedidos em aberto podem ser desmembrados');
  const moved = [];
  const remaining = [];
  for (const it of o!.items) {
    const q = Math.min(Number(moves.find((m) => m.itemId === it.id)?.quantity || 0), it.quantity);
    const unitDiscount = it.quantity ? it.discount / it.quantity : 0;
    if (q > 0) moved.push({ productId: it.productId, serviceId: it.serviceId, description: it.description, quantity: q, unitPrice: it.unitPrice, discount: round2(unitDiscount * q) });
    if (it.quantity - q > 0) remaining.push({ productId: it.productId, serviceId: it.serviceId, description: it.description, quantity: round3(it.quantity - q), unitPrice: it.unitPrice, discount: round2(unitDiscount * (it.quantity - q)) });
  }
  if (!moved.length) fail(400, 'Informe as quantidades a desmembrar');
  if (!remaining.length) fail(400, 'O pedido original ficaria vazio — use o pedido inteiro');
  const ratio = moved.reduce((a, i) => a + i.quantity * i.unitPrice, 0) / o!.subtotal;
  const base = { customerId: o!.customerId, sellerId: o!.sellerId, priceListId: o!.priceListId, warehouseId: o!.warehouseId, paymentMethod: o!.paymentMethod, installments: o!.installments, paymentTermDays: o!.paymentTermDays, carrier: o!.carrier, shippingService: o!.shippingService };
  await updateOrder(actor, o!.id, { ...base, items: remaining, discount: round2(o!.discount * (1 - ratio)), freight: o!.freight, otherCosts: o!.otherCosts, notes: o!.notes, internalNotes: `${o!.internalNotes || ''} Pedido desmembrado.`.trim() });
  const child = await createOrder(actor, { ...base, channelId: o!.channelId, externalId: o!.externalId, origin: o!.origin, items: moved, discount: round2(o!.discount * ratio), shipTo: o!.shipTo, notes: o!.notes, internalNotes: `Desmembrado do pedido nº ${o!.number} (entrega parcial / pendência).` });
  await prisma.salesOrder.update({ where: { id: child.id }, data: { parentOrderId: o!.id } });
  return child;
}

// ---------------------------------------------------------------------------
// Volumes
// ---------------------------------------------------------------------------
export async function setShipmentVolumes(actor: Actor, shipmentId: string, volumes: number, weight?: number) {
  const s = await prisma.shipment.findFirst({ where: { id: shipmentId, companyId: actor.companyId } });
  if (!s) fail(404, 'Envio não encontrado');
  if (!(volumes >= 1 && volumes <= 99)) fail(400, 'Quantidade de volumes inválida (1 a 99)');
  return prisma.shipment.update({ where: { id: shipmentId }, data: { volumes: Math.floor(volumes), ...(weight ? { weight: Number(weight) } : {}) } });
}

// ---------------------------------------------------------------------------
// Cupons e frete grátis
// ---------------------------------------------------------------------------
export async function evaluateCoupon(companyId: string, code: string | null | undefined, subtotal: number) {
  if (!code) return null;
  const c = await prisma.coupon.findUnique({ where: { companyId_code: { companyId, code: code.trim().toUpperCase() } } });
  if (!c || !c.active) fail(400, 'Cupom inválido');
  if (c!.validUntil && c!.validUntil < new Date()) fail(400, 'Cupom expirado');
  if (c!.maxUses && c!.uses >= c!.maxUses) fail(400, 'Cupom esgotado');
  if (subtotal < c!.minAmount) fail(400, `Cupom válido para compras acima de R$ ${c!.minAmount.toFixed(2)}`);
  const discount = c!.type === 'PERCENTUAL' ? round2((subtotal * c!.value) / 100) : c!.type === 'VALOR' ? Math.min(c!.value, subtotal) : 0;
  return { coupon: c!, discount, freeShipping: c!.type === 'FRETE_GRATIS' };
}

// ---------------------------------------------------------------------------
// PDV: código de barras / etiqueta de balança
// ---------------------------------------------------------------------------
/**
 * Resolve um código lido no PDV. Etiquetas de balança (EAN-13 "2CCCCCVVVVVVD"):
 * 5 dígitos do código do produto (scaleCode) + 6 dígitos do valor total em centavos.
 * A quantidade (peso) é calculada pelo preço por kg do produto.
 */
export async function lookupPdvCode(actor: Actor, raw: string) {
  const code = raw.trim();
  if (/^2\d{12}$/.test(code)) {
    const scale = code.slice(1, 6);
    const value = Number(code.slice(6, 12)) / 100;
    const p = await prisma.product.findFirst({ where: { organizationId: actor.orgId, scaleCode: scale } });
    if (p && p.price > 0) {
      const av = await getAvailability(prisma, actor, [p.id]);
      return { product: { ...p, stock: av.get(p.id) }, quantity: round3(value / p.price), scale: true, value };
    }
  }
  const p = await prisma.product.findFirst({ where: { organizationId: actor.orgId, kind: { not: 'VARIACAO_PAI' }, OR: [{ gtin: code }, { sku: { equals: code, mode: 'insensitive' } }] } });
  if (!p) return null;
  const av = await getAvailability(prisma, actor, [p.id]);
  return { product: { ...p, stock: av.get(p.id) }, quantity: 1, scale: false };
}
