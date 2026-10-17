import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { generateGnreForInvoice } from '@/server/services/gnre';

/** Guias GNRE (ICMS-ST / DIFAL / FCP para outras UFs) */
export const GET = route('fiscal', 'view', async ({ ctx, query }) => {
  const where: any = { companyId: ctx.companyId };
  if (query.get('status')) where.status = query.get('status');
  if (query.get('invoiceId')) where.invoiceId = query.get('invoiceId');
  const rows = await prisma.gnre.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300, omit: { xml: true } });
  const invoices = await prisma.invoice.findMany({ where: { id: { in: rows.map((r) => r.invoiceId).filter(Boolean) as string[] } }, select: { id: true, number: true, customerName: true } });
  return rows.map((r) => ({ ...r, invoice: invoices.find((i) => i.id === r.invoiceId) || null }));
});

export const POST = route('fiscal', 'edit', async ({ ctx, body }) => {
  if (!body?.invoiceId) fail(400, 'Informe a nota fiscal');
  return generateGnreForInvoice(ctx, body.invoiceId);
});
