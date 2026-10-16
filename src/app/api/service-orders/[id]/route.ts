import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { saveServiceOrder } from '@/server/services/serviceOrders';

export const GET = route('servicos', 'view', async ({ ctx, params }) => {
  const os = await prisma.serviceOrder.findFirst({ where: { id: params.id, companyId: ctx.companyId }, include: { items: true, history: { orderBy: { createdAt: 'asc' } }, customer: true } });
  if (!os) fail(404, 'OS não encontrada');
  const [entries, invoice] = await Promise.all([prisma.financialEntry.findMany({ where: { originId: os!.id } }), os!.invoiceId ? prisma.invoice.findUnique({ where: { id: os!.invoiceId }, select: { id: true, number: true, status: true, model: true } }) : null]);
  return { ...os, entries, invoice };
});
export const PUT = route('servicos', 'edit', async ({ ctx, params, body }) => saveServiceOrder(ctx, body, params.id));
