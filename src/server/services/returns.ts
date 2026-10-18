/**
 * Devoluções e trocas de venda:
 * - NF-e de devolução (finalidade 4) referenciando a nota original
 * - Retorno das mercadorias ao estoque (opcional por item)
 * - Estorno ao cliente (conta a pagar) ou abatimento dos títulos em aberto
 * - Ajuste proporcional da comissão do vendedor
 * - Troca: gera novo pedido com os itens de reposição
 */
import { prisma } from '@/lib/db';
import { round2 } from '@/lib/utils';
import { fail } from '../errors';
import { nextNumber } from '../sequence';
import { emit } from '../events';
import { moveStock } from './stock';
import { buildInvoice, transmitInvoice, requireRealFiscal } from './fiscal';
import { createEntries } from './finance';
import { createOrder, type Actor } from './sales';

export type ReturnInput = {
  salesOrderId: string;
  kind?: 'DEVOLUCAO' | 'TROCA';
  reason: string;
  refundMethod?: 'ESTORNO' | 'CREDITO' | 'NENHUM';
  items: { salesOrderItemId: string; quantity: number; restock?: boolean }[];
  emitInvoice?: boolean;
};

export async function returnedQuantities(salesOrderId: string) {
  const rows = await prisma.salesReturn.findMany({ where: { salesOrderId, status: { not: 'CANCELADA' } } });
  const map = new Map<string, number>();
  for (const r of rows) for (const it of r.items as { salesOrderItemId: string; quantity: number }[]) map.set(it.salesOrderItemId, (map.get(it.salesOrderItemId) || 0) + it.quantity);
  return map;
}

export async function createReturn(actor: Actor, input: ReturnInput) {
  const order = await prisma.salesOrder.findFirst({ where: { id: input.salesOrderId, companyId: actor.companyId }, include: { items: true, customer: true } });
  if (!order) fail(404, 'Pedido não encontrado');
  const o = order!;
  if (['ABERTO', 'CANCELADO'].includes(o.status)) fail(400, 'Somente pedidos faturados podem ter devolução (pedidos em aberto devem ser alterados ou cancelados)');
  if (!input.reason || input.reason.trim().length < 5) fail(400, 'Informe o motivo da devolução');
  const already = await returnedQuantities(o.id);
  const ratio = o.subtotal ? (o.subtotal - o.discount) / o.subtotal : 1;
  const lines: { salesOrderItemId: string; productId: string | null; serviceId: string | null; description: string; quantity: number; unitPrice: number; restock: boolean }[] = [];
  for (const it of input.items.filter((i) => Number(i.quantity) > 0)) {
    const item = o.items.find((x) => x.id === it.salesOrderItemId);
    if (!item) fail(400, 'Item inválido');
    const available = item!.quantity - (already.get(item!.id) || 0);
    if (Number(it.quantity) > available + 1e-9) fail(400, `Quantidade de "${item!.description}" excede o disponível para devolução (${available})`);
    const unitPrice = round2((item!.total / item!.quantity) * ratio);
    lines.push({ salesOrderItemId: item!.id, productId: item!.productId, serviceId: item!.serviceId, description: item!.description, quantity: Number(it.quantity), unitPrice, restock: it.restock !== false && !!item!.productId });
  }
  if (!lines.length) fail(400, 'Selecione ao menos um item');
  const total = round2(lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0));
  const kind = input.kind || 'DEVOLUCAO';
  const refundMethod = kind === 'TROCA' ? 'NENHUM' : input.refundMethod || 'ESTORNO';
  // NF-e de devolução sem emissor real (produção): bloqueia antes de registrar a devolução
  const original = await prisma.invoice.findFirst({ where: { salesOrderId: o.id, status: 'AUTORIZADA', model: { in: ['NFE', 'NFCE'] } } });
  const productLines = lines.filter((l) => l.productId);
  if (input.emitInvoice !== false && original?.accessKey && productLines.length) {
    const company = await prisma.company.findUnique({ where: { id: actor.companyId }, select: { fiscalProvider: true } });
    requireRealFiscal(company!, 'NF-e de devolução');
  }
  const number = await nextNumber(prisma, actor.companyId, 'DEVOLUCAO', 1);
  const ret = await prisma.salesReturn.create({ data: { companyId: actor.companyId, number, salesOrderId: o.id, kind, reason: input.reason, items: lines, total, refundMethod } });

  // 1) NF-e de devolução referenciando a nota original
  let invoiceId: string | null = null;
  if (input.emitInvoice !== false && original?.accessKey && productLines.length) {
    const inv = await buildInvoice(prisma, {
      companyId: actor.companyId, model: 'NFE', natureKind: 'DEVOLUCAO', customerId: o.customerId, refAccessKey: original.accessKey, returnId: ret.id,
      items: productLines.map((l) => ({ productId: l.productId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })),
      additionalInfo: `Devolução nº ${number} do pedido ${o.number}. Motivo: ${input.reason}.`,
    });
    const r = await transmitInvoice(actor.companyId, actor.orgId, inv.id, actor.userName);
    invoiceId = inv.id;
    if (r?.status !== 'AUTORIZADA') await prisma.salesReturn.update({ where: { id: ret.id }, data: { invoiceId } });
  }

  // 2) Retorno ao estoque
  const changed: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const l of lines.filter((x) => x.restock)) {
      changed.push(...(await moveStock(tx, { companyId: actor.companyId, productId: l.productId!, warehouseId: o.warehouseId, quantity: l.quantity, direction: 'IN', type: 'ENTRADA', origin: 'DEVOLUCAO', originId: ret.id, originLabel: `Devolução nº ${number} (pedido ${o.number})`, unitCost: o.items.find((i) => i.id === l.salesOrderItemId)?.unitCost, userName: actor.userName })));
    }
  });

  // 3) Financeiro
  let refundEntryId: string | null = null;
  let remaining = total;
  if (refundMethod === 'CREDITO') {
    const open = await prisma.financialEntry.findMany({ where: { companyId: actor.companyId, originId: o.id, type: 'RECEBER', status: { in: ['ABERTO', 'PARCIAL'] } }, orderBy: { dueDate: 'desc' } });
    for (const e of open) {
      if (remaining <= 0) break;
      const openValue = round2(e.amount - e.paidAmount);
      const cut = Math.min(openValue, remaining);
      const newAmount = round2(e.amount - cut);
      await prisma.financialEntry.update({ where: { id: e.id }, data: { amount: newAmount, status: newAmount - e.paidAmount <= 0.009 ? (e.paidAmount > 0 ? 'PAGO' : 'CANCELADO') : e.status, notes: `${e.notes || ''} Abatido R$ ${cut.toFixed(2)} pela devolução nº ${number}.`.trim() } });
      remaining = round2(remaining - cut);
    }
  }
  if (refundMethod !== 'NENHUM' && remaining > 0) {
    const [e] = await createEntries(prisma, {
      companyId: actor.companyId, type: 'PAGAR', description: `Estorno ao cliente - devolução nº ${number} (pedido ${o.number})`, contactId: o.customerId, contactName: o.customer.name,
      total: remaining, firstDueDate: new Date(), origin: 'DEVOLUCAO', originId: ret.id, chartAccountCode: '2.6.02', paymentMethod: o.paymentMethod === 'BOLETO' ? 'PIX' : o.paymentMethod,
    });
    refundEntryId = e.id;
  }

  // 4) Comissão proporcional
  const commission = await prisma.commission.findFirst({ where: { salesOrderId: o.id, status: { in: ['PENDENTE', 'LIBERADA'] } } });
  if (commission) {
    const cut = round2((total * commission.rate) / 100);
    await prisma.commission.update({ where: { id: commission.id }, data: { amount: Math.max(0, round2(commission.amount - cut)), baseAmount: Math.max(0, round2(commission.baseAmount - total)) } });
  }

  // 5) Troca: novo pedido com os mesmos itens (reposição), sem cobrança
  let exchangeOrderId: string | null = null;
  if (kind === 'TROCA') {
    const ex = await createOrder(actor, {
      customerId: o.customerId, sellerId: o.sellerId, warehouseId: o.warehouseId, origin: 'MANUAL', paymentMethod: o.paymentMethod,
      items: productLines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })), discount: total, shipTo: o.shipTo,
      notes: `Troca referente à devolução nº ${number} do pedido ${o.number}`, paidOnCreate: true,
    });
    exchangeOrderId = ex.id;
  }

  await prisma.salesReturn.update({ where: { id: ret.id }, data: { status: 'CONCLUIDA', finishedAt: new Date(), invoiceId, refundEntryId, exchangeOrderId } });
  if (changed.length) await emit('stock.changed', { ...actor, productIds: [...new Set(changed)] });
  await emit('order.returned', { ...actor, orderId: o.id, returnId: ret.id, total });
  return prisma.salesReturn.findUnique({ where: { id: ret.id } });
}
