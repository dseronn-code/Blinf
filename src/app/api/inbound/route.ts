import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { importNfeXml } from '@/server/services/purchases';

export const GET = route('compras', 'view', async ({ ctx }) => {
  const rows = await prisma.inboundInvoice.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: 'desc' }, select: { id: true, accessKey: true, number: true, series: true, issueDate: true, supplierName: true, supplierCnpj: true, total: true, status: true, items: true, purchaseOrderId: true, createdAt: true } });
  return { rows };
});

/** Upload de XML (multipart "file" ou JSON { xml }) */
export const POST = route('compras', 'edit', async ({ ctx, req, body }) => {
  let xml = body?.xml as string | undefined;
  if (!xml) {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file') as File | null;
    if (file) xml = await file.text();
  }
  if (!xml) fail(400, 'Envie o arquivo XML da NF-e');
  return importNfeXml(ctx, xml!);
});
