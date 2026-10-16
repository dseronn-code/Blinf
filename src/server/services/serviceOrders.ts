/**
 * Ordens de serviço: abertura, execução (com histórico de status),
 * faturamento (NFS-e + contas a receber + baixa de peças).
 */
import { prisma } from '@/lib/db';
import { round2, round3, addDays } from '@/lib/utils';
import { fail } from '../errors';
import { nextNumber } from '../sequence';
import { emit } from '../events';
import { moveStock } from './stock';
import { createEntries } from './finance';
import { buildInvoice, transmitInvoice } from './fiscal';
import type { Actor } from './sales';

export const OS_STATUS = ['ABERTA', 'ORCAMENTO', 'APROVADA', 'EM_EXECUCAO', 'AGUARDANDO_PECA', 'CONCLUIDA', 'FATURADA', 'CANCELADA'];

export type ServiceOrderInput = {
  customerId: string;
  technicianId?: string | null;
  priority?: string;
  equipment?: string | null;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  accessories?: string | null;
  problem: string;
  diagnosis?: string | null;
  solution?: string | null;
  dueDate?: string | null;
  discount?: number;
  items: { kind: 'SERVICO' | 'PRODUTO'; productId?: string | null; serviceId?: string | null; description?: string; quantity: number; unitPrice: number }[];
};

async function resolveItems(items: ServiceOrderInput['items']) {
  const out = [];
  for (const it of items || []) {
    const quantity = round3(Number(it.quantity) || 0);
    if (!quantity) continue;
    let description = it.description || '';
    if (it.kind === 'SERVICO' && it.serviceId) description ||= (await prisma.service.findUnique({ where: { id: it.serviceId } }))?.name || 'Serviço';
    if (it.kind === 'PRODUTO' && it.productId) description ||= (await prisma.product.findUnique({ where: { id: it.productId } }))?.name || 'Peça';
    const unitPrice = round2(Number(it.unitPrice) || 0);
    out.push({ kind: it.kind, productId: it.kind === 'PRODUTO' ? it.productId || null : null, serviceId: it.kind === 'SERVICO' ? it.serviceId || null : null, description, quantity, unitPrice, total: round2(quantity * unitPrice) });
  }
  return out;
}

export async function saveServiceOrder(actor: Actor, input: ServiceOrderInput, id?: string) {
  const items = await resolveItems(input.items);
  const servicesTotal = round2(items.filter((i) => i.kind === 'SERVICO').reduce((a, i) => a + i.total, 0));
  const productsTotal = round2(items.filter((i) => i.kind === 'PRODUTO').reduce((a, i) => a + i.total, 0));
  const discount = round2(Number(input.discount) || 0);
  const data = {
    customerId: input.customerId,
    technicianId: input.technicianId || null,
    priority: input.priority || 'NORMAL',
    equipment: input.equipment || null,
    brand: input.brand || null,
    model: input.model || null,
    serialNumber: input.serialNumber || null,
    accessories: input.accessories || null,
    problem: input.problem,
    diagnosis: input.diagnosis || null,
    solution: input.solution || null,
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    servicesTotal,
    productsTotal,
    discount,
    total: round2(servicesTotal + productsTotal - discount),
  };
  if (id) {
    const os = await prisma.serviceOrder.findFirst({ where: { id, companyId: actor.companyId } });
    if (!os) fail(404, 'OS não encontrada');
    if (['FATURADA', 'CANCELADA'].includes(os!.status)) fail(400, 'OS faturada/cancelada não pode ser alterada');
    await prisma.serviceOrderItem.deleteMany({ where: { serviceOrderId: id } });
    return prisma.serviceOrder.update({ where: { id }, data: { ...data, items: { create: items } }, include: { items: true } });
  }
  const number = await nextNumber(prisma, actor.companyId, 'ORDEM_SERVICO', 1);
  return prisma.serviceOrder.create({
    data: { ...data, companyId: actor.companyId, number, items: { create: items }, history: { create: { status: 'ABERTA', description: 'Ordem de serviço aberta', userName: actor.userName } } },
    include: { items: true },
  });
}

export async function changeServiceOrderStatus(actor: Actor, id: string, status: string, note?: string) {
  if (!OS_STATUS.includes(status) || status === 'FATURADA') fail(400, 'Status inválido');
  const os = await prisma.serviceOrder.findFirst({ where: { id, companyId: actor.companyId } });
  if (!os) fail(404, 'OS não encontrada');
  if (['FATURADA', 'CANCELADA'].includes(os!.status)) fail(400, 'OS já encerrada');
  await prisma.serviceOrder.update({ where: { id }, data: { status, ...(status === 'CONCLUIDA' ? { finishedAt: new Date() } : {}) } });
  await prisma.serviceOrderHistory.create({ data: { serviceOrderId: id, status, description: note || `Status alterado para ${status}`, userName: actor.userName } });
  if (status === 'CONCLUIDA') await emit('service_order.finished', { ...actor, serviceOrderId: id });
}

/** Faturamento da OS: NFS-e dos serviços, baixa das peças e contas a receber */
export async function invoiceServiceOrder(actor: Actor, id: string, opts: { installments?: number; paymentMethod?: string; emitNfse?: boolean } = {}) {
  const os = await prisma.serviceOrder.findFirst({ where: { id, companyId: actor.companyId }, include: { items: true, customer: true } });
  if (!os) fail(404, 'OS não encontrada');
  const o = os!;
  if (o.status === 'FATURADA') fail(400, 'OS já faturada');
  if (o.status === 'CANCELADA') fail(400, 'OS cancelada');
  let invoiceId: string | null = null;
  const services = o.items.filter((i) => i.kind === 'SERVICO' && i.serviceId);
  if (opts.emitNfse !== false && services.length) {
    const ratio = o.servicesTotal + o.productsTotal ? o.servicesTotal / (o.servicesTotal + o.productsTotal) : 1;
    const inv = await buildInvoice(prisma, { companyId: actor.companyId, model: 'NFSE', customerId: o.customerId, items: services.map((s) => ({ serviceId: s.serviceId, description: s.description, quantity: s.quantity, unitPrice: s.unitPrice })), discount: round2(o.discount * ratio), serviceOrderId: o.id });
    const r = await transmitInvoice(actor.companyId, actor.orgId, inv.id, actor.userName);
    if (r?.status !== 'AUTORIZADA') fail(400, `NFS-e rejeitada: ${r?.rejectionReason}`);
    invoiceId = inv.id;
  }
  if (!o.stockPosted) {
    const changed: string[] = [];
    await prisma.$transaction(async (tx) => {
      for (const p of o.items.filter((i) => i.kind === 'PRODUTO' && i.productId)) {
        changed.push(...(await moveStock(tx, { companyId: actor.companyId, productId: p.productId!, quantity: p.quantity, direction: 'OUT', origin: 'OS', originId: o.id, originLabel: `OS nº ${o.number}`, userName: actor.userName })));
      }
    });
    if (changed.length) await emit('stock.changed', { ...actor, productIds: changed });
  }
  if (!o.financialPosted && o.total > 0) {
    await createEntries(prisma, {
      companyId: actor.companyId, type: 'RECEBER', description: `Ordem de serviço nº ${o.number}`, contactId: o.customerId, contactName: o.customer.name, total: o.total,
      installments: opts.installments || 1, firstDueDate: addDays(new Date(), 10), origin: 'OS', originId: o.id, chartAccountCode: '1.1.04', paymentMethod: opts.paymentMethod || 'PIX', documentNumber: `OS${o.number}`,
    });
  }
  await prisma.serviceOrder.update({ where: { id }, data: { status: 'FATURADA', invoiceId, stockPosted: true, financialPosted: true, finishedAt: o.finishedAt || new Date() } });
  await prisma.serviceOrderHistory.create({ data: { serviceOrderId: id, status: 'FATURADA', description: invoiceId ? 'OS faturada com emissão de NFS-e' : 'OS faturada', userName: actor.userName } });
  await emit('service_order.invoiced', { ...actor, serviceOrderId: id, invoiceId });
  return prisma.serviceOrder.findUnique({ where: { id }, include: { items: true, history: true } });
}
