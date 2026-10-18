/**
 * Logística: cotação de frete, etiquetas e rastreio.
 * - Real: Melhor Envio e Correios (contrato) quando a empresa conecta a conta
 *   em Integrações → Contas (cotação, compra da etiqueta, PDF oficial, rastreio).
 * - Manual (sempre disponível): frete próprio / transportadora própria / retirada — valor
 *   digitado, etiqueta de endereçamento sem código inventado, postagem/entrega marcadas
 *   pelo usuário (código de rastreio opcional digitado à mão).
 * - Simulado (só no modo demonstração): sem conta conectada, fórmula própria, código UPU e
 *   eventos simulados. Em produção nada disso é inventado.
 */
import { PDFDocument } from 'pdf-lib';
import type { Shipment, SalesOrder, Company } from '@prisma/client';
import { prisma } from '@/lib/db';
import { round2, onlyDigits, addDays, num } from '@/lib/utils';
import { buildTrackingCode, cepRegion } from '@/lib/br';
import { fail } from '../errors';
import { isDemoMode, requireRealOrDemo } from '@/lib/demo';
import { emit } from '../events';
import { getAccount } from '../integrations/accounts';
import type { AccountCtx } from '../integrations/types';
import { meQuote, meBuyLabel, meTracking, meStatus, meCancel, type ShipPurchase, type PurchaseResult } from '../integrations/providers/melhorenvio';
import { correiosQuote, correiosBuyLabel, correiosTracking, correiosLabelPdf, correiosCancel, type TrackEvent } from '../integrations/providers/correios';
import { shippingLabelPdf } from '../pdf';
import type { Actor } from './sales';

export type FreightOption = { provider: string; carrier: string; service: string; price: number; deadlineDays: number; simulated: boolean; serviceId?: string; manual?: boolean };
export type QuoteParams = { fromZip: string; toZip: string; weight: number; height?: number; width?: number; length?: number; value?: number };
const REAL = ['MELHOR_ENVIO', 'CORREIOS'] as const;

/** Frete próprio / transportadora própria / retirada: sem provedor, valor informado pelo usuário */
export const MANUAL_PROVIDER = 'PROPRIO';
export const FREIGHT_HOWTO = 'conecte o Melhor Envio ou os Correios em Integrações → Contas e credenciais, ou use "Frete próprio / retirada"';
export function manualFreightOptions(price = 0): FreightOption[] {
  return [
    { provider: MANUAL_PROVIDER, carrier: 'Frete próprio', service: 'Frete próprio / transportadora própria', price: round2(price), deadlineDays: 0, simulated: false, manual: true },
    { provider: MANUAL_PROVIDER, carrier: 'Retirada', service: 'Retirada no local', price: 0, deadlineDays: 0, simulated: false, manual: true },
  ];
}
export const isManualShipment = (s: { provider: string }) => s.provider === MANUAL_PROVIDER;

/** Tabela fictícia (fórmula própria) — usada só no modo demonstração */
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

// ---------------------------------------------------------------------------
// Cotação real (contas conectadas) com queda para a simulação
// ---------------------------------------------------------------------------
async function realAccounts(companyId: string) {
  const out: AccountCtx[] = [];
  for (const p of REAL) {
    const acc = await getAccount(companyId, p).catch(() => null);
    if (acc) out.push(acc);
  }
  return out;
}

function quoteWith(acc: AccountCtx, p: QuoteParams) {
  return acc.provider === 'MELHOR_ENVIO' ? meQuote(acc, p) : correiosQuote(acc, p);
}

/**
 * Cotação detalhada: opções reais + erros por provedor.
 * Sem conta (ou com todas falhando) → simulação no modo demonstração; em produção, nenhuma
 * opção inventada (options vazio). `manual` traz sempre o frete próprio / retirada.
 */
export async function quoteFreightDetailed(companyId: string, p: QuoteParams) {
  const accounts = await realAccounts(companyId);
  const manual = manualFreightOptions();
  const fallback = () => (isDemoMode() ? quoteFreight(p) : []);
  if (!accounts.length) return { real: false, options: fallback(), errors: [] as string[], manual };
  const results = await Promise.allSettled(accounts.map((a) => quoteWith(a, p)));
  const options: FreightOption[] = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).filter((o) => o.price > 0);
  const errors = results.flatMap((r) => (r.status === 'rejected' ? [(r.reason as Error).message] : []));
  // Todas as contas falharam: na demonstração mantém a cotação simulada; em produção, só os erros
  if (!options.length) return { real: false, options: fallback(), errors, manual };
  return { real: true, options: options.sort((a, b) => a.price - b.price), errors, manual };
}

export async function quoteFreightFor(companyId: string, p: QuoteParams): Promise<FreightOption[]> {
  return (await quoteFreightDetailed(companyId, p)).options;
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

export type FreightChoice = { provider: string; carrier?: string; service: string; serviceId?: string; price?: number | string | null; trackingCode?: string | null } | null;

/** Envio manual (frete próprio / transportadora própria / retirada): sem etiqueta do provedor nem código inventado */
async function createManualShipment(actor: Actor, order: SalesOrder, pkg: { weight: number; height: number; width: number; length: number }, choice: FreightChoice, city: string) {
  const price = choice?.price != null && choice.price !== '' ? round2(Number(choice.price) || 0) : order.freight || 0;
  const carrier = choice?.carrier || order.carrier || 'Frete próprio';
  const service = choice?.service || 'Frete próprio / transportadora própria';
  const trackingCode = choice?.trackingCode ? String(choice.trackingCode).trim().toUpperCase() || null : null;
  const shipment = await prisma.shipment.create({
    data: {
      companyId: actor.companyId, salesOrderId: order.id, provider: MANUAL_PROVIDER, carrier, service, price, deadlineDays: 0, ...pkg, trackingCode,
      status: 'ETIQUETA_GERADA',
      events: [{ date: new Date().toISOString(), status: 'ETIQUETA_GERADA', description: `Envio registrado (${service}) — aguardando postagem/entrega`, location: city }],
    },
  });
  await prisma.salesOrder.update({ where: { id: order.id }, data: { carrier, shippingService: service } });
  await emit('shipment.label_created', { ...actor, shipmentId: shipment.id, orderId: order.id });
  return shipment;
}

export async function createShipment(actor: Actor, orderId: string, choice?: FreightChoice) {
  const existing = await prisma.shipment.findFirst({ where: { salesOrderId: orderId, status: { not: 'CANCELADO' } } });
  if (existing) return existing;
  const { order, ...pkg } = await orderPackage(orderId);
  if (order.companyId !== actor.companyId) fail(404, 'Pedido não encontrado');
  if (order.origin === 'PDV') return null; // Venda balcão não gera envio
  if (!order.items.some((i) => i.productId)) return null;
  const company = await prisma.company.findUnique({ where: { id: actor.companyId } });
  if (choice?.provider === MANUAL_PROVIDER) return createManualShipment(actor, order, pkg, choice, company?.city || '');
  const shipTo = (order.shipTo || {}) as { zip?: string };
  const options = await quoteFreightFor(actor.companyId, { fromZip: company?.zip || '01000000', toZip: shipTo.zip || '01000000', ...pkg, value: order.total });
  const preferred =
    (choice && options.find((o) => o.provider === choice.provider && (choice.serviceId ? o.serviceId === choice.serviceId : o.service === choice.service))) ||
    (order.shippingService && options.find((o) => o.service.startsWith(order.shippingService!))) ||
    options[0];
  // Sem cotação real (produção sem provedor): registra o envio como frete próprio, sem inventar preço/rastreio
  if (!preferred) {
    if (choice) fail(400, `Serviço ${choice.carrier || ''} ${choice.service} indisponível — ${FREIGHT_HOWTO}`);
    return createManualShipment(actor, order, pkg, { provider: MANUAL_PROVIDER, carrier: order.carrier || undefined, service: order.shippingService || 'Frete próprio / transportadora própria' }, company?.city || '');
  }
  if (!preferred.simulated) {
    // Etiqueta real: compra na hora quando escolhida pelo usuário ou com "comprar automaticamente" ligado
    const acc = await getAccount(actor.companyId, preferred.provider);
    const shipment = await prisma.shipment.create({
      data: { companyId: actor.companyId, salesOrderId: orderId, provider: preferred.provider, carrier: preferred.carrier, service: preferred.service, price: preferred.price, deadlineDays: preferred.deadlineDays, ...pkg, status: 'PENDENTE', events: [{ date: new Date().toISOString(), status: 'PENDENTE', description: `Frete cotado em ${preferred.carrier} ${preferred.service} — aguardando compra da etiqueta`, location: company?.city || '' }] },
    });
    await prisma.salesOrder.update({ where: { id: orderId }, data: { carrier: preferred.carrier, shippingService: preferred.service } });
    if (choice || acc?.settings.autoBuy) return buyShipmentLabel(actor, shipment.id, preferred.serviceId);
    return shipment;
  }
  // Daqui em diante tudo é simulado (código de rastreio no padrão UPU): só no modo demonstração
  requireRealOrDemo('Etiqueta de envio', FREIGHT_HOWTO);
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

/** Dados da compra (remetente = empresa, destinatário = entrega do pedido, NF-e autorizada) */
async function purchaseData(s: Shipment, serviceId: string): Promise<ShipPurchase> {
  const order = await prisma.salesOrder.findUnique({ where: { id: s.salesOrderId }, include: { items: true, customer: true } });
  const company = await prisma.company.findUnique({ where: { id: s.companyId } });
  const inv = await prisma.invoice.findFirst({ where: { salesOrderId: s.salesOrderId, model: 'NFE', status: 'AUTORIZADA' }, orderBy: { issueDate: 'desc' } });
  const to = (order!.shipTo || {}) as Record<string, string | null>;
  const c = order!.customer;
  return {
    serviceId,
    from: { name: company!.tradeName || company!.name, phone: company!.phone, email: company!.email, document: company!.cnpj, ie: company!.ie, street: company!.street, number: company!.number, district: company!.district, city: company!.city, uf: company!.uf, zip: company!.zip },
    to: { name: to.name || c.name, phone: c.mobile || c.phone, email: c.email, document: c.document, ie: c.ie, street: to.street || c.street, number: to.number || c.number, complement: to.complement || c.complement, district: to.district || c.district, city: to.city || c.city, uf: to.uf || c.uf, zip: to.zip || c.zip },
    products: order!.items.filter((i) => i.productId).map((i) => ({ name: i.description, quantity: i.quantity, unitValue: i.unitPrice })),
    volume: { weight: s.weight, height: s.height, width: s.width, length: s.length, count: s.volumes || 1 },
    value: order!.total,
    invoiceKey: inv?.accessKey || null,
    invoiceNumber: inv?.number || null,
    orderNumber: order!.number,
  };
}

/** Compra a etiqueta no provedor real (Melhor Envio: carrinho → checkout → gerar → imprimir; Correios: pré-postagem + rótulo) */
export async function buyShipmentLabel(actor: Actor, shipmentId: string, serviceId?: string) {
  const s = await prisma.shipment.findFirst({ where: { id: shipmentId, companyId: actor.companyId } });
  if (!s) fail(404, 'Envio não encontrado');
  if (s!.providerRef) return s!;
  const acc = await getAccount(actor.companyId, s!.provider);
  if (!acc) fail(400, `Conta ${s!.provider === 'CORREIOS' ? 'dos Correios' : 'do Melhor Envio'} não conectada (Integrações → Contas)`);
  const events = (s!.events as object[]) || [];
  try {
    if (!serviceId) {
      // Reencontra o serviço cotado (o id do serviço não é guardado no envio)
      const opts = await quoteWith(acc!, { fromZip: (await prisma.company.findUnique({ where: { id: s!.companyId } }))?.zip || '', toZip: String(((await prisma.salesOrder.findUnique({ where: { id: s!.salesOrderId } }))?.shipTo as any)?.zip || ''), weight: s!.weight, height: s!.height, width: s!.width, length: s!.length });
      serviceId = opts.find((o) => o.carrier === s!.carrier && o.service === s!.service)?.serviceId;
      if (!serviceId) fail(400, `Serviço ${s!.carrier} ${s!.service} indisponível para este destino — cancele e gere novamente`);
    }
    const data = await purchaseData(s!, serviceId!);
    const r: PurchaseResult = acc!.provider === 'MELHOR_ENVIO' ? await meBuyLabel(acc!, data) : await correiosBuyLabel(acc!, data);
    const updated = await prisma.shipment.update({
      where: { id: s!.id },
      data: { providerRef: r.providerRef, trackingCode: r.trackingCode, labelUrl: r.labelUrl, ...(r.price ? { price: r.price } : {}), status: 'ETIQUETA_GERADA', labelAt: new Date(), events: [...events, { date: new Date().toISOString(), status: 'ETIQUETA_GERADA', description: `Etiqueta comprada em ${acc!.provider === 'CORREIOS' ? 'Correios (pré-postagem)' : 'Melhor Envio'} — aguardando postagem`, location: '' }] },
    });
    await emit('shipment.label_created', { ...actor, shipmentId: s!.id, orderId: s!.salesOrderId });
    return updated;
  } catch (e) {
    await prisma.shipment.update({ where: { id: s!.id }, data: { events: [...events, { date: new Date().toISOString(), status: 'PENDENTE', description: `Falha ao comprar etiqueta: ${(e as Error).message}`, location: '' }] } });
    throw e;
  }
}

/** Cancela o envio (e a etiqueta no provedor real, antes da postagem) */
export async function cancelShipment(actor: Actor, shipmentId: string) {
  const s = await prisma.shipment.findFirst({ where: { id: shipmentId, companyId: actor.companyId } });
  if (!s) fail(404, 'Envio não encontrado');
  if (!['PENDENTE', 'ETIQUETA_GERADA'].includes(s!.status)) fail(400, 'Envio já postado não pode ser cancelado');
  if (s!.providerRef) {
    const acc = await getAccount(actor.companyId, s!.provider);
    if (acc?.provider === 'MELHOR_ENVIO') await meCancel(acc, s!.providerRef);
    else if (acc?.provider === 'CORREIOS') await correiosCancel(acc, s!.providerRef);
  }
  const events = [...((s!.events as object[]) || []), { date: new Date().toISOString(), status: 'CANCELADO', description: s!.providerRef ? 'Etiqueta cancelada no provedor' : 'Envio cancelado', location: '' }];
  return prisma.shipment.update({ where: { id: s!.id }, data: { status: 'CANCELADO', events } });
}

/**
 * Volumes/peso alterados num envio cuja etiqueta já foi comprada no provedor: a etiqueta comprada
 * não muda. Melhor Envio com "Recomprar etiqueta ao alterar volumes" ligado → cancela e compra outra
 * com os novos dados; nos demais casos, erro pedindo para cancelar e comprar novamente.
 * Devolve null quando não há etiqueta real (o chamador só atualiza o envio).
 */
export async function changePurchasedVolumes(actor: Actor, s: Shipment, data: { volumes: number; weight?: number }) {
  if (!s.providerRef) return null;
  const weight = data.weight ? Number(data.weight) : s.weight;
  if (data.volumes === s.volumes && weight === s.weight) return s;
  const name = s.provider === 'CORREIOS' ? 'nos Correios' : 'no Melhor Envio';
  if (s.status !== 'ETIQUETA_GERADA') fail(400, `Envio já ${s.status === 'PENDENTE' ? 'em compra' : 'postado'} — volumes não podem ser alterados`);
  const acc = await getAccount(actor.companyId, s.provider);
  if (!(acc?.provider === 'MELHOR_ENVIO' && acc.settings.rebuyOnVolumes)) {
    fail(400, `A etiqueta deste envio já foi comprada ${name} com ${s.volumes} volume(s) de ${num(s.weight, 3)} kg. Para alterar volumes ou peso, cancele a etiqueta e compre novamente.`);
  }
  await meCancel(acc!, s.providerRef);
  const events = [...((s.events as object[]) || []), { date: new Date().toISOString(), status: 'PENDENTE', description: `Etiqueta cancelada no Melhor Envio para recompra: ${s.volumes} → ${data.volumes} volume(s), ${num(s.weight, 3)} → ${num(weight, 3)} kg`, location: '' }];
  await prisma.shipment.update({ where: { id: s.id }, data: { volumes: data.volumes, weight, providerRef: null, trackingCode: null, labelUrl: null, status: 'PENDENTE', events } });
  return buyShipmentLabel(actor, s.id);
}

const TRACK_FLOW = [
  { status: 'POSTADO', description: 'Objeto postado' },
  { status: 'EM_TRANSITO', description: 'Objeto em trânsito - por favor aguarde' },
  { status: 'SAIU_PARA_ENTREGA', description: 'Objeto saiu para entrega ao destinatário' },
  { status: 'ENTREGUE', description: 'Objeto entregue ao destinatário' },
];
const RANK = ['PENDENTE', 'ETIQUETA_GERADA', 'POSTADO', 'EM_TRANSITO', 'SAIU_PARA_ENTREGA', 'ENTREGUE'];
const ACTIVE = ['ETIQUETA_GERADA', 'POSTADO', 'EM_TRANSITO', 'SAIU_PARA_ENTREGA'];

/**
 * Aplica o rastreio do provedor ao envio: junta os eventos, avança o status
 * (nunca regride) e dispara shipment.posted / shipment.delivered.
 */
async function applyTracking(s: Shipment, upd: { status: string | null; trackingCode?: string | null; events?: TrackEvent[] }) {
  const old = (s.events as TrackEvent[]) || [];
  const seen = new Set(old.map((e) => `${e.date}|${e.description}`));
  const events = [...old, ...(upd.events || []).filter((e) => !seen.has(`${e.date}|${e.description}`))].sort((a, b) => a.date.localeCompare(b.date));
  let status = s.status;
  if (upd.status === 'CANCELADO') status = 'CANCELADO';
  else if (upd.status && RANK.indexOf(upd.status) > RANK.indexOf(s.status)) status = upd.status;
  if (status !== s.status && !upd.events?.length) events.push({ date: new Date().toISOString(), status, description: TRACK_FLOW.find((t) => t.status === status)?.description || status, location: '' });
  const crossed = (st: string) => RANK.indexOf(s.status) < RANK.indexOf(st) && RANK.indexOf(status) >= RANK.indexOf(st);
  const updated = await prisma.shipment.update({
    where: { id: s.id },
    data: { status, events, ...(upd.trackingCode && upd.trackingCode !== s.trackingCode ? { trackingCode: upd.trackingCode } : {}), ...(crossed('POSTADO') ? { postedAt: new Date() } : {}), ...(crossed('ENTREGUE') ? { deliveredAt: new Date() } : {}) },
  });
  if (crossed('POSTADO') || crossed('ENTREGUE')) {
    const company = await prisma.company.findUnique({ where: { id: s.companyId }, select: { organizationId: true } });
    const actor = { companyId: s.companyId, orgId: company!.organizationId, userName: 'Rastreio automático' };
    if (crossed('POSTADO')) await emit('shipment.posted', { ...actor, shipmentId: s.id, orderId: s.salesOrderId });
    if (crossed('ENTREGUE')) await emit('shipment.delivered', { ...actor, shipmentId: s.id, orderId: s.salesOrderId });
  }
  return updated;
}

/** Notificação (webhook) de um provedor real para o envio identificado por providerRef */
export async function applyProviderTracking(companyId: string, provider: string, providerRef: string, upd: { status: string | null; trackingCode?: string | null; events?: TrackEvent[] }) {
  const s = await prisma.shipment.findFirst({ where: { companyId, provider, providerRef } });
  if (!s) return `Envio ${providerRef} não encontrado`;
  const u = await applyTracking(s, upd);
  return `Envio ${u.trackingCode || providerRef}: ${u.status}`;
}

/** Busca o rastreio no provedor real para os envios informados */
async function refreshReal(acc: AccountCtx, list: Shipment[]) {
  if (!list.length) return [];
  if (acc.provider === 'MELHOR_ENVIO') {
    const tr = await meTracking(acc, list.map((s) => s.providerRef!));
    return Promise.all(list.map((s) => (tr[s.providerRef!] ? applyTracking(s, { status: meStatus(tr[s.providerRef!].status), trackingCode: tr[s.providerRef!].tracking }) : s)));
  }
  const out: Shipment[] = [];
  for (const s of list) out.push(s.trackingCode ? await applyTracking(s, await correiosTracking(acc, s.trackingCode)) : s);
  return out;
}

/** Rotina de rastreio (a cada 30 min pelo agendador das integrações) */
export async function syncProviderTracking(companyId: string, provider: string) {
  const acc = await getAccount(companyId, provider);
  if (!acc) return 'Conta não conectada';
  const list = await prisma.shipment.findMany({ where: { companyId, provider, providerRef: { not: null }, status: { in: ACTIVE } }, take: 100 });
  const before = new Map(list.map((s) => [s.id, s.status]));
  const after = await refreshReal(acc, list);
  const changed = after.filter((s) => before.get(s.id) !== s.status).length;
  return `${list.length} envio(s) consultado(s), ${changed} atualizado(s)`;
}

/**
 * Envio manual (frete próprio/retirada): o usuário marca postado/entregue e pode informar o
 * código de rastreio da transportadora própria. Nada é inventado (sem local nem eventos fictícios).
 */
export async function markManualShipment(actor: Actor, shipmentId: string, body: { status?: string; trackingCode?: string | null } = {}) {
  const s = await prisma.shipment.findFirst({ where: { id: shipmentId, companyId: actor.companyId } });
  if (!s) fail(404, 'Envio não encontrado');
  if (!isManualShipment(s!)) fail(400, 'Somente envios de frete próprio/retirada são atualizados manualmente');
  if (['ENTREGUE', 'CANCELADO'].includes(s!.status)) fail(400, 'Envio já finalizado');
  const code = body.trackingCode != null ? String(body.trackingCode).trim().toUpperCase() || null : undefined;
  // Só o código de rastreio informado: não muda a situação; sem nada → próxima etapa (postado → entregue)
  const target = body.status || (code !== undefined ? s!.status : s!.status === 'ETIQUETA_GERADA' ? 'POSTADO' : 'ENTREGUE');
  if (!['POSTADO', 'ENTREGUE'].includes(target) && !(target === s!.status && code !== undefined)) fail(400, 'Situação inválida (use POSTADO ou ENTREGUE)');
  const events = [...((s!.events as object[]) || [])];
  if (code !== undefined && code !== s!.trackingCode) events.push({ date: new Date().toISOString(), status: s!.status, description: code ? `Código de rastreio informado: ${code}` : 'Código de rastreio removido', location: '' });
  const advance = RANK.indexOf(target) > RANK.indexOf(s!.status);
  if (advance) events.push({ date: new Date().toISOString(), status: target, description: `${target === 'POSTADO' ? 'Marcado como postado/despachado' : 'Marcado como entregue'} por ${actor.userName || 'usuário'}`, location: '' });
  const crossed = (st: string) => advance && RANK.indexOf(s!.status) < RANK.indexOf(st) && RANK.indexOf(target) >= RANK.indexOf(st);
  const updated = await prisma.shipment.update({
    where: { id: s!.id },
    data: { ...(advance ? { status: target } : {}), events, ...(code !== undefined ? { trackingCode: code } : {}), ...(crossed('POSTADO') ? { postedAt: new Date() } : {}), ...(crossed('ENTREGUE') ? { deliveredAt: new Date() } : {}) },
  });
  if (crossed('POSTADO')) await emit('shipment.posted', { ...actor, shipmentId: s!.id, orderId: s!.salesOrderId });
  if (crossed('ENTREGUE')) await emit('shipment.delivered', { ...actor, shipmentId: s!.id, orderId: s!.salesOrderId });
  return updated;
}

/** Atualiza o rastreio: provedor real quando a etiqueta foi comprada nele; frete próprio → marcação manual; senão avança a simulação (demo) */
export async function advanceTracking(actor: Actor, shipmentId: string) {
  const s = await prisma.shipment.findFirst({ where: { id: shipmentId, companyId: actor.companyId }, include: { salesOrder: true } });
  if (!s) fail(404, 'Envio não encontrado');
  if (isManualShipment(s!)) return markManualShipment(actor, s!.id);
  if ((REAL as readonly string[]).includes(s!.provider) && (s!.providerRef || s!.status === 'PENDENTE')) {
    if (s!.status === 'PENDENTE') return buyShipmentLabel(actor, s!.id);
    const acc = await getAccount(actor.companyId, s!.provider);
    if (!acc) fail(400, 'Conta do provedor não conectada (Integrações → Contas)');
    return (await refreshReal(acc!, [s!]))[0];
  }
  // Eventos de transportadora inventados: só no modo demonstração
  requireRealOrDemo('Rastreio do envio', 'o rastreio vem do provedor em que a etiqueta foi comprada (Melhor Envio/Correios em Integrações → Contas e credenciais)');
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

// ---------------------------------------------------------------------------
// Etiquetas: PDF oficial do provedor (proxy) ou etiqueta simulada 10x15
// ---------------------------------------------------------------------------
async function providerLabel(s: Shipment): Promise<Uint8Array> {
  const acc = await getAccount(s.companyId, s.provider);
  if (s.labelUrl!.startsWith('correios:')) {
    if (!acc) fail(400, 'Conta dos Correios não conectada');
    return correiosLabelPdf(acc!, s.labelUrl!);
  }
  const t = acc?.secrets.token || acc?.secrets.accessToken;
  const r = await fetch(s.labelUrl!, { headers: t ? { Authorization: `Bearer ${t}`, 'User-Agent': `GestaoPro (${acc?.settings.email || 'contato@gestaopro.com.br'})` } : {} });
  if (!r.ok) fail(502, `Não foi possível baixar a etiqueta ${s.trackingCode || ''} do provedor (HTTP ${r.status})`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (String.fromCharCode(...buf.slice(0, 4)) !== '%PDF') fail(502, `Etiqueta ${s.trackingCode || ''}: o provedor não devolveu um PDF`);
  return buf;
}

/**
 * Junta as etiquetas oficiais (PDF do provedor) com as etiquetas de endereçamento (frete próprio)
 * e — só no modo demonstração — as simuladas, em um único PDF.
 */
export async function labelsPdf(list: { shipment: Shipment; order: SalesOrder & { customer: { name: string } }; company: Company }[]) {
  const sim = list.filter((x) => !x.shipment.labelUrl);
  if (!isDemoMode() && sim.some((x) => !isManualShipment(x.shipment))) {
    requireRealOrDemo('Etiqueta de envio', 'a etiqueta oficial vem do provedor (compre-a pelo Melhor Envio/Correios conectados em Integrações → Contas e credenciais); envios de frete próprio imprimem a etiqueta de endereçamento');
  }
  const real = list.filter((x) => x.shipment.labelUrl);
  if (!real.length) return shippingLabelPdf(sim);
  const out = await PDFDocument.create();
  for (const x of real) {
    const src = await PDFDocument.load(await providerLabel(x.shipment));
    for (const pg of await out.copyPages(src, src.getPageIndices())) out.addPage(pg);
  }
  if (sim.length) {
    const src = await PDFDocument.load(await shippingLabelPdf(sim));
    for (const pg of await out.copyPages(src, src.getPageIndices())) out.addPage(pg);
  }
  return out.save();
}
export function estimatedDelivery(s: { postedAt: Date | null; labelAt: Date | null; deadlineDays: number }) {
  return addDays(s.postedAt || s.labelAt || new Date(), s.deadlineDays);
}
