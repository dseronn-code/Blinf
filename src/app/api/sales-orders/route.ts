import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { createOrder } from '@/server/services/sales';

export const GET = route('vendas', 'view', async ({ ctx, query }) => {
  const where: any = { companyId: ctx.consolidated ? { in: ctx.companyIds } : ctx.companyId };
  const q = query.get('q')?.trim();
  if (q) where.OR = [{ customer: { name: { contains: q, mode: 'insensitive' } } }, { externalId: { contains: q } }, ...(Number(q) ? [{ number: Number(q) }] : [])];
  if (query.get('status')) where.status = { in: query.get('status')!.split(',') };
  if (query.get('channelId')) where.channelId = query.get('channelId');
  if (query.get('origin')) where.origin = query.get('origin');
  if (query.get('sellerId')) where.sellerId = query.get('sellerId');
  if (query.get('from') || query.get('to')) where.date = { ...(query.get('from') ? { gte: new Date(query.get('from')!) } : {}), ...(query.get('to') ? { lte: new Date(query.get('to') + 'T23:59:59') } : {}) };
  const pageSize = Math.min(Number(query.get('pageSize')) || 50, 500);
  const page = Math.max(Number(query.get('page')) || 1, 1);
  const [rows, total, sum] = await Promise.all([
    prisma.salesOrder.findMany({ where, include: { customer: { select: { name: true, document: true } }, _count: { select: { items: true } }, shipments: { select: { trackingCode: true, status: true } } }, orderBy: { number: 'desc' }, take: pageSize, skip: (page - 1) * pageSize }),
    prisma.salesOrder.count({ where }),
    prisma.salesOrder.aggregate({ where, _sum: { total: true } }),
  ]);
  const channels = await prisma.salesChannel.findMany({ where: { companyId: { in: ctx.companyIds } }, select: { id: true, name: true, provider: true } });
  const sellers = await prisma.seller.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true } });
  return { rows: rows.map((r) => ({ ...r, channel: channels.find((c) => c.id === r.channelId), seller: sellers.find((s) => s.id === r.sellerId) })), total, page, pageSize, sum: sum._sum.total || 0 };
});

export const POST = route('vendas', 'edit', async ({ ctx, body }) => createOrder(ctx, body));
