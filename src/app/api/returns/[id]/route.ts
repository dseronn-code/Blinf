import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';

export const GET = route('vendas', 'view', async ({ ctx, params }) => {
  const r = await prisma.salesReturn.findFirst({ where: { id: params.id, companyId: { in: ctx.companyIds } } });
  if (!r) fail(404, 'Devolução não encontrada');
  const [order, invoice, refund, exchange] = await Promise.all([
    prisma.salesOrder.findUnique({ where: { id: r!.salesOrderId }, select: { id: true, number: true, customer: { select: { name: true } } } }),
    r!.invoiceId ? prisma.invoice.findUnique({ where: { id: r!.invoiceId }, select: { id: true, number: true, status: true, accessKey: true, refAccessKey: true } }) : null,
    r!.refundEntryId ? prisma.financialEntry.findUnique({ where: { id: r!.refundEntryId } }) : null,
    r!.exchangeOrderId ? prisma.salesOrder.findUnique({ where: { id: r!.exchangeOrderId }, select: { id: true, number: true, status: true } }) : null,
  ]);
  return { ...r, order, invoice, refund, exchange };
});
