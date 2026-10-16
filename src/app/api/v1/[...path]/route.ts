/**
 * API REST pública v1 (autenticação por chave de API).
 * Documentação: GET /api/v1/openapi.json e página Integrações > API e Webhooks.
 */
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { toErrorResponse, HttpError } from '@/server/http';
import { openapi } from '@/server/openapi';
import { getAvailability, moveStock, adjustStock } from '@/server/services/stock';
import { createOrder, invoiceOrder, cancelOrder } from '@/server/services/sales';
import { saveProduct } from '@/server/services/products';
import { emit } from '@/server/events';
import { onlyDigits } from '@/lib/utils';
import { rateLimit } from '@/lib/rateLimit';

type P = { params: Promise<{ path: string[] }> };

async function auth(req: Request) {
  const h = req.headers.get('authorization') || '';
  const key = h.replace(/^Bearer\s+/i, '').trim() || req.headers.get('x-api-key') || '';
  if (!key) throw new HttpError(401, 'Informe a chave de API no header Authorization: Bearer <chave>');
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const k = await prisma.apiKey.findUnique({ where: { keyHash: hash } });
  if (!k || !k.active) throw new HttpError(401, 'Chave de API inválida ou revogada');
  // Limite: 120 requisições por minuto por chave
  const rl = rateLimit(`api:${k.id}`, Number(process.env.API_RATE_LIMIT || 120), 60_000);
  if (!rl.ok) throw new HttpError(429, `Limite de requisições excedido. Tente novamente em ${Math.ceil((rl.reset - Date.now()) / 1000)} s`);
  await prisma.apiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } });
  const company = await prisma.company.findUnique({ where: { id: k.companyId }, include: { organization: true } });
  return { companyId: company!.id, orgId: company!.organizationId, stockMode: company!.organization.stockMode, userName: `API (${k.name})` };
}

async function handle(req: Request, { params }: P) {
  try {
    const path = (await params).path || [];
    if (path[0] === 'openapi.json') return NextResponse.json(openapi);
    const a = await auth(req);
    const url = new URL(req.url);
    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
    const [res, id, sub] = path;
    const m = req.method;
    const findProduct = async (ref: string) => prisma.product.findFirst({ where: { organizationId: a.orgId, OR: [{ id: ref }, { sku: ref }, { gtin: ref }] } });

    if (res === 'products') {
      if (m === 'GET' && !id) {
        const q = url.searchParams.get('q');
        const page = Number(url.searchParams.get('page')) || 1;
        const rows = await prisma.product.findMany({ where: { organizationId: a.orgId, kind: { not: 'VARIACAO_PAI' }, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q } }] } : {}) }, take: 100, skip: (page - 1) * 100, orderBy: { sku: 'asc' } });
        const av = await getAvailability(prisma, a, rows.map((r) => r.id));
        return NextResponse.json({ data: rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name, kind: r.kind, gtin: r.gtin, ncm: r.ncm, unit: r.unit, price: r.price, costPrice: r.costPrice, active: r.active, stock: av.get(r.id) })), page });
      }
      if (m === 'GET' && id) {
        const p = await findProduct(id);
        if (!p) throw new HttpError(404, 'Produto não encontrado');
        return NextResponse.json({ data: { ...p, stock: (await getAvailability(prisma, a, [p.id])).get(p.id) } });
      }
      if (m === 'POST' && !id) return NextResponse.json({ data: await saveProduct(a, body) });
      if ((m === 'PATCH' || m === 'PUT') && id) {
        const p = await findProduct(id);
        if (!p) throw new HttpError(404, 'Produto não encontrado');
        return NextResponse.json({ data: await saveProduct(a, body, p.id) });
      }
    }
    if (res === 'stock') {
      if (m === 'GET') {
        const sku = url.searchParams.get('sku');
        const rows = await prisma.product.findMany({ where: { organizationId: a.orgId, controlsStock: true, kind: { not: 'VARIACAO_PAI' }, ...(sku ? { sku } : {}) }, select: { id: true, sku: true, name: true } });
        const av = await getAvailability(prisma, a, rows.map((r) => r.id));
        return NextResponse.json({ data: rows.map((r) => ({ sku: r.sku, name: r.name, ...av.get(r.id) })) });
      }
      if (m === 'POST') {
        const p = await findProduct(body.sku || body.productId);
        if (!p) throw new HttpError(404, 'Produto não encontrado');
        const wh = await prisma.warehouse.findFirst({ where: { companyId: a.companyId, isDefault: true } });
        const changed = body.type === 'AJUSTE'
          ? await adjustStock(prisma, { companyId: a.companyId, productId: p.id, warehouseId: wh!.id, newQuantity: Number(body.quantity), notes: body.notes || 'Ajuste via API', userName: a.userName })
          : await moveStock(prisma, { companyId: a.companyId, productId: p.id, warehouseId: wh!.id, quantity: Number(body.quantity), direction: body.type === 'SAIDA' ? 'OUT' : 'IN', origin: 'MANUAL', notes: body.notes || 'Lançamento via API', userName: a.userName });
        await emit('stock.changed', { ...a, productIds: changed });
        return NextResponse.json({ data: (await getAvailability(prisma, a, [p.id])).get(p.id) });
      }
    }
    if (res === 'orders') {
      if (m === 'GET' && !id) {
        const status = url.searchParams.get('status');
        const since = url.searchParams.get('since');
        const rows = await prisma.salesOrder.findMany({ where: { companyId: a.companyId, ...(status ? { status } : {}), ...(since ? { date: { gte: new Date(since) } } : {}) }, include: { items: true, customer: { select: { name: true, document: true } } }, orderBy: { number: 'desc' }, take: 100 });
        return NextResponse.json({ data: rows });
      }
      if (m === 'GET' && id) {
        const o = await prisma.salesOrder.findFirst({ where: { companyId: a.companyId, OR: [{ id }, ...(Number(id) ? [{ number: Number(id) }] : []), { externalId: id }] }, include: { items: true, customer: true, shipments: true } });
        if (!o) throw new HttpError(404, 'Pedido não encontrado');
        return NextResponse.json({ data: o });
      }
      if (m === 'POST' && !id) {
        const c = body.customer || {};
        const doc = onlyDigits(c.document);
        let customer = doc ? await prisma.contact.findFirst({ where: { organizationId: a.orgId, document: doc } }) : null;
        if (!customer) customer = await prisma.contact.create({ data: { organizationId: a.orgId, types: ['CLIENTE'], personType: doc.length === 14 ? 'PJ' : 'PF', name: c.name || 'Cliente API', document: doc || null, email: c.email || null, zip: c.zip || null, street: c.street || null, number: c.number || null, district: c.district || null, city: c.city || null, uf: c.uf || null } });
        const items = [];
        for (const it of body.items || []) {
          const p = await findProduct(it.sku || it.productId);
          if (!p) throw new HttpError(400, `SKU não encontrado: ${it.sku}`);
          items.push({ productId: p.id, quantity: Number(it.quantity), unitPrice: it.unitPrice != null ? Number(it.unitPrice) : undefined });
        }
        const o = await createOrder(a, { customerId: customer.id, externalId: body.externalId, origin: 'API', items, freight: Number(body.freight) || 0, discount: Number(body.discount) || 0, paymentMethod: body.paymentMethod || 'BOLETO', installments: body.installments || 1 });
        return NextResponse.json({ data: o }, { status: 201 });
      }
      if (m === 'POST' && id && sub === 'invoice') return NextResponse.json({ data: await invoiceOrder(a, id) });
      if (m === 'POST' && id && sub === 'cancel') {
        await cancelOrder(a, id, body.reason || 'Cancelado via API');
        return NextResponse.json({ ok: true });
      }
    }
    if (res === 'contacts') {
      if (m === 'GET') {
        const type = url.searchParams.get('type');
        return NextResponse.json({ data: await prisma.contact.findMany({ where: { organizationId: a.orgId, ...(type ? { types: { has: type } } : {}) }, take: 200, orderBy: { name: 'asc' } }) });
      }
      if (m === 'POST') return NextResponse.json({ data: await prisma.contact.create({ data: { organizationId: a.orgId, types: body.types || ['CLIENTE'], personType: body.personType || 'PF', name: body.name, document: onlyDigits(body.document) || null, email: body.email || null, phone: body.phone || null, zip: body.zip || null, city: body.city || null, uf: body.uf || null } }) }, { status: 201 });
    }
    if (res === 'invoices' && m === 'GET') return NextResponse.json({ data: await prisma.invoice.findMany({ where: { companyId: a.companyId }, orderBy: { issueDate: 'desc' }, take: 100, select: { id: true, model: true, number: true, series: true, status: true, accessKey: true, protocol: true, total: true, issueDate: true, customerName: true, salesOrderId: true } }) });
    if (res === 'receivables' && m === 'GET') return NextResponse.json({ data: await prisma.financialEntry.findMany({ where: { companyId: a.companyId, type: 'RECEBER', status: { in: ['ABERTO', 'PARCIAL'] } }, orderBy: { dueDate: 'asc' }, take: 200 }) });
    throw new HttpError(404, `Endpoint não encontrado: ${m} /api/v1/${path.join('/')}`);
  } catch (e) {
    return toErrorResponse(e);
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
