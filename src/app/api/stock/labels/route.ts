import { prisma } from '@/lib/db';
import { route, fileResponse } from '@/server/http';
import { productLabelsPdf, stockLabelsPdf } from '@/server/pdf';

/**
 * Etiquetas em PDF.
 * ?type=product&items=<productId>:<cópias>,...&price=1
 * ?type=stock&items=<productId>,...&warehouseId=
 */
export const GET = route('estoque', 'view', async ({ ctx, query }) => {
  const pairs = (query.get('items') || '').split(',').filter(Boolean).map((s) => s.split(':'));
  const ids = pairs.map((p) => p[0]);
  const products = await prisma.product.findMany({ where: { organizationId: ctx.orgId, ...(ids.length ? { id: { in: ids } } : { kind: { not: 'VARIACAO_PAI' } }) }, include: { balances: { include: { warehouse: true } }, lots: { where: { quantity: { gt: 0 } } } }, take: 300 });
  if (query.get('type') === 'stock') {
    const wh = query.get('warehouseId');
    type L = { sku: string; name: string; location: string | null; lot: string | null; expiresAt: Date | null; quantity: number; warehouse: string };
    const items = products.flatMap((p): L[] => {
      const bals = p.balances.filter((b) => (!wh || b.warehouseId === wh) && b.warehouse.companyId === ctx.companyId);
      if (p.controlsLot && p.lots.length) return p.lots.filter((l) => !wh || l.warehouseId === wh).map((l) => ({ sku: p.sku, name: p.name, location: p.location, lot: l.lotNumber, expiresAt: l.expiresAt, quantity: l.quantity, warehouse: bals.find((b) => b.warehouseId === l.warehouseId)?.warehouse.name || '' }));
      return bals.map((b) => ({ sku: p.sku, name: p.name, location: p.location, lot: null, expiresAt: null, quantity: b.quantity, warehouse: b.warehouse.name }));
    });
    return fileResponse(Buffer.from(await stockLabelsPdf(items)), 'application/pdf', 'etiquetas-estoque.pdf');
  }
  const items = products.map((p) => ({ sku: p.sku, name: p.name, price: p.price, gtin: p.gtin, copies: Number(pairs.find((x) => x[0] === p.id)?.[1] || 1), extra: p.location || undefined }));
  return fileResponse(Buffer.from(await productLabelsPdf(items, { showPrice: query.get('price') !== '0' })), 'application/pdf', 'etiquetas-produtos.pdf');
});
