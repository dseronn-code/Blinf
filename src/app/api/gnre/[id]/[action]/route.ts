import { prisma } from '@/lib/db';
import { route, fileResponse } from '@/server/http';
import { fail } from '@/server/errors';
import { payGnre, refreshGnre, REVENUE } from '@/server/services/gnre';
import { gnrePdf } from '@/server/pdf';

// POST /api/gnre/:id/pay | refresh
export const POST = route('fiscal', 'edit', async ({ ctx, params, body }) => {
  if (params.action === 'pay') return payGnre(ctx, params.id, { bankAccountId: body?.bankAccountId || null, date: body?.date });
  if (params.action === 'refresh') return refreshGnre(ctx, params.id);
  fail(404, 'Ação inválida');
});

// GET /api/gnre/:id/pdf | xml
export const GET = route('fiscal', 'view', async ({ ctx, params }) => {
  const g = await prisma.gnre.findFirst({ where: { id: params.id, companyId: ctx.companyId } });
  if (!g) fail(404, 'Guia não encontrada');
  if (params.action === 'xml') {
    if (!g!.xml) fail(400, 'Guia sem lote XML');
    return fileResponse(g!.xml!, 'application/xml', `GNRE-${g!.uf}-${g!.revenueCode}.xml`, false);
  }
  if (params.action !== 'pdf') fail(404, 'Ação inválida');
  const company = await prisma.company.findUnique({ where: { id: ctx.companyId } });
  const invoice = g!.invoiceId ? await prisma.invoice.findUnique({ where: { id: g!.invoiceId }, select: { number: true, accessKey: true, customerName: true } }) : null;
  const pdf = await gnrePdf(g!, company!, REVENUE[g!.revenueCode] || g!.revenueCode, invoice);
  return fileResponse(Buffer.from(pdf), 'application/pdf', `GNRE-${g!.uf}-${g!.revenueCode}.pdf`);
});
