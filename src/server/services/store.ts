/**
 * Loja virtual nativa: catálogo público com estoque/preço do ERP e
 * checkout que gera cliente + pedido (origem LOJA) + cobrança.
 */
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { round2, onlyDigits, randomDigits, addDays } from '@/lib/utils';
import { isValidCPF, isValidCNPJ, buildPixPayload } from '@/lib/br';
import { fail } from '../errors';
import { getAvailability } from './stock';
import { resolvePrice, createOrder } from './sales';
import { quoteFreightFor } from './logistics';
import { defaultBankAccount } from './finance';
import { evaluateCoupon } from './operations';
import { paymentAccount, createCharge } from './payments';
import { notify } from './notify';
import { appUrl } from '../integrations/accounts';

export async function storeBySlug(slug: string) {
  const store = await prisma.store.findUnique({ where: { slug } });
  if (!store) fail(404, 'Loja não encontrada');
  const company = await prisma.company.findUnique({ where: { id: store!.companyId } });
  return { store: store!, company: company! };
}

export async function storeCatalog(slug: string) {
  const { store, company } = await storeBySlug(slug);
  const products = await prisma.product.findMany({
    where: { organizationId: company.organizationId, active: true, kind: { in: ['SIMPLES', 'VARIACAO_PAI', 'KIT', 'FABRICADO'] } },
    include: { category: { select: { id: true, name: true } }, variations: { where: { active: true }, orderBy: { sku: 'asc' } } },
    orderBy: [{ featured: 'desc' }, { name: 'asc' }],
  });
  const scope = { orgId: company.organizationId, companyId: company.id };
  const avail = await getAvailability(prisma, scope, products.flatMap((p) => [p.id, ...p.variations.map((v) => v.id)]));
  const out = [];
  for (const p of products) {
    const price = await resolvePrice(prisma, p.id, store.priceListId);
    out.push({
      id: p.id, sku: p.sku, name: p.name, description: p.description, kind: p.kind, featured: p.featured, imageUrl: p.imageUrl || p.images[0] || null, images: p.images, category: p.category, price, compareAt: price < p.price ? p.price : null,
      weight: p.weight, available: Math.max(0, avail.get(p.id)?.available ?? 0), attributes: p.attributes,
      variations: await Promise.all(p.variations.map(async (v) => ({ id: v.id, sku: v.sku, name: v.name, attributes: v.attributes, price: await resolvePrice(prisma, v.id, store.priceListId), available: Math.max(0, avail.get(v.id)?.available ?? 0) }))),
    });
  }
  const categories = [...new Map(out.filter((p) => p.category).map((p) => [p.category!.id, p.category!])).values()];
  return { store, company: { name: company.tradeName || company.name, city: company.city, uf: company.uf, cnpj: company.cnpj, phone: company.phone, email: company.email }, products: out.filter((p) => p.price > 0), categories };
}

export async function storeFreight(slug: string, zip: string, items: { productId: string; quantity: number }[], uf?: string) {
  const { store, company } = await storeBySlug(slug);
  const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
  const weight = items.reduce((a, i) => a + (products.find((p) => p.id === i.productId)?.weight || 0.3) * i.quantity, 0);
  const subtotal = (await Promise.all(items.map(async (i) => (await resolvePrice(prisma, i.productId, store.priceListId)) * i.quantity))).reduce((a, b) => a + b, 0);
  // Frete real (Melhor Envio/Correios conectados) ou simulado; na simulação, só os serviços mais comuns
  const options = (await quoteFreightFor(company.id, { fromZip: company.zip || '', toZip: zip, weight, value: subtotal })).filter((o) => !o.simulated || (['PAC', 'SEDEX', '.Package', 'Loggi Express'].some((s) => o.service.startsWith(s)) && o.provider !== 'GESTAO_ENVIOS'));
  const free = (store.freeShippingAbove > 0 && subtotal >= store.freeShippingAbove) || (!!uf && store.freeShippingUfs.includes(uf.toUpperCase()));
  return options.map((o, i) => ({ ...o, price: free && i === 0 ? 0 : o.price, free: free && i === 0 }));
}

export type CheckoutInput = {
  customer: { name: string; email: string; document: string; phone?: string; zip: string; street: string; number: string; complement?: string; district: string; city: string; uf: string };
  items: { productId: string; quantity: number }[];
  shipping: { service: string; price: number };
  paymentMethod: 'PIX' | 'BOLETO' | 'CARTAO_CREDITO';
  installments?: number;
  couponCode?: string;
};

export async function storeCheckout(slug: string, input: CheckoutInput) {
  const { store, company } = await storeBySlug(slug);
  if (!store.published) fail(400, 'Loja indisponível');
  const c = input.customer;
  const doc = onlyDigits(c.document);
  if (!(doc.length === 11 ? isValidCPF(doc) : isValidCNPJ(doc))) fail(400, 'CPF/CNPJ inválido');
  if (!c.name || !c.email || !c.zip || !c.street || !c.city || !c.uf) fail(400, 'Preencha todos os dados de entrega');
  if (!input.items?.length) fail(400, 'Carrinho vazio');
  const actor = { companyId: company.id, orgId: company.organizationId, userName: 'Loja virtual' };
  const avail = await getAvailability(prisma, actor, input.items.map((i) => i.productId));
  for (const it of input.items) {
    if ((avail.get(it.productId)?.available ?? 0) < it.quantity) {
      const p = await prisma.product.findUnique({ where: { id: it.productId } });
      fail(400, `Estoque insuficiente para "${p?.name}"`);
    }
  }
  const addr = { zip: onlyDigits(c.zip), street: c.street, number: c.number, complement: c.complement || null, district: c.district, city: c.city, uf: c.uf.toUpperCase() };
  let contact = await prisma.contact.findFirst({ where: { organizationId: company.organizationId, document: doc } });
  if (contact) contact = await prisma.contact.update({ where: { id: contact.id }, data: { email: c.email, mobile: c.phone || contact.mobile, ...addr } });
  else contact = await prisma.contact.create({ data: { organizationId: company.organizationId, types: ['CLIENTE'], personType: doc.length === 14 ? 'PJ' : 'PF', name: c.name, document: doc, email: c.email, mobile: c.phone || null, ...addr, notes: 'Cadastrado pela loja virtual' } });
  const items = await Promise.all(input.items.map(async (i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: await resolvePrice(prisma, i.productId, store.priceListId) })));
  const subtotal = items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  const coupon = await evaluateCoupon(company.id, input.couponCode, subtotal);
  const discount = round2((input.paymentMethod === 'PIX' ? (subtotal * store.pixDiscount) / 100 : 0) + (coupon?.discount || 0));
  // Frete: recalculado no servidor (não confia no valor do navegador)
  const options = await storeFreight(slug, addr.zip, input.items, addr.uf);
  const chosen = options.find((o) => o.service === input.shipping?.service) || options[0];
  const freight = coupon?.freeShipping ? 0 : round2(chosen?.price || 0);
  // Asaas/Mercado Pago conectado: Pix, boleto e cartão são cobrados de verdade; sem provedor, cartão é aprovado na hora (simulado)
  const gateway = await paymentAccount(company.id);
  const cardNow = input.paymentMethod === 'CARTAO_CREDITO' && !gateway;
  const order = await createOrder(actor, {
    customerId: contact.id, origin: 'LOJA', externalId: `LV-${randomDigits(6)}`, items, discount, freight, shippingService: chosen?.service,
    paymentMethod: input.paymentMethod, installments: input.paymentMethod === 'CARTAO_CREDITO' ? input.installments || 1 : 1, paymentTermDays: input.paymentMethod === 'BOLETO' ? 3 : 0,
    // Cartão simulado é aprovado na hora; Pix/boleto (e cartão real) aguardam pagamento
    paidOnCreate: cardNow, warehouseId: store.warehouseId, shipTo: { name: c.name, ...addr }, notes: 'Pedido da loja virtual',
  });
  if (coupon) {
    await prisma.coupon.update({ where: { id: coupon.coupon.id }, data: { uses: { increment: 1 } } });
    await prisma.salesOrder.update({ where: { id: order.id }, data: { couponCode: coupon.coupon.code } });
  }
  // Recebível + link de pagamento (o pagamento — real via webhook ou simulado — baixa a conta)
  let payment: Record<string, unknown> = { method: input.paymentMethod, status: cardNow ? 'APROVADO' : 'AGUARDANDO' };
  if (!cardNow) {
    const bank = await defaultBankAccount(prisma, company.id, 'CONTA_DIGITAL');
    const entry = await prisma.financialEntry.create({ data: { companyId: company.id, type: 'RECEBER', description: `Loja virtual - pedido nº ${order.number}`, contactId: contact.id, contactName: contact.name, dueDate: addDays(new Date(), input.paymentMethod === 'BOLETO' ? 3 : 1), amount: order.total, origin: 'LOJA', originId: order.id, paymentMethod: input.paymentMethod, chartAccountId: (await prisma.chartAccount.findFirst({ where: { companyId: company.id, code: '1.1.03' } }))?.id, documentNumber: String(order.number) } });
    await prisma.salesOrder.update({ where: { id: order.id }, data: { financialPosted: true } });
    const slugLink = `pg${randomDigits(10)}`;
    let pix = buildPixPayload({ key: bank?.pixKey || company.cnpj, name: company.tradeName || company.name, city: company.city || 'SAO PAULO', amount: order.total, txid: slugLink });
    const method = input.paymentMethod === 'PIX' ? 'PIX' : input.paymentMethod === 'BOLETO' ? 'BOLETO' : 'CARTAO';
    const link = await prisma.paymentLink.create({ data: { companyId: company.id, slug: slugLink, description: `Pedido ${order.number} - ${store.name}`, amount: order.total, methods: method, entryId: entry.id, salesOrderId: order.id, customerName: contact.name, pixPayload: pix, expiresAt: entry.dueDate } });
    payment = { ...payment, link: `/pagar/${slugLink}`, pix, entryId: entry.id, simulated: !gateway };
    if (gateway) {
      try {
        const r = await createCharge(company.id, entry.id, method, { backUrl: `${appUrl()}/pagar/${slugLink}` });
        if (r.entry.pixPayload) {
          pix = r.entry.pixPayload;
          await prisma.paymentLink.update({ where: { id: link.id }, data: { pixPayload: pix } });
        }
        const redirectUrl = 'redirectUrl' in r ? r.redirectUrl : null;
        payment = { ...payment, pix, provider: r.entry.provider, boletoLine: r.entry.boletoLine, paymentUrl: r.entry.paymentUrl, redirectUrl, ...(method === 'CARTAO' && redirectUrl ? { link: redirectUrl } : {}) };
      } catch (e) {
        // Falha no provedor não perde o pedido: segue com a cobrança simulada e avisa a empresa
        payment = { ...payment, simulated: true };
        await notify(company.id, 'Falha ao emitir cobrança da loja', `Pedido ${order.number}: ${(e as Error).message}. Cobrança simulada mantida.`, { level: 'error', link: '/financeiro/cobrancas' });
      }
    }
  }
  return { order: { id: order.id, number: order.number, total: order.total, externalId: order.externalId }, payment };
}

// ---------------------------------------------------------------------------
// Área do cliente (acompanhamento de pedidos sem senha: e-mail + CPF/CNPJ)
// ---------------------------------------------------------------------------
const SECRET = () => process.env.NEXTAUTH_SECRET || 'gestaopro-dev-secret';

/** Token assinado (HMAC) com validade de 30 dias guardado em cookie httpOnly */
export function signCustomerToken(slug: string, contactId: string) {
  const exp = Date.now() + 30 * 86400_000;
  const payload = `${slug}.${contactId}.${exp}`;
  return `${payload}.${crypto.createHmac('sha256', SECRET()).update(payload).digest('hex').slice(0, 32)}`;
}

export function verifyCustomerToken(slug: string, token: string | undefined) {
  if (!token) return null;
  const [s, id, exp, sig] = token.split('.');
  if (s !== slug || !id || Number(exp) < Date.now()) return null;
  const good = crypto.createHmac('sha256', SECRET()).update(`${s}.${id}.${exp}`).digest('hex').slice(0, 32);
  return sig && sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)) ? id : null;
}

export async function storeCustomerLogin(slug: string, email: string, document: string) {
  const { company } = await storeBySlug(slug);
  const doc = onlyDigits(document);
  const contact = await prisma.contact.findFirst({ where: { organizationId: company.organizationId, document: doc, email: { equals: String(email || '').trim(), mode: 'insensitive' } } });
  if (!contact || !(await prisma.salesOrder.count({ where: { companyId: company.id, customerId: contact.id } }))) fail(401, 'Não encontramos pedidos com este e-mail e CPF/CNPJ');
  return contact!;
}

const STATUS_TXT: Record<string, string> = { ABERTO: 'Aguardando pagamento', FATURADO: 'Pagamento aprovado / faturado', SEPARADO: 'Em separação', ENVIADO: 'Enviado', ENTREGUE: 'Entregue', CANCELADO: 'Cancelado' };

export async function storeCustomerOrders(slug: string, contactId: string) {
  const { company } = await storeBySlug(slug);
  const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { name: true, email: true, document: true } });
  const orders = await prisma.salesOrder.findMany({ where: { companyId: company.id, customerId: contactId }, include: { items: { select: { description: true, quantity: true, total: true } }, shipments: { select: { carrier: true, service: true, trackingCode: true, status: true, events: true } } }, orderBy: { date: 'desc' }, take: 50 });
  const ids = orders.map((o) => o.id);
  const [invoices, links, returns] = await Promise.all([
    prisma.invoice.findMany({ where: { salesOrderId: { in: ids }, status: 'AUTORIZADA' }, select: { id: true, salesOrderId: true, number: true, accessKey: true, model: true } }),
    prisma.paymentLink.findMany({ where: { salesOrderId: { in: ids }, status: 'ATIVO' }, select: { salesOrderId: true, slug: true } }),
    prisma.salesReturn.findMany({ where: { salesOrderId: { in: ids } }, select: { salesOrderId: true, number: true, kind: true, status: true, total: true } }),
  ]);
  return {
    customer: contact,
    orders: orders.map((o) => ({
      id: o.id, number: o.number, externalId: o.externalId, date: o.date, status: o.status, statusText: STATUS_TXT[o.status] || o.status, total: o.total, paymentMethod: o.paymentMethod, items: o.items, shipments: o.shipments,
      invoice: invoices.find((i) => i.salesOrderId === o.id) || null, payLink: links.find((l) => l.salesOrderId === o.id)?.slug || null, returns: returns.filter((r) => r.salesOrderId === o.id),
    })),
  };
}

/** Resolve domínio próprio → slug da loja (usado pelo middleware) */
export async function storeByDomain(host: string) {
  const s = await prisma.store.findFirst({ where: { customDomain: host.toLowerCase(), published: true }, select: { slug: true } });
  return s?.slug || null;
}
