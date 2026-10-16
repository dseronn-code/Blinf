/**
 * Vendas: preços por lista, pedidos de venda (ciclo completo), propostas
 * comerciais, comissões e faturamento em 1 clique.
 *
 * Ciclo do pedido: ABERTO → FATURADO → SEPARADO → ENVIADO → ENTREGUE (ou CANCELADO)
 * Efeitos colaterais (reserva, baixa de estoque, financeiro, comissão, etiqueta)
 * são executados pelas automações a partir dos eventos emitidos aqui — e também
 * podem ser acionados manualmente (funções idempotentes `post*`).
 */
import type { Db } from '@/lib/db';
import { prisma } from '@/lib/db';
import { addDays, round2, round3 } from '@/lib/utils';
import { fail } from '../errors';
import { nextNumber } from '../sequence';
import { emit } from '../events';
import { moveStock, reserveStock } from './stock';
import { cancelEntriesByOrigin, createEntries, defaultBankAccount, payEntry } from './finance';
import { buildInvoice, cancelInvoice, transmitInvoice, type InvoiceModel } from './fiscal';

export type Actor = { companyId: string; orgId: string; userName?: string };

/** Preço de um produto considerando lista de preço (fixo por item ou ajuste %) */
export async function resolvePrice(db: Db, productId: string, priceListId?: string | null, quantity = 1) {
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) return 0;
  if (!priceListId) return product.price;
  const list = await db.priceList.findUnique({ where: { id: priceListId }, include: { items: { where: { productId } } } });
  const now = new Date();
  if (!list || !list.active || (list.validFrom && list.validFrom > now) || (list.validUntil && list.validUntil < now) || quantity < (list.minQuantity || 0)) {
    return product.price;
  }
  const fixed = list.items[0]?.price ?? (product.parentId ? (await db.priceListItem.findFirst({ where: { priceListId, productId: product.parentId } }))?.price : undefined);
  if (fixed != null) return fixed;
  return round2(product.price * (1 + (list.adjustPercent || 0) / 100));
}

export type OrderItemInput = { productId?: string | null; serviceId?: string | null; description?: string; quantity: number; unitPrice?: number | null; discount?: number };
export type OrderInput = {
  customerId: string;
  sellerId?: string | null;
  channelId?: string | null;
  externalId?: string | null;
  origin?: string;
  date?: string | Date;
  expectedDate?: string | Date | null;
  priceListId?: string | null;
  warehouseId?: string | null;
  items: OrderItemInput[];
  discount?: number;
  freight?: number;
  otherCosts?: number;
  paymentMethod?: string;
  installments?: number;
  paymentTermDays?: number;
  paidOnCreate?: boolean;
  carrier?: string | null;
  shippingService?: string | null;
  shipTo?: unknown;
  notes?: string | null;
  internalNotes?: string | null;
  quoteId?: string | null;
  cashSessionId?: string | null;
};

async function buildItems(db: Db, items: OrderItemInput[], priceListId?: string | null) {
  const out = [];
  for (const it of items) {
    const quantity = round3(Number(it.quantity) || 0);
    if (quantity <= 0) continue;
    if (it.productId) {
      const p = await db.product.findUnique({ where: { id: it.productId }, include: { components: { include: { component: true } } } });
      if (!p) fail(400, 'Produto do item não encontrado');
      if (p!.kind === 'VARIACAO_PAI') fail(400, `Selecione uma variação do produto "${p!.name}"`);
      const unitPrice = it.unitPrice != null && it.unitPrice !== ('' as unknown) ? round2(Number(it.unitPrice)) : await resolvePrice(db, p!.id, priceListId, quantity);
      const discount = round2(Number(it.discount) || 0);
      const unitCost = p!.kind === 'KIT' ? round2(p!.components.reduce((a, c) => a + c.quantity * c.component.costPrice, 0)) : p!.costPrice;
      out.push({ productId: p!.id, serviceId: null, sku: p!.sku, description: it.description || p!.name, quantity, unitPrice, discount, total: round2(quantity * unitPrice - discount), unitCost });
    } else if (it.serviceId) {
      const s = await db.service.findUnique({ where: { id: it.serviceId } });
      if (!s) fail(400, 'Serviço do item não encontrado');
      const unitPrice = it.unitPrice != null ? round2(Number(it.unitPrice)) : s!.price;
      const discount = round2(Number(it.discount) || 0);
      out.push({ productId: null, serviceId: s!.id, sku: s!.code, description: it.description || s!.name, quantity, unitPrice, discount, total: round2(quantity * unitPrice - discount), unitCost: 0 });
    }
  }
  if (!out.length) fail(400, 'Informe ao menos um item com quantidade');
  return out;
}

function totals(items: { total: number; unitCost: number; quantity: number }[], input: Pick<OrderInput, 'discount' | 'freight' | 'otherCosts'>, feePercent = 0) {
  const subtotal = round2(items.reduce((a, i) => a + i.total, 0));
  const total = round2(subtotal - (Number(input.discount) || 0) + (Number(input.freight) || 0) + (Number(input.otherCosts) || 0));
  const totalCost = round2(items.reduce((a, i) => a + i.unitCost * i.quantity, 0));
  return { subtotal, total, totalCost, channelFee: round2((total * feePercent) / 100) };
}

export async function createOrder(actor: Actor, input: OrderInput) {
  const customer = await prisma.contact.findFirst({ where: { id: input.customerId, organizationId: actor.orgId } });
  if (!customer) fail(400, 'Cliente não encontrado');
  const priceListId = input.priceListId || customer!.priceListId || null;
  const channel = input.channelId ? await prisma.salesChannel.findUnique({ where: { id: input.channelId } }) : null;
  const order = await prisma.$transaction(async (tx) => {
    const items = await buildItems(tx, input.items, priceListId);
    const t = totals(items, input, channel?.feePercent || 0);
    if (input.paymentMethod !== 'DINHEIRO' && !input.paidOnCreate && customer!.creditLimit > 0) {
      // Limite de crédito: soma de recebíveis em aberto + este pedido
      const open = await tx.financialEntry.aggregate({ where: { companyId: actor.companyId, contactId: customer!.id, type: 'RECEBER', status: { in: ['ABERTO', 'PARCIAL'] } }, _sum: { amount: true, paidAmount: true } });
      const used = (open._sum.amount || 0) - (open._sum.paidAmount || 0);
      if (used + t.total > customer!.creditLimit) fail(400, `Limite de crédito excedido: utilizado ${used.toFixed(2)} + pedido ${t.total.toFixed(2)} > limite ${customer!.creditLimit.toFixed(2)}`);
    }
    const number = await nextNumber(tx, actor.companyId, 'PEDIDO_VENDA', 1);
    return tx.salesOrder.create({
      data: {
        companyId: actor.companyId,
        number,
        customerId: customer!.id,
        sellerId: input.sellerId || customer!.sellerId || null,
        channelId: input.channelId || null,
        externalId: input.externalId || null,
        origin: input.origin || 'MANUAL',
        date: input.date ? new Date(input.date) : new Date(),
        expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
        priceListId,
        warehouseId: input.warehouseId || channel?.warehouseId || null,
        discount: round2(Number(input.discount) || 0),
        freight: round2(Number(input.freight) || 0),
        otherCosts: round2(Number(input.otherCosts) || 0),
        ...t,
        paymentMethod: input.paymentMethod || 'BOLETO',
        installments: Math.max(1, Number(input.installments) || 1),
        paymentTermDays: Number(input.paymentTermDays ?? 30),
        paidOnCreate: !!input.paidOnCreate,
        carrier: input.carrier || null,
        shippingService: input.shippingService || null,
        shipTo: (input.shipTo as object) ?? {
          name: customer!.name, zip: customer!.zip, street: customer!.street, number: customer!.number, complement: customer!.complement,
          district: customer!.district, city: customer!.city, uf: customer!.uf,
        },
        notes: input.notes || null,
        internalNotes: input.internalNotes || null,
        quoteId: input.quoteId || null,
        cashSessionId: input.cashSessionId || null,
        items: { create: items },
      },
      include: { items: true },
    });
  });
  await emit('order.created', { ...actor, orderId: order.id, origin: order.origin, channelId: order.channelId });
  return order;
}

export async function updateOrder(actor: Actor, id: string, input: OrderInput) {
  const existing = await prisma.salesOrder.findFirst({ where: { id, companyId: actor.companyId }, include: { items: true } });
  if (!existing) fail(404, 'Pedido não encontrado');
  if (existing!.status !== 'ABERTO') fail(400, 'Somente pedidos em aberto podem ser alterados');
  const channel = existing!.channelId ? await prisma.salesChannel.findUnique({ where: { id: existing!.channelId } }) : null;
  const order = await prisma.$transaction(async (tx) => {
    const items = await buildItems(tx, input.items, input.priceListId ?? existing!.priceListId);
    const t = totals(items, input, channel?.feePercent || 0);
    // Reprocessa reservas: libera as antigas e reserva as novas
    if (existing!.stockReserved) {
      for (const it of existing!.items) if (it.productId) await reserveStock(tx, actor.companyId, it.productId, existing!.warehouseId, -it.quantity);
      for (const it of items) if (it.productId) await reserveStock(tx, actor.companyId, it.productId, input.warehouseId ?? existing!.warehouseId, it.quantity);
    }
    await tx.salesOrderItem.deleteMany({ where: { salesOrderId: id } });
    return tx.salesOrder.update({
      where: { id },
      data: {
        customerId: input.customerId,
        sellerId: input.sellerId || null,
        priceListId: input.priceListId || null,
        warehouseId: input.warehouseId || existing!.warehouseId,
        date: input.date ? new Date(input.date) : existing!.date,
        expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
        discount: round2(Number(input.discount) || 0),
        freight: round2(Number(input.freight) || 0),
        otherCosts: round2(Number(input.otherCosts) || 0),
        ...t,
        paymentMethod: input.paymentMethod || existing!.paymentMethod,
        installments: Math.max(1, Number(input.installments) || 1),
        paymentTermDays: Number(input.paymentTermDays ?? existing!.paymentTermDays),
        carrier: input.carrier ?? existing!.carrier,
        shippingService: input.shippingService ?? existing!.shippingService,
        notes: input.notes ?? null,
        internalNotes: input.internalNotes ?? null,
        items: { create: items },
      },
      include: { items: true },
    });
  });
  await emit('order.updated', { ...actor, orderId: id });
  if (existing!.stockReserved) await emit('stock.changed', { ...actor, productIds: [...new Set([...existing!.items, ...order.items].map((i) => i.productId).filter(Boolean))] });
  return order;
}

/** Reserva o estoque dos itens do pedido (idempotente) */
export async function reserveOrder(actor: Actor, orderId: string) {
  const order = await prisma.salesOrder.findFirst({ where: { id: orderId, companyId: actor.companyId }, include: { items: true } });
  if (!order || order.stockReserved || order.stockPosted || order.status === 'CANCELADO') return [];
  const changed: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const it of order.items) if (it.productId) changed.push(...(await reserveStock(tx, actor.companyId, it.productId, order.warehouseId, it.quantity)));
    await tx.salesOrder.update({ where: { id: orderId }, data: { stockReserved: true } });
  });
  return changed;
}

export async function releaseOrderReservation(actor: Actor, orderId: string) {
  const order = await prisma.salesOrder.findFirst({ where: { id: orderId, companyId: actor.companyId }, include: { items: true } });
  if (!order || !order.stockReserved) return [];
  const changed: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const it of order.items) if (it.productId) changed.push(...(await reserveStock(tx, actor.companyId, it.productId, order.warehouseId, -it.quantity)));
    await tx.salesOrder.update({ where: { id: orderId }, data: { stockReserved: false } });
  });
  return changed;
}

/** Baixa o estoque do pedido (consome a reserva). Idempotente. */
export async function postOrderStock(actor: Actor, orderId: string) {
  const order = await prisma.salesOrder.findFirst({ where: { id: orderId, companyId: actor.companyId }, include: { items: true } });
  if (!order) fail(404, 'Pedido não encontrado');
  if (order!.stockPosted || order!.status === 'CANCELADO') return [];
  const changed: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const it of order!.items) {
      if (!it.productId) continue;
      if (order!.stockReserved) await reserveStock(tx, actor.companyId, it.productId, order!.warehouseId, -it.quantity);
      changed.push(
        ...(await moveStock(tx, {
          companyId: actor.companyId,
          productId: it.productId,
          warehouseId: order!.warehouseId,
          quantity: it.quantity,
          direction: 'OUT',
          origin: order!.origin === 'PDV' ? 'PDV' : order!.origin === 'LOJA' ? 'LOJA' : order!.origin === 'INTEGRACAO' ? 'INTEGRACAO' : 'PEDIDO_VENDA',
          originId: order!.id,
          originLabel: `Pedido de venda nº ${order!.number}`,
          userName: actor.userName,
        })),
      );
    }
    await tx.salesOrder.update({ where: { id: orderId }, data: { stockPosted: true, stockReserved: false } });
  });
  return [...new Set(changed)];
}

/** Estorna a baixa de estoque (pedido cancelado após faturamento) */
export async function reverseOrderStock(actor: Actor, orderId: string) {
  const order = await prisma.salesOrder.findFirst({ where: { id: orderId, companyId: actor.companyId }, include: { items: true } });
  if (!order || !order.stockPosted) return [];
  const changed: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const it of order.items) {
      if (!it.productId) continue;
      changed.push(...(await moveStock(tx, { companyId: actor.companyId, productId: it.productId, warehouseId: order.warehouseId, quantity: it.quantity, direction: 'IN', type: 'ENTRADA', origin: 'ESTORNO', originId: order.id, originLabel: `Estorno do pedido nº ${order.number}`, userName: actor.userName })));
    }
    await tx.salesOrder.update({ where: { id: orderId }, data: { stockPosted: false } });
  });
  return changed;
}

const CHART_BY_ORIGIN: Record<string, string> = { PDV: '1.1.02', LOJA: '1.1.03', INTEGRACAO: '1.1.03' };

/** Lança as contas a receber do pedido (parcelas). Idempotente. */
export async function postOrderFinancial(actor: Actor, orderId: string) {
  const order = await prisma.salesOrder.findFirst({ where: { id: orderId, companyId: actor.companyId }, include: { customer: true, items: true } });
  if (!order) fail(404, 'Pedido não encontrado');
  if (order!.financialPosted || order!.status === 'CANCELADO' || order!.total <= 0) return [];
  const o = order!;
  const onlyServices = o.items.every((i) => i.serviceId);
  const entries = await prisma.$transaction(async (tx) => {
    const created = await createEntries(tx, {
      companyId: actor.companyId,
      type: 'RECEBER',
      description: `Pedido de venda nº ${o.number}${o.externalId ? ` (${o.externalId})` : ''}`,
      contactId: o.customerId,
      contactName: o.customer.name,
      total: o.total,
      installments: o.paidOnCreate ? 1 : o.installments,
      firstDueDate: o.paidOnCreate ? new Date() : addDays(o.date, o.paymentTermDays || 0),
      intervalDays: 30,
      origin: o.origin === 'PDV' ? 'PDV' : o.origin === 'LOJA' ? 'LOJA' : o.origin === 'INTEGRACAO' ? 'INTEGRACAO' : 'VENDA',
      originId: o.id,
      chartAccountCode: onlyServices ? '1.1.04' : CHART_BY_ORIGIN[o.origin] || '1.1.01',
      paymentMethod: o.paymentMethod,
      documentNumber: String(o.number),
      competenceDate: o.date,
    });
    // Tarifa do marketplace como conta a pagar
    if (o.channelFee > 0 && o.channelId) {
      const ch = await tx.salesChannel.findUnique({ where: { id: o.channelId } });
      await createEntries(tx, {
        companyId: actor.companyId, type: 'PAGAR', description: `Tarifa ${ch?.name || 'marketplace'} - pedido ${o.number}`, contactName: ch?.name, total: o.channelFee,
        firstDueDate: addDays(o.date, 15), origin: 'INTEGRACAO', originId: o.id, chartAccountCode: '2.1.05', paymentMethod: 'MARKETPLACE',
      });
    }
    await tx.salesOrder.update({ where: { id: orderId }, data: { financialPosted: true } });
    return created;
  });
  // Pagamento já capturado (PDV, loja com Pix/cartão, marketplace): baixa automática
  if (o.paidOnCreate) {
    // Cartão: o valor entra na conta de recebíveis da adquirente e é liquidado em D+1/D+30 (agenda de recebíveis)
    const bank = await defaultBankAccount(prisma, actor.companyId, o.paymentMethod === 'DINHEIRO' ? 'CAIXA' : o.paymentMethod.startsWith('CARTAO') && o.origin === 'PDV' ? 'CARTAO' : 'CONTA_DIGITAL');
    for (const e of entries) await payEntry(actor.companyId, actor.orgId, e.id, { bankAccountId: bank?.id, method: o.paymentMethod, userName: actor.userName });
  }
  return entries;
}

/** Calcula e registra a comissão do vendedor. Idempotente. */
export async function postCommission(actor: Actor, orderId: string) {
  const order = await prisma.salesOrder.findFirst({ where: { id: orderId, companyId: actor.companyId } });
  if (!order || order.commissionPosted || !order.sellerId) return null;
  const seller = await prisma.seller.findUnique({ where: { id: order.sellerId } });
  if (!seller || !seller.commissionRate) return null;
  const base = round2(order.subtotal - order.discount);
  const c = await prisma.commission.create({
    data: {
      companyId: actor.companyId,
      sellerId: seller.id,
      salesOrderId: order.id,
      orderNumber: order.number,
      baseAmount: base,
      rate: seller.commissionRate,
      amount: round2((base * seller.commissionRate) / 100),
      status: seller.commissionBase === 'FATURAMENTO' ? 'LIBERADA' : 'PENDENTE',
      releasedAt: seller.commissionBase === 'FATURAMENTO' ? new Date() : null,
    },
  });
  await prisma.salesOrder.update({ where: { id: orderId }, data: { commissionPosted: true } });
  return c;
}

/**
 * Faturamento em 1 clique: gera a NF-e (ou NFC-e/NFS-e), transmite à SEFAZ
 * simulada e, se autorizada, marca o pedido como FATURADO.
 */
export async function invoiceOrder(actor: Actor, orderId: string, opts: { model?: InvoiceModel; natureId?: string | null } = {}) {
  const order = await prisma.salesOrder.findFirst({ where: { id: orderId, companyId: actor.companyId }, include: { items: true } });
  if (!order) fail(404, 'Pedido não encontrado');
  const o = order!;
  if (o.status !== 'ABERTO') fail(400, `Pedido está "${o.status}" — somente pedidos em aberto podem ser faturados`);
  const hasProducts = o.items.some((i) => i.productId);
  const hasServices = o.items.some((i) => i.serviceId);
  const model: InvoiceModel = opts.model || (hasProducts ? (o.origin === 'PDV' ? 'NFCE' : 'NFE') : 'NFSE');
  const invoices = [];
  const models: InvoiceModel[] = model === 'NFSE' ? ['NFSE'] : hasServices ? [model, 'NFSE'] : [model];
  for (const m of models) {
    const items = o.items.filter((i) => (m === 'NFSE' ? i.serviceId : i.productId));
    const subtotal = items.reduce((a, i) => a + i.total, 0);
    const ratio = o.subtotal ? subtotal / o.subtotal : 1;
    const inv = await buildInvoice(prisma, {
      companyId: actor.companyId,
      model: m,
      natureId: m === model ? opts.natureId : null,
      customerId: o.customerId,
      items: items.map((i) => ({ productId: i.productId, serviceId: i.serviceId, description: i.description, quantity: i.quantity, unitPrice: round2(i.total / i.quantity) })),
      freight: m === 'NFSE' ? 0 : o.freight,
      discount: round2(o.discount * ratio),
      salesOrderId: o.id,
    });
    const result = await transmitInvoice(actor.companyId, actor.orgId, inv.id, actor.userName);
    invoices.push(result);
  }
  const main = invoices[0]!;
  if (main.status === 'AUTORIZADA') {
    await prisma.salesOrder.update({ where: { id: o.id }, data: { status: 'FATURADO', invoiceId: main.id, invoicedAt: new Date() } });
    await emit('order.invoiced', { ...actor, orderId: o.id, invoiceId: main.id });
  }
  return { order: await prisma.salesOrder.findUnique({ where: { id: o.id } }), invoices };
}

/** Fatura sem emissão de nota (ex.: venda informal / pedido interno) */
export async function markInvoicedWithoutNote(actor: Actor, orderId: string) {
  const o = await prisma.salesOrder.findFirst({ where: { id: orderId, companyId: actor.companyId } });
  if (!o) fail(404, 'Pedido não encontrado');
  if (o!.status !== 'ABERTO') fail(400, 'Pedido não está em aberto');
  await prisma.salesOrder.update({ where: { id: orderId }, data: { status: 'FATURADO', invoicedAt: new Date() } });
  await emit('order.invoiced', { ...actor, orderId, invoiceId: null });
}

export async function cancelOrder(actor: Actor, orderId: string, reason: string) {
  const o = await prisma.salesOrder.findFirst({ where: { id: orderId, companyId: actor.companyId } });
  if (!o) fail(404, 'Pedido não encontrado');
  if (o!.status === 'CANCELADO') fail(400, 'Pedido já cancelado');
  if (['ENVIADO', 'ENTREGUE'].includes(o!.status)) fail(400, 'Pedido já enviado — registre uma devolução');
  // Cancela notas autorizadas vinculadas
  const invs = await prisma.invoice.findMany({ where: { salesOrderId: orderId, status: 'AUTORIZADA' } });
  for (const inv of invs) await cancelInvoice(actor.companyId, actor.orgId, inv.id, reason || 'Cancelamento do pedido de venda solicitado pelo cliente', actor.userName);
  await prisma.salesOrder.update({ where: { id: orderId }, data: { status: 'CANCELADO', cancelledAt: new Date(), cancelReason: reason || null } });
  await prisma.shipment.updateMany({ where: { salesOrderId: orderId, status: { in: ['PENDENTE', 'ETIQUETA_GERADA'] } }, data: { status: 'CANCELADO' } });
  await emit('order.cancelled', { ...actor, orderId });
}

/** Reverte financeiro e comissões de um pedido cancelado */
export async function reverseOrderFinancial(actor: Actor, orderId: string) {
  const n = await cancelEntriesByOrigin(prisma, actor.companyId, ['VENDA', 'PDV', 'LOJA', 'INTEGRACAO', 'NFE'], orderId);
  await prisma.commission.updateMany({ where: { salesOrderId: orderId, status: { in: ['PENDENTE', 'LIBERADA'] } }, data: { status: 'CANCELADA' } });
  await prisma.salesOrder.update({ where: { id: orderId }, data: { financialPosted: false } });
  return n;
}

export async function setOrderStatus(actor: Actor, orderId: string, status: 'SEPARADO' | 'ENVIADO' | 'ENTREGUE') {
  const o = await prisma.salesOrder.findFirst({ where: { id: orderId, companyId: actor.companyId } });
  if (!o) fail(404, 'Pedido não encontrado');
  const flow = ['ABERTO', 'FATURADO', 'SEPARADO', 'ENVIADO', 'ENTREGUE'];
  if (o!.status === 'CANCELADO') fail(400, 'Pedido cancelado');
  if (flow.indexOf(status) <= flow.indexOf(o!.status)) return o;
  if (status === 'SEPARADO' && o!.status === 'ABERTO') fail(400, 'Fature o pedido antes da separação');
  const data: Record<string, unknown> = { status };
  if (status === 'SEPARADO') data.separatedAt = new Date();
  if (status === 'ENVIADO') data.shippedAt = new Date();
  if (status === 'ENTREGUE') data.deliveredAt = new Date();
  const updated = await prisma.salesOrder.update({ where: { id: orderId }, data });
  await emit(status === 'SEPARADO' ? 'order.separated' : status === 'ENVIADO' ? 'order.shipped' : 'order.delivered', { ...actor, orderId });
  return updated;
}

// ---------------------------------------------------------------------------
// Propostas comerciais / orçamentos
// ---------------------------------------------------------------------------
export type QuoteInput = Omit<OrderInput, 'origin'> & { validUntil?: string | null; paymentTerms?: string | null; deliveryTerms?: string | null; status?: string };

export async function saveQuote(actor: Actor, input: QuoteInput, id?: string) {
  const items = await buildItems(prisma, input.items, input.priceListId);
  const t = totals(items, input);
  const data = {
    customerId: input.customerId,
    sellerId: input.sellerId || null,
    priceListId: input.priceListId || null,
    validUntil: input.validUntil ? new Date(input.validUntil) : addDays(new Date(), 15),
    subtotal: t.subtotal,
    discount: round2(Number(input.discount) || 0),
    freight: round2(Number(input.freight) || 0),
    total: t.total,
    paymentTerms: input.paymentTerms || null,
    deliveryTerms: input.deliveryTerms || null,
    notes: input.notes || null,
    ...(input.status ? { status: input.status } : {}),
  };
  const itemRows = items.map(({ productId, serviceId, description, quantity, unitPrice, discount, total }) => ({ productId, serviceId, description, quantity, unitPrice, discount, total }));
  if (id) {
    const q = await prisma.quote.findFirst({ where: { id, companyId: actor.companyId } });
    if (!q) fail(404, 'Proposta não encontrada');
    if (q!.status === 'CONVERTIDA') fail(400, 'Proposta já convertida em pedido');
    await prisma.quoteItem.deleteMany({ where: { quoteId: id } });
    return prisma.quote.update({ where: { id }, data: { ...data, items: { create: itemRows } }, include: { items: true } });
  }
  const number = await nextNumber(prisma, actor.companyId, 'PROPOSTA', 1);
  return prisma.quote.create({ data: { ...data, companyId: actor.companyId, number, items: { create: itemRows } }, include: { items: true } });
}

export async function convertQuote(actor: Actor, quoteId: string) {
  const q = await prisma.quote.findFirst({ where: { id: quoteId, companyId: actor.companyId }, include: { items: true } });
  if (!q) fail(404, 'Proposta não encontrada');
  if (q!.status === 'CONVERTIDA' && q!.salesOrderId) return prisma.salesOrder.findUnique({ where: { id: q!.salesOrderId } });
  if (q!.status === 'RECUSADA') fail(400, 'Proposta recusada não pode ser convertida');
  const order = await createOrder(actor, {
    customerId: q!.customerId,
    sellerId: q!.sellerId,
    priceListId: q!.priceListId,
    origin: 'PROPOSTA',
    items: q!.items.map((i) => ({ productId: i.productId, serviceId: i.serviceId, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount })),
    discount: q!.discount,
    freight: q!.freight,
    notes: `Gerado a partir da proposta nº ${q!.number}. ${q!.notes || ''}`.trim(),
    quoteId: q!.id,
  });
  await prisma.quote.update({ where: { id: quoteId }, data: { status: 'CONVERTIDA', salesOrderId: order.id } });
  return order;
}

export async function approveQuote(actor: Actor, quoteId: string) {
  const q = await prisma.quote.findFirst({ where: { id: quoteId, companyId: actor.companyId } });
  if (!q) fail(404, 'Proposta não encontrada');
  await prisma.quote.update({ where: { id: quoteId }, data: { status: 'APROVADA' } });
  await emit('quote.approved', { ...actor, quoteId });
  return prisma.quote.findUnique({ where: { id: quoteId } });
}
