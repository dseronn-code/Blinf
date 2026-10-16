import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { emit } from '@/server/events';

export const GET = route('integracoes', 'view', async ({ ctx, params }) => {
  const ch = await prisma.salesChannel.findFirst({ where: { id: params.id, companyId: ctx.companyId }, include: { logs: { orderBy: { createdAt: 'desc' }, take: 100 } } });
  if (!ch) fail(404, 'Canal não encontrado');
  const listings = await prisma.listing.findMany({ where: { channelId: ch!.id }, include: { product: { select: { sku: true, name: true, price: true } } }, orderBy: { title: 'asc' } });
  const orders = await prisma.salesOrder.findMany({ where: { channelId: ch!.id }, include: { customer: { select: { name: true } } }, orderBy: { number: 'desc' }, take: 30 });
  return { ...ch, listings, orders };
});

export const PUT = route('integracoes', 'edit', async ({ ctx, params, body }) => {
  const ch = await prisma.salesChannel.findFirst({ where: { id: params.id, companyId: ctx.companyId } });
  if (!ch) fail(404, 'Canal não encontrado');
  const data: any = {};
  for (const f of ['syncStock', 'syncPrice', 'autoImport']) if (f in body) data[f] = !!body[f];
  for (const f of ['priceListId', 'warehouseId', 'storeName']) if (f in body) data[f] = body[f] || null;
  if ('feePercent' in body) data.feePercent = Number(body.feePercent) || 0;
  const updated = await prisma.salesChannel.update({ where: { id: params.id }, data });
  if ('priceListId' in body) await emit('product.price_changed', { companyId: ctx.companyId, orgId: ctx.orgId });
  return updated;
});
