import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { savePurchase } from '@/server/services/purchases';

export const GET = route('compras', 'view', async ({ ctx, query }) => {
  const where: any = { companyId: ctx.companyId };
  if (query.get('status')) where.status = { in: query.get('status')!.split(',') };
  const q = query.get('q')?.trim();
  if (q) where.OR = [{ supplier: { name: { contains: q, mode: 'insensitive' } } }, ...(Number(q) ? [{ number: Number(q) }] : [])];
  const rows = await prisma.purchaseOrder.findMany({ where, include: { supplier: { select: { name: true } }, _count: { select: { items: true } } }, orderBy: { number: 'desc' }, take: 300 });
  return { rows, total: rows.length };
});
export const POST = route('compras', 'edit', async ({ ctx, body }) => savePurchase(ctx, body));
