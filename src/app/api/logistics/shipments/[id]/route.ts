import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { advanceTracking } from '@/server/services/logistics';

export const POST = route('logistica', 'edit', async ({ ctx, params, body }) => {
  if (body.action === 'advance') return advanceTracking(ctx, params.id);
  if (body.action === 'cancel') return prisma.shipment.updateMany({ where: { id: params.id, companyId: ctx.companyId, status: { in: ['PENDENTE', 'ETIQUETA_GERADA'] } }, data: { status: 'CANCELADO' } });
  fail(400, 'Ação inválida');
});
