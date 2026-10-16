import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { launchInbound } from '@/server/services/purchases';

export const GET = route('compras', 'view', async ({ ctx, params }) => {
  const r = await prisma.inboundInvoice.findFirst({ where: { id: params.id, companyId: ctx.companyId } });
  if (!r) fail(404, 'NF-e não encontrada');
  return r;
});
// Lançar a nota (cria pedido de compra recebido → estoque + contas a pagar)
export const POST = route('compras', 'edit', async ({ ctx, params, body }) => launchInbound(ctx, params.id, { warehouseId: body?.warehouseId, mapping: body?.mapping, createMissing: body?.createMissing !== false }));
export const DELETE = route('compras', 'edit', async ({ ctx, params }) => {
  await prisma.inboundInvoice.updateMany({ where: { id: params.id, companyId: ctx.companyId, status: 'PENDENTE' }, data: { status: 'IGNORADA' } });
  return { ok: true };
});
