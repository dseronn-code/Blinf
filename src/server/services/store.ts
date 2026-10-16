/**
 * Loja virtual nativa: catálogo público com estoque/preço do ERP e
 * checkout que gera cliente + pedido (origem LOJA) + cobrança.
 */
import { prisma } from '@/lib/db';
import { round2, onlyDigits, randomDigits, addDays } from '@/lib/utils';
import { isValidCPF, isValidCNPJ, buildPixPayload } from '@/lib/br';
import { fail } from '../errors';
import { getAvailability } from './stock';
import { resolvePrice, createOrder } from './sales';
import { quoteFreight } from './logistics';
import { defaultBankAccount } from './finance';
import { evaluateCoupon } from './operations';

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
      id: p.id, sku: p.sku, name: p.name, description: p.description, kind: p.kind, featured: p.featured, imageUrl: p.imageUrl, category: p.category, price, compareAt: price < p.price ? p.price : null,
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
  const options = quoteFreight({ fromZip: company.zip || '', toZip: zip, weight, value: subtotal }).filter((o) => ['PAC', 'SEDEX', '.Package', 'Loggi Express'].some((s) => o.service.startsWith(s)) && o.provider !== 'GESTAO_ENVIOS');
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
  const order = await createOrder(actor, {
    customerId: contact.id, origin: 'LOJA', externalId: `LV-${randomDigits(6)}`, items, discount, freight, shippingService: chosen?.service,
    paymentMethod: input.paymentMethod, installments: input.paymentMethod === 'CARTAO_CREDITO' ? input.installments || 1 : 1, paymentTermDays: input.paymentMethod === 'BOLETO' ? 3 : 0,
    // Cartão é aprovado na hora (gateway simulado); Pix/boleto aguardam pagamento
    paidOnCreate: input.paymentMethod === 'CARTAO_CREDITO', warehouseId: store.warehouseId, shipTo: { name: c.name, ...addr }, notes: 'Pedido da loja virtual',
  });
  if (coupon) {
    await prisma.coupon.update({ where: { id: coupon.coupon.id }, data: { uses: { increment: 1 } } });
    await prisma.salesOrder.update({ where: { id: order.id }, data: { couponCode: coupon.coupon.code } });
  }
  // Recebível + link de pagamento para Pix/boleto (o pagamento simulado baixa a conta)
  let payment: Record<string, unknown> = { method: input.paymentMethod, status: input.paymentMethod === 'CARTAO_CREDITO' ? 'APROVADO' : 'AGUARDANDO' };
  if (input.paymentMethod !== 'CARTAO_CREDITO') {
    const bank = await defaultBankAccount(prisma, company.id, 'CONTA_DIGITAL');
    const entry = await prisma.financialEntry.create({ data: { companyId: company.id, type: 'RECEBER', description: `Loja virtual - pedido nº ${order.number}`, contactId: contact.id, contactName: contact.name, dueDate: addDays(new Date(), input.paymentMethod === 'BOLETO' ? 3 : 1), amount: order.total, origin: 'LOJA', originId: order.id, paymentMethod: input.paymentMethod, chartAccountId: (await prisma.chartAccount.findFirst({ where: { companyId: company.id, code: '1.1.03' } }))?.id, documentNumber: String(order.number) } });
    await prisma.salesOrder.update({ where: { id: order.id }, data: { financialPosted: true } });
    const slugLink = `pg${randomDigits(10)}`;
    const pix = buildPixPayload({ key: bank?.pixKey || company.cnpj, name: company.tradeName || company.name, city: company.city || 'SAO PAULO', amount: order.total, txid: slugLink });
    await prisma.paymentLink.create({ data: { companyId: company.id, slug: slugLink, description: `Pedido ${order.number} - ${store.name}`, amount: order.total, methods: input.paymentMethod === 'PIX' ? 'PIX' : 'BOLETO', entryId: entry.id, salesOrderId: order.id, customerName: contact.name, pixPayload: pix, expiresAt: entry.dueDate } });
    payment = { ...payment, link: `/pagar/${slugLink}`, pix, entryId: entry.id };
  }
  return { order: { id: order.id, number: order.number, total: order.total, externalId: order.externalId }, payment };
}
