import { prisma } from '@/lib/db';
import { route, fileResponse } from '@/server/http';
import { shippingLabelPdf } from '@/server/pdf';

// GET /api/logistics/labels?ids=shipmentId,shipmentId
export const GET = route('logistica', 'view', async ({ ctx, query }) => {
  const ids = (query.get('ids') || '').split(',').filter(Boolean);
  const shipments = await prisma.shipment.findMany({ where: { companyId: ctx.companyId, ...(ids.length ? { id: { in: ids } } : { status: 'ETIQUETA_GERADA' }) }, include: { salesOrder: { include: { customer: { select: { name: true } } } } } });
  const company = await prisma.company.findUnique({ where: { id: ctx.companyId } });
  const pdf = await shippingLabelPdf(shipments.map((s) => ({ shipment: s, order: s.salesOrder, company: company! })));
  return fileResponse(Buffer.from(pdf), 'application/pdf', 'etiquetas-envio.pdf');
});
