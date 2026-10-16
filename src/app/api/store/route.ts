import { prisma } from '@/lib/db';
import { route } from '@/server/http';

export const GET = route('loja', 'view', async ({ ctx }) => {
  let store = await prisma.store.findUnique({ where: { companyId: ctx.companyId } });
  if (!store) {
    const c = await prisma.company.findUnique({ where: { id: ctx.companyId } });
    const slug = (c!.tradeName || c!.name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    store = await prisma.store.create({ data: { companyId: ctx.companyId, slug: `${slug}${Date.now().toString().slice(-3)}`, name: c!.tradeName || c!.name } });
  }
  const orders = await prisma.salesOrder.aggregate({ where: { companyId: ctx.companyId, origin: 'LOJA', status: { not: 'CANCELADO' } }, _count: true, _sum: { total: true } });
  return { ...store, stats: { orders: orders._count, revenue: orders._sum.total || 0 } };
});

export const PUT = route('loja', 'edit', async ({ ctx, body }) => {
  const fields = ['slug', 'name', 'published', 'primaryColor', 'accentColor', 'logoText', 'bannerTitle', 'bannerSubtitle', 'bannerImage', 'aboutText', 'whatsapp', 'freeShippingAbove', 'pixDiscount', 'sections', 'priceListId', 'warehouseId', 'freeShippingUfs', 'customDomain', 'seoTitle', 'seoDescription'];
  const data: any = {};
  for (const f of fields) if (f in body) data[f] = body[f] === '' ? null : body[f];
  if ('freeShippingAbove' in data) data.freeShippingAbove = Number(data.freeShippingAbove) || 0;
  if ('pixDiscount' in data) data.pixDiscount = Number(data.pixDiscount) || 0;
  if ('freeShippingUfs' in data) data.freeShippingUfs = (Array.isArray(data.freeShippingUfs) ? data.freeShippingUfs : String(data.freeShippingUfs || '').split(/[\s,;]+/)).map((u: string) => u.trim().toUpperCase()).filter((u: string) => /^[A-Z]{2}$/.test(u));
  if (data.customDomain) data.customDomain = String(data.customDomain).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (data.slug) data.slug = String(data.slug).toLowerCase().replace(/[^a-z0-9-]/g, '');
  return prisma.store.update({ where: { companyId: ctx.companyId }, data });
});
