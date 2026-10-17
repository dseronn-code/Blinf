import { prisma } from '@/lib/db';
import { route, fileResponse } from '@/server/http';
import { fail } from '@/server/errors';
import { transmitMdfe, closeMdfe, cancelMdfe } from '@/server/services/mdfe';
import { damdfePdf } from '@/server/pdf';

// POST /api/mdfe/:id/transmit | close | cancel
export const POST = route('fiscal', 'edit', async ({ ctx, params, body }) => {
  if (params.action === 'transmit') return transmitMdfe(ctx, params.id);
  if (params.action === 'close') return closeMdfe(ctx, params.id, { date: body?.date });
  if (params.action === 'cancel') return cancelMdfe(ctx, params.id, body?.reason || '');
  fail(404, 'Ação inválida');
});

// GET /api/mdfe/:id/damdfe | xml
export const GET = route('fiscal', 'view', async ({ ctx, params }) => {
  const m = await prisma.mdfe.findFirst({ where: { id: params.id, companyId: ctx.companyId } });
  if (!m) fail(404, 'MDF-e não encontrado');
  if (params.action === 'xml') {
    if (!m!.xml) fail(400, 'MDF-e sem XML (não transmitido)');
    return fileResponse(m!.xml!, 'application/xml', `${m!.accessKey || `mdfe-${m!.number}`}.xml`, false);
  }
  if (params.action !== 'damdfe') fail(404, 'Ação inválida');
  const company = await prisma.company.findUnique({ where: { id: ctx.companyId } });
  const invoices = await prisma.invoice.findMany({ where: { companyId: ctx.companyId, accessKey: { in: m!.invoiceKeys } }, select: { number: true, series: true, accessKey: true, customerName: true, total: true } });
  const pdf = await damdfePdf(m!, company!, invoices);
  return fileResponse(Buffer.from(pdf), 'application/pdf', `DAMDFE-${m!.number}.pdf`);
});
