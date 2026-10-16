/**
 * Logística (SIMULADA): cotação de frete Correios / Melhor Envio / GestãoPro
 * Envios, geração de etiqueta com código de rastreio no padrão UPU, eventos
 * de rastreamento e conferência de separação (picking/packing).
 */
import { prisma } from '@/lib/db';
import { round2, onlyDigits, addDays } from '@/lib/utils';
import { buildTrackingCode, cepRegion } from '@/lib/br';
import { fail } from '../errors';
import { emit } from '../events';
import type { Actor } from './sales';

export type FreightOption = { provider: string; carrier: string; service: string; price: number; deadlineDays: number; simulated: true };

export function quoteFreight(p: { fromZip: string; toZip: string; weight: number; height?: number; width?: number; length?: number; value?: number }): FreightOption[] {
  const from = onlyDigits(p.fromZip || '01000000');
  const to = onlyDigits(p.toZip || '01000000');
  const sameState = from.slice(0, 2) === to.slice(0, 2);
  const dist = sameState ? 0 : Math.abs(cepRegion(from) - cepRegion(to)) + 1;
  const cubic = ((p.height || 10) * (p.width || 15) * (p.length || 20)) / 6000;
  const kg = Math.max(p.weight || 0.3, cubic, 0.3);
  const insurance = (p.value || 0) * 0.005;
  const base = (fixed: number, perKg: number, perDist: number, factor = 1) => round2((fixed + perKg * kg + perDist * dist + insurance) * factor);
  const opts: FreightOption[] = [
    { provider: 'CORREIOS', carrier: 'Correios', service: 'PAC', price: base(19.9, 4.2, 3.4), deadlineDays: 4 + dist * 1.5, simulated: true },
    { provider: 'CORREIOS', carrier: 'Correios', service: 'SEDEX', price: base(27.5, 6.8, 4.9), deadlineDays: 1 + Math.ceil(dist / 2), simulated: true },
    { provider: 'MELHOR_ENVIO', carrier: 'Jadlog', service: '.Package', price: base(16.4, 3.9, 3.1), deadlineDays: 5 + dist, simulated: true },
    { provider: 'MELHOR_ENVIO', carrier: 'Loggi', service: 'Loggi Express', price: base(14.9, 3.6, 3.8), deadlineDays: 3 + dist, simulated: true },
    { provider: 'MELHOR_ENVIO', carrier: 'J&T Express', service: 'Standard', price: base(15.5, 3.4, 3.2), deadlineDays: 5 + dist, simulated: true },
    { provider: 'MELHOR_ENVIO', carrier: 'Azul Cargo Express', service: 'Amanhã', price: base(29.9, 5.5, 4.0), deadlineDays: 1 + Math.ceil(dist / 3), simulated: true },
    { provider: 'GESTAO_ENVIOS', carrier: 'Correios', service: 'PAC (GestãoPro Envios)', price: base(19.9, 4.2, 3.4, 0.68), deadlineDays: 4 + dist * 1.5, simulated: true },
    { provider: 'GESTAO_ENVIOS', carrier: 'Correios', service: 'SEDEX (GestãoPro Envios)', price: base(27.5, 6.8, 4.9, 0.7), deadlineDays: 1 + Math.ceil(dist / 2), simulated: true },
  ];
  return opts.map((o) => ({ ...o, deadlineDays: Math.round(o.deadlineDays) })).sort((a, b) => a.price - b.price);
}

/** Peso/dimensões do pedido a partir dos produtos */
export async function orderPackage(orderId: string) {
  const order = await prisma.salesOrder.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) fail(404, 'Pedido não encontrado');
  const ids = order!.items.map((i) => i.productId).filter(Boolean) as string[];
  const products = await prisma.product.findMany({ where: { id: { in: ids } } });
  let weight = 0, height = 2, width = 11, length = 16, volume = 0;
  for (const it of order!.items) {
    const p = products.find((x) => x.id === it.productId);
    if (!p) continue;
    weight += p.weight * it.quantity;
    volume += p.width * p.height * p.length * it.quantity;
    width = Math.max(width, p.width);
    length = Math.max(length, p.length);
  }
  height = Math.max(2, Math.ceil(volume / (width * length)));
  return { order: order!, weight: round2(Math.max(weight, 0.1)), height, width, length };
}

export async function createShipment(actor: Actor, orderId: string, choice?: { provider: string; carrier: string; service: string } | null) {
  const existing = await prisma.shipment.findFirst({ where: { salesOrderId: orderId, status: { not: 'CANCELADO' } } });
  if (existing) return existing;
  const { order, ...pkg } = await orderPackage(orderId);
  if (order.companyId !== actor.companyId) fail(404, 'Pedido não encontrado');
  if (order.origin === 'PDV') return null; // Venda balcão não gera envio
  if (!order.items.some((i) => i.productId)) return null;
  const company = await prisma.company.findUnique({ where: { id: actor.companyId } });
  const shipTo = (order.shipTo || {}) as { zip?: string };
  const options = quoteFreight({ fromZip: company?.zip || '01000000', toZip: shipTo.zip || '01000000', ...pkg, value: order.total });
  const preferred =
    (choice && options.find((o) => o.provider === choice.provider && o.service === choice.service)) ||
    (order.shippingService && options.find((o) => o.service.startsWith(order.shippingService!))) ||
    options[0];
  const prefix = preferred.carrier === 'Correios' ? (preferred.service.startsWith('SEDEX') ? 'QB' : 'PN') : preferred.carrier.slice(0, 2).toUpperCase().replace(/[^A-Z]/g, 'X');
  const trackingCode = preferred.carrier === 'Correios' ? buildTrackingCode(prefix) : `${prefix}${Date.now().toString().slice(-10)}`;
  const shipment = await prisma.shipment.create({
    data: {
      companyId: actor.companyId,
      salesOrderId: orderId,
      provider: preferred.provider,
      carrier: preferred.carrier,
      service: preferred.service,
      price: preferred.price,
      deadlineDays: preferred.deadlineDays,
      ...pkg,
      trackingCode,
      status: 'ETIQUETA_GERADA',
      labelAt: new Date(),
      events: [{ date: new Date().toISOString(), status: 'ETIQUETA_GERADA', description: 'Etiqueta gerada — objeto aguardando postagem', location: company?.city || '' }],
    },
  });
  await prisma.salesOrder.update({ where: { id: orderId }, data: { carrier: preferred.carrier, shippingService: preferred.service } });
  await emit('shipment.label_created', { ...actor, shipmentId: shipment.id, orderId });
  return shipment;
}

const TRACK_FLOW = [
  { status: 'POSTADO', description: 'Objeto postado' },
  { status: 'EM_TRANSITO', description: 'Objeto em trânsito - por favor aguarde' },
  { status: 'SAIU_PARA_ENTREGA', description: 'Objeto saiu para entrega ao destinatário' },
  { status: 'ENTREGUE', description: 'Objeto entregue ao destinatário' },
];

/** Avança o rastreio para o próximo status (simulação dos eventos da transportadora) */
export async function advanceTracking(actor: Actor, shipmentId: string) {
  const s = await prisma.shipment.findFirst({ where: { id: shipmentId, companyId: actor.companyId }, include: { salesOrder: true } });
  if (!s) fail(404, 'Envio não encontrado');
  const order = ['ETIQUETA_GERADA', ...TRACK_FLOW.map((t) => t.status)];
  const idx = order.indexOf(s!.status);
  if (idx < 0 || idx >= order.length - 1) return s;
  const next = TRACK_FLOW[idx];
  const shipTo = (s!.salesOrder.shipTo || {}) as { city?: string; uf?: string };
  const location = next.status === 'POSTADO' ? 'Agência de origem' : next.status === 'EM_TRANSITO' ? 'Centro de distribuição' : `${shipTo.city || ''}/${shipTo.uf || ''}`;
  const events = [...((s!.events as object[]) || []), { date: new Date().toISOString(), status: next.status, description: next.description, location }];
  const updated = await prisma.shipment.update({
    where: { id: s!.id },
    data: { status: next.status, events, ...(next.status === 'POSTADO' ? { postedAt: new Date() } : {}), ...(next.status === 'ENTREGUE' ? { deliveredAt: new Date() } : {}) },
  });
  if (next.status === 'POSTADO') await emit('shipment.posted', { ...actor, shipmentId: s!.id, orderId: s!.salesOrderId });
  if (next.status === 'ENTREGUE') await emit('shipment.delivered', { ...actor, shipmentId: s!.id, orderId: s!.salesOrderId });
  return updated;
}

export function estimatedDelivery(s: { postedAt: Date | null; labelAt: Date | null; deadlineDays: number }) {
  return addDays(s.postedAt || s.labelAt || new Date(), s.deadlineDays);
}
