import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { saveQuote } from '@/server/services/sales';

export const GET = route('vendas', 'view', async ({ ctx, query }) => {
  const where: any = { companyId: ctx.companyId };
  if (query.get('status')) where.status = query.get('status');
  const q = query.get('q')?.trim();
  if (q) where.OR = [{ customer: { name: { contains: q, mode: 'insensitive' } } }, ...(Number(q) ? [{ number: Number(q) }] : [])];
  const rows = await prisma.quote.findMany({ where, include: { customer: { select: { name: true } }, _count: { select: { items: true } } }, orderBy: { number: 'desc' }, take: 200 });
  return { rows, total: rows.length };
});
export const POST = route('vendas', 'edit', async ({ ctx, body }) => saveQuote(ctx, body));
