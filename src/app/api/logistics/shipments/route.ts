import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { estimatedDelivery } from '@/server/services/logistics';

export const GET = route('logistica', 'view', async ({ ctx, query }) => {
  const where: any = { companyId: ctx.companyId };
  if (query.get('status')) where.status = { in: query.get('status')!.split(',') };
  const q = query.get('q')?.trim();
  if (q) where.OR = [{ trackingCode: { contains: q, mode: 'insensitive' } }, { salesOrder: { customer: { name: { contains: q, mode: 'insensitive' } } } }];
  const rows = await prisma.shipment.findMany({ where, include: { salesOrder: { select: { id: true, number: true, externalId: true, total: true, status: true, shipTo: true, customer: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' }, take: 300 });
  return { rows: rows.map((r) => ({ ...r, eta: estimatedDelivery(r) })) };
});
