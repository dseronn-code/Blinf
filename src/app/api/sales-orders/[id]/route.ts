import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { updateOrder } from '@/server/services/sales';

export const GET = route('vendas', 'view', async ({ ctx, params }) => {
  const o = await prisma.salesOrder.findFirst({ where: { id: params.id, companyId: { in: ctx.companyIds } }, include: { customer: true, items: true, shipments: true } });
  if (!o) fail(404, 'Pedido não encontrado');
  const [invoices, entries, commission, channel, seller, movements] = await Promise.all([
    prisma.invoice.findMany({ where: { salesOrderId: o!.id }, select: { id: true, model: true, number: true, series: true, status: true, total: true, accessKey: true, issueDate: true } }),
    prisma.financialEntry.findMany({ where: { originId: o!.id }, orderBy: [{ type: 'asc' }, { installment: 'asc' }] }),
    prisma.commission.findFirst({ where: { salesOrderId: o!.id } }),
    o!.channelId ? prisma.salesChannel.findUnique({ where: { id: o!.channelId } }) : null,
    o!.sellerId ? prisma.seller.findUnique({ where: { id: o!.sellerId } }) : null,
    prisma.stockMovement.findMany({ where: { originId: o!.id }, orderBy: { createdAt: 'asc' } }),
  ]);
  const logs = await prisma.automationLog.findMany({ where: { entityId: o!.id }, orderBy: { createdAt: 'asc' } });
  return { ...o, invoices, entries, commission, channel, seller, movements, logs };
});

export const PUT = route('vendas', 'edit', async ({ ctx, params, body }) => updateOrder(ctx, params.id, body));
