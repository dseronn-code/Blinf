import { prisma } from '@/lib/db';
import { route, fileResponse } from '@/server/http';
import { labelsPdf } from '@/server/services/logistics';

// GET /api/logistics/labels?ids=shipmentId,shipmentId — etiqueta oficial do provedor (quando comprada), de endereçamento (frete próprio) ou simulada (só demonstração)
export const GET = route('logistica', 'view', async ({ ctx, query }) => {
  const ids = (query.get('ids') || '').split(',').filter(Boolean);
  const shipments = await prisma.shipment.findMany({ where: { companyId: ctx.companyId, ...(ids.length ? { id: { in: ids } } : { status: 'ETIQUETA_GERADA' }) }, include: { salesOrder: { include: { customer: { select: { name: true } } } } } });
  const company = await prisma.company.findUnique({ where: { id: ctx.companyId } });
  const pdf = await labelsPdf(shipments.filter((s) => s.status !== 'PENDENTE').map((s) => ({ shipment: s, order: s.salesOrder, company: company! })));
  return fileResponse(Buffer.from(pdf), 'application/pdf', 'etiquetas-envio.pdf');
});
