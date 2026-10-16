import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { quoteFreight, orderPackage } from '@/server/services/logistics';

/** Cotação de frete por pedido ({ orderId }) ou por pacote ({ toZip, weight, ... }) */
export const POST = route(null, 'view', async ({ ctx, body }) => {
  const company = await prisma.company.findUnique({ where: { id: ctx.companyId } });
  if (body.orderId) {
    const { order, ...pkg } = await orderPackage(body.orderId);
    const to = (order.shipTo || {}) as { zip?: string };
    return { package: pkg, options: quoteFreight({ fromZip: company?.zip || '', toZip: to.zip || '', ...pkg, value: order.total }) };
  }
  return { options: quoteFreight({ fromZip: body.fromZip || company?.zip || '', toZip: body.toZip, weight: Number(body.weight) || 0.3, height: Number(body.height) || 10, width: Number(body.width) || 15, length: Number(body.length) || 20, value: Number(body.value) || 0 }) };
});
