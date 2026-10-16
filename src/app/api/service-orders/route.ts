import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { saveServiceOrder } from '@/server/services/serviceOrders';

export const GET = route('servicos', 'view', async ({ ctx, query }) => {
  const where: any = { companyId: ctx.companyId };
  if (query.get('status')) where.status = { in: query.get('status')!.split(',') };
  const q = query.get('q')?.trim();
  if (q) where.OR = [{ customer: { name: { contains: q, mode: 'insensitive' } } }, { equipment: { contains: q, mode: 'insensitive' } }, { serialNumber: { contains: q } }, ...(Number(q) ? [{ number: Number(q) }] : [])];
  const rows = await prisma.serviceOrder.findMany({ where, include: { customer: { select: { name: true } } }, orderBy: { number: 'desc' } });
  const techs = await prisma.seller.findMany({ where: { organizationId: ctx.orgId } });
  return { rows: rows.map((r) => ({ ...r, technician: techs.find((t) => t.id === r.technicianId)?.name })) };
});
export const POST = route('servicos', 'edit', async ({ ctx, body }) => saveServiceOrder(ctx, body));
