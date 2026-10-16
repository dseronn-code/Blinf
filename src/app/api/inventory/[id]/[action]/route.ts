import { prisma } from '@/lib/db';
import { route, fileResponse } from '@/server/http';
import { fail } from '@/server/errors';
import { countScan, setCounts, finishInventoryCount } from '@/server/services/operations';
import { tablePdf } from '@/server/pdf';

export const POST = route('estoque', 'edit', async ({ ctx, params, body }) => {
  switch (params.action) {
    case 'scan':
      return countScan(ctx, params.id, String(body?.code || ''), Number(body?.quantity) || 1);
    case 'set':
      return setCounts(ctx, params.id, body?.items || []);
    case 'finish':
      return finishInventoryCount(ctx, params.id, { zeroNotCounted: !!body?.zeroNotCounted });
    case 'cancel': {
      const r = await prisma.inventoryCount.updateMany({ where: { id: params.id, companyId: ctx.companyId, status: 'ABERTO' }, data: { status: 'CANCELADO', finishedAt: new Date() } });
      if (!r.count) fail(400, 'Inventário não está em aberto');
      return { ok: true };
    }
    default:
      fail(404, 'Ação inválida');
  }
});

// GET /api/inventory/:id/sheet — folha de contagem impressa (cega: sem saldo esperado)
export const GET = route('estoque', 'view', async ({ ctx, params }) => {
  if (params.action !== 'sheet') fail(404, 'Ação inválida');
  const c = await prisma.inventoryCount.findFirst({ where: { id: params.id, companyId: ctx.companyId }, include: { items: true } });
  if (!c) fail(404, 'Inventário não encontrado');
  const products = await prisma.product.findMany({ where: { id: { in: c!.items.map((i) => i.productId) } }, orderBy: [{ location: 'asc' }, { name: 'asc' }] });
  const pdf = await tablePdf(
    `Folha de contagem — Inventário nº ${c!.number}`,
    [{ key: 'location', label: 'Local' }, { key: 'sku', label: 'Código' }, { key: 'name', label: 'Produto' }, { key: 'unit', label: 'Un' }, { key: 'counted', label: 'Contado' }],
    products.map((p) => ({ location: p.location || '-', sku: p.sku, name: p.name, unit: p.unit, counted: '________' })),
    `Contagem cega (sem saldo do sistema). Responsável: ____________________  Data: ___/___/_____`,
  );
  return fileResponse(Buffer.from(pdf), 'application/pdf', `inventario-${c!.number}.pdf`);
});
