import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { savePurchase } from '@/server/services/purchases';

export const GET = route('compras', 'view', async ({ ctx, params }) => {
  const po = await prisma.purchaseOrder.findFirst({ where: { id: params.id, companyId: ctx.companyId }, include: { supplier: true, items: { include: { product: { select: { sku: true, gtin: true, unit: true, controlsLot: true } } } } } });
  if (!po) fail(404, 'Pedido de compra não encontrado');
  const [entries, movements] = await Promise.all([prisma.financialEntry.findMany({ where: { originId: po!.id }, orderBy: { installment: 'asc' } }), prisma.stockMovement.findMany({ where: { originId: po!.id } })]);
  return { ...po, entries, movements };
});
export const PUT = route('compras', 'edit', async ({ ctx, params, body }) => savePurchase(ctx, body, params.id));
