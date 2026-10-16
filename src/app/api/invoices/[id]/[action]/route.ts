import { prisma } from '@/lib/db';
import { route, fileResponse } from '@/server/http';
import { fail } from '@/server/errors';
import { transmitInvoice, cancelInvoice } from '@/server/services/fiscal';
import { danfePdf } from '@/server/pdf';

export const POST = route('fiscal', 'edit', async ({ ctx, params, body }) => {
  switch (params.action) {
    case 'transmit':
      return transmitInvoice(ctx.companyId, ctx.orgId, params.id, ctx.userName);
    case 'cancel':
      await cancelInvoice(ctx.companyId, ctx.orgId, params.id, body?.reason || '', ctx.userName);
      return { ok: true };
    case 'cce': {
      const inv = await prisma.invoice.findFirst({ where: { id: params.id, companyId: ctx.companyId, status: 'AUTORIZADA' } });
      if (!inv) fail(400, 'Carta de correção só para notas autorizadas');
      if (!body?.text || body.text.length < 15) fail(400, 'A correção deve ter no mínimo 15 caracteres');
      return prisma.invoiceEvent.create({ data: { invoiceId: params.id, type: 'CCE', code: '135', protocol: `1${Date.now()}`, description: `Carta de correção: ${body.text}` } });
    }
    default:
      fail(404, 'Ação inválida');
  }
});

// GET /api/invoices/:id/danfe | /xml
export const GET = route('fiscal', 'view', async ({ ctx, params }) => {
  const inv = await prisma.invoice.findFirst({ where: { id: params.id, companyId: { in: ctx.companyIds } }, include: { items: true } });
  if (!inv) fail(404, 'Nota não encontrada');
  if (params.action === 'xml') {
    if (!inv!.xml) fail(400, 'Nota sem XML (não autorizada)');
    return fileResponse(inv!.xml!, 'application/xml', `${inv!.accessKey || 'nfse-' + inv!.number}.xml`, false);
  }
  if (params.action !== 'danfe') fail(404, 'Ação inválida');
  const company = await prisma.company.findUnique({ where: { id: inv!.companyId } });
  const customer = inv!.customerId ? await prisma.contact.findUnique({ where: { id: inv!.customerId } }) : null;
  const pdf = await danfePdf(inv!, company!, customer);
  return fileResponse(Buffer.from(pdf), 'application/pdf', `${inv!.model}-${inv!.number}.pdf`);
});
