/**
 * Produção: ordens de produção a partir da ficha técnica (composição),
 * baixa de matérias-primas e entrada do produto acabado com custo apurado.
 */
import { prisma } from '@/lib/db';
import { round2, round3 } from '@/lib/utils';
import { fail } from '../errors';
import { nextNumber } from '../sequence';
import { emit } from '../events';
import { moveStock } from './stock';
import type { Actor } from './sales';

export async function createProductionOrder(actor: Actor, input: { productId: string; quantity: number; startDate?: string; dueDate?: string | null; warehouseId?: string | null; responsible?: string | null; notes?: string | null; lotNumber?: string | null }) {
  const product = await prisma.product.findFirst({ where: { id: input.productId, organizationId: actor.orgId }, include: { components: { include: { component: true } } } });
  if (!product) fail(404, 'Produto não encontrado');
  if (!product!.components.length) fail(400, 'Produto sem ficha técnica (composição). Cadastre os componentes no produto.');
  const qty = round3(Number(input.quantity));
  if (qty <= 0) fail(400, 'Quantidade inválida');
  const number = await nextNumber(prisma, actor.companyId, 'ORDEM_PRODUCAO', 1);
  return prisma.productionOrder.create({
    data: {
      companyId: actor.companyId,
      number,
      productId: product!.id,
      quantity: qty,
      startDate: input.startDate ? new Date(input.startDate) : new Date(),
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      warehouseId: input.warehouseId || null,
      responsible: input.responsible || null,
      notes: input.notes || null,
      lotNumber: input.lotNumber || null,
      totalCost: round2(product!.components.reduce((a, c) => a + c.quantity * qty * c.component.costPrice, 0)),
      items: { create: product!.components.map((c) => ({ componentId: c.componentId, description: c.component.name, requiredQty: round3(c.quantity * qty), unitCost: c.component.costPrice })) },
    },
    include: { items: true },
  });
}

export async function startProduction(actor: Actor, id: string) {
  const op = await prisma.productionOrder.findFirst({ where: { id, companyId: actor.companyId } });
  if (!op) fail(404, 'Ordem de produção não encontrada');
  if (op!.status !== 'PLANEJADA') fail(400, 'Somente ordens planejadas podem ser iniciadas');
  await prisma.productionOrder.update({ where: { id }, data: { status: 'EM_PRODUCAO', startDate: new Date() } });
  await emit('production.started', { ...actor, productionOrderId: id });
}

/** Finaliza: baixa componentes proporcionalmente e dá entrada no acabado */
export async function finishProduction(actor: Actor, id: string, producedQty?: number) {
  const op = await prisma.productionOrder.findFirst({ where: { id, companyId: actor.companyId }, include: { items: true } });
  if (!op) fail(404, 'Ordem de produção não encontrada');
  if (!['PLANEJADA', 'EM_PRODUCAO'].includes(op!.status)) fail(400, 'Ordem já finalizada ou cancelada');
  const produced = round3(producedQty ?? op!.quantity);
  const ratio = produced / op!.quantity;
  const changed: string[] = [];
  let totalCost = 0;
  await prisma.$transaction(async (tx) => {
    for (const it of op!.items) {
      const consumed = round3(it.requiredQty * ratio);
      const comp = await tx.product.findUnique({ where: { id: it.componentId } });
      totalCost += consumed * (comp?.costPrice || it.unitCost);
      changed.push(...(await moveStock(tx, { companyId: actor.companyId, productId: it.componentId, warehouseId: op!.warehouseId, quantity: consumed, direction: 'OUT', origin: 'PRODUCAO', originId: op!.id, originLabel: `OP nº ${op!.number} (consumo)`, userName: actor.userName })));
      await tx.productionOrderItem.update({ where: { id: it.id }, data: { consumedQty: consumed } });
    }
    const unitCost = round2(totalCost / produced);
    changed.push(...(await moveStock(tx, { companyId: actor.companyId, productId: op!.productId, warehouseId: op!.warehouseId, quantity: produced, direction: 'IN', origin: 'PRODUCAO', originId: op!.id, originLabel: `OP nº ${op!.number} (produto acabado)`, unitCost, lotNumber: op!.lotNumber || `OP${op!.number}`, userName: actor.userName })));
    await tx.productionOrder.update({ where: { id }, data: { status: 'FINALIZADA', producedQty: produced, finishedAt: new Date(), totalCost: round2(totalCost) } });
  });
  await emit('production.finished', { ...actor, productionOrderId: id, unitCost: round2(totalCost / produced) });
  await emit('stock.changed', { ...actor, productIds: [...new Set(changed)] });
  return prisma.productionOrder.findUnique({ where: { id }, include: { items: true } });
}
