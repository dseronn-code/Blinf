import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { createReturn } from '@/server/services/returns';

/** Devoluções e trocas de venda */
export const GET = route('vendas', 'view', async ({ ctx, query }) => {
  const where: any = { companyId: ctx.consolidated ? { in: ctx.companyIds } : ctx.companyId };
  if (query.get('salesOrderId')) where.salesOrderId = query.get('salesOrderId');
  const rows = await prisma.salesReturn.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 });
  const orders = await prisma.salesOrder.findMany({ where: { id: { in: rows.map((r) => r.salesOrderId) } }, select: { id: true, number: true, customer: { select: { name: true } } } });
  const invoices = await prisma.invoice.findMany({ where: { id: { in: rows.map((r) => r.invoiceId).filter(Boolean) as string[] } }, select: { id: true, number: true, status: true } });
  return rows.map((r) => ({ ...r, order: orders.find((o) => o.id === r.salesOrderId), invoice: invoices.find((i) => i.id === r.invoiceId) }));
});

export const POST = route('vendas', 'edit', async ({ ctx, body }) => createReturn(ctx, body));
