/**
 * Entrada de pedidos reais: comprador → contato, itens por SKU (ou pelo
 * vínculo do anúncio), pedido de venda e atualização de situação.
 * Idempotente: o mesmo externalId no mesmo canal nunca gera dois pedidos.
 */
import type { SalesChannel } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { round2 } from '@/lib/utils';
import { createOrder, cancelOrder, setOrderStatus, type Actor } from '../sales';
import type { MkBuyer, MkItem, MkOrder } from './types';
import { joinExternal } from './mappers';

export async function channelLog(channelId: string, type: string, message: string, payload?: unknown, success = true) {
  await prisma.integrationLog.create({ data: { channelId, type, message, payload: (payload as object) ?? undefined, success } });
}

/** Localiza o cliente por CPF/CNPJ (ou e-mail) e cria se não existir; completa endereço vazio */
export async function upsertBuyer(orgId: string, b: MkBuyer) {
  const document = b.document || null;
  const email = b.email && !/@(mercadolivre|mail\.mercadolivre|shopee)\./i.test(b.email) ? b.email : null;
  let c = document ? await prisma.contact.findFirst({ where: { organizationId: orgId, document } }) : null;
  if (!c && email) c = await prisma.contact.findFirst({ where: { organizationId: orgId, email: { equals: email, mode: 'insensitive' } } });
  const a = b.address || {};
  const addr = { zip: a.zip || null, street: a.street || null, number: a.number || null, complement: a.complement || null, district: a.district || null, city: a.city || null, uf: a.uf || null };
  if (!c) {
    const pj = document?.length === 14;
    return prisma.contact.create({
      data: {
        organizationId: orgId, types: ['CLIENTE'], personType: pj ? 'PJ' : 'PF', name: b.name || b.nickname || 'Comprador marketplace', document, ie: b.ie || null, ieIndicator: pj && b.ie ? 1 : 9,
        email, mobile: b.phone || null, notes: b.nickname ? `Apelido no canal: ${b.nickname}` : null, ...addr,
      },
    });
  }
  const patch: Record<string, unknown> = {};
  if (!c.street && addr.street) Object.assign(patch, addr);
  if (!c.email && email) patch.email = email;
  if (!c.mobile && b.phone) patch.mobile = b.phone;
  if (!c.types.includes('CLIENTE')) patch.types = [...c.types, 'CLIENTE'];
  return Object.keys(patch).length ? prisma.contact.update({ where: { id: c.id }, data: patch }) : c;
}

/** Itens do canal → produtos do ERP: pelo SKU e, se não houver, pelo anúncio vinculado */
export async function resolveItems(orgId: string, channelId: string, items: MkItem[]) {
  const out: { productId: string; quantity: number; unitPrice: number; discount: number; description: string }[] = [];
  const missing: string[] = [];
  for (const it of items) {
    let productId: string | null = null;
    if (it.sku) {
      const p = await prisma.product.findFirst({ where: { organizationId: orgId, sku: it.sku.trim() } });
      if (p && p.kind !== 'VARIACAO_PAI') productId = p.id;
    }
    if (!productId && it.externalItemId) {
      const ids = [joinExternal(it.externalItemId, it.variationId)];
      const l = await prisma.listing.findFirst({ where: { channelId, OR: [{ externalId: { in: ids } }, { externalId: { startsWith: `${ids[0]}/` } }] } });
      if (l) productId = l.productId;
    }
    if (!productId) {
      missing.push(it.sku ? `SKU ${it.sku}` : `anúncio ${joinExternal(it.externalItemId, it.variationId) || it.title}`);
      continue;
    }
    out.push({ productId, quantity: it.quantity, unitPrice: round2(it.unitPrice), discount: round2(it.discount || 0), description: it.title });
  }
  return { items: out, missing };
}

export type IngestResult = { action: 'CRIADO' | 'EXISTENTE' | 'ATUALIZADO' | 'IGNORADO' | 'ERRO'; orderId?: string; number?: number; message: string };

const lockKey = (channelId: string, externalId: string) => `MKT:${channelId}:${externalId}`.slice(0, 190);

/** Importa (ou atualiza a situação de) um pedido do canal */
export async function ingestOrder(actor: Actor, ch: SalesChannel, mk: MkOrder): Promise<IngestResult> {
  const label = mk.number && mk.number !== mk.externalId ? `${mk.number} (${mk.externalId})` : mk.externalId;
  const existing = await prisma.salesOrder.findFirst({ where: { companyId: actor.companyId, channelId: ch.id, externalId: mk.externalId } });
  if (existing) return updateExisting(actor, ch, existing, mk, label);
  if (mk.status !== 'PAGO') return { action: 'IGNORADO', message: `Pedido ${label} ${mk.status === 'CANCELADO' ? 'cancelado' : 'aguardando pagamento'} — não importado` };

  // Trava contra importação concorrente (webhook + sincronização periódica ao mesmo tempo)
  const key = lockKey(ch.id, mk.externalId);
  try {
    await prisma.sequence.create({ data: { companyId: actor.companyId, key, value: 1 } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const again = await prisma.salesOrder.findFirst({ where: { companyId: actor.companyId, channelId: ch.id, externalId: mk.externalId } });
      if (again) return { action: 'EXISTENTE', orderId: again.id, number: again.number, message: `Pedido ${label} já importado (nº ${again.number})` };
      return { action: 'IGNORADO', message: `Pedido ${label} já está sendo importado` };
    }
    throw e;
  }
  try {
    const { items, missing } = await resolveItems(actor.orgId, ch.id, mk.items);
    if (missing.length) throw new Error(`produto não vinculado: ${missing.join(', ')}. Cadastre o SKU no produto ou vincule o anúncio.`);
    const customer = await upsertBuyer(actor.orgId, mk.buyer);
    const ship = mk.shipTo || mk.buyer.address || null;
    const order = await createOrder(actor, {
      customerId: customer.id,
      channelId: ch.id,
      externalId: mk.externalId,
      origin: 'INTEGRACAO',
      date: mk.date ? new Date(mk.date) : undefined,
      items,
      freight: round2(mk.freight || 0),
      discount: round2(mk.discount || 0),
      paymentMethod: 'MARKETPLACE',
      installments: 1,
      paymentTermDays: 0,
      paidOnCreate: true,
      carrier: mk.carrier || null,
      shippingService: mk.shippingService || null,
      shipTo: ship ? { name: ship.name || customer.name, zip: ship.zip, street: ship.street, number: ship.number, complement: ship.complement, district: ship.district, city: ship.city, uf: ship.uf, phone: ship.phone, ref: { packId: mk.packId || null, shipmentId: mk.shipmentId || null } } : undefined,
      notes: `Pedido ${label} importado do ${ch.name}${mk.packId && mk.packId !== mk.externalId ? ` · pacote ${mk.packId}` : ''}${mk.paymentLabel ? ` · ${mk.paymentLabel}` : ''}${mk.notes ? `\n${mk.notes}` : ''}`,
    });
    // Tarifa real do canal (quando informada pela API) no lugar do percentual padrão
    if (mk.fee != null && mk.fee >= 0) await prisma.salesOrder.update({ where: { id: order.id }, data: { channelFee: round2(mk.fee) } });
    const msg = `Pedido ${label} importado → pedido nº ${order.number} (R$ ${order.total.toFixed(2)})`;
    await channelLog(ch.id, 'PEDIDO', msg, { externalId: mk.externalId, packId: mk.packId, orderId: order.id, buyer: customer.name });
    return { action: 'CRIADO', orderId: order.id, number: order.number, message: msg };
  } catch (e) {
    await prisma.sequence.delete({ where: { companyId_key: { companyId: actor.companyId, key } } }).catch(() => {});
    throw e;
  }
}

async function updateExisting(actor: Actor, ch: SalesChannel, o: { id: string; number: number; status: string }, mk: MkOrder, label: string): Promise<IngestResult> {
  if (mk.status === 'CANCELADO' && o.status !== 'CANCELADO') {
    if (['ENVIADO', 'ENTREGUE'].includes(o.status)) {
      await channelLog(ch.id, 'ERRO', `Pedido ${label} cancelado no canal, mas o pedido nº ${o.number} já foi enviado — registre a devolução`, { orderId: o.id }, false);
      return { action: 'ERRO', orderId: o.id, number: o.number, message: 'Cancelado após o envio' };
    }
    await cancelOrder(actor, o.id, `Cancelado no ${ch.name}`);
    await channelLog(ch.id, 'PEDIDO', `Pedido ${label} cancelado no canal → pedido nº ${o.number} cancelado (estoque e financeiro estornados)`, { orderId: o.id });
    return { action: 'ATUALIZADO', orderId: o.id, number: o.number, message: 'Cancelado' };
  }
  if (mk.shipStatus && ['FATURADO', 'SEPARADO', 'ENVIADO'].includes(o.status) && o.status !== mk.shipStatus) {
    await setOrderStatus(actor, o.id, mk.shipStatus);
    await channelLog(ch.id, 'PEDIDO', `Pedido ${label}: ${mk.shipStatus === 'ENTREGUE' ? 'entregue' : 'enviado'} segundo o canal → pedido nº ${o.number} atualizado`, { orderId: o.id });
    return { action: 'ATUALIZADO', orderId: o.id, number: o.number, message: mk.shipStatus };
  }
  return { action: 'EXISTENTE', orderId: o.id, number: o.number, message: `Pedido ${label} já importado (nº ${o.number})` };
}
