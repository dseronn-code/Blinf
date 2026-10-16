import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { advanceTracking } from '@/server/services/logistics';
import { setShipmentVolumes } from '@/server/services/operations';

export const POST = route('logistica', 'edit', async ({ ctx, params, body }) => {
  if (body.action === 'advance') return advanceTracking(ctx, params.id);
  if (body.action === 'volumes') return setShipmentVolumes(ctx, params.id, Number(body.volumes), body.weight ? Number(body.weight) : undefined);
  if (body.action === 'cancel') return prisma.shipment.updateMany({ where: { id: params.id, companyId: ctx.companyId, status: { in: ['PENDENTE', 'ETIQUETA_GERADA'] } }, data: { status: 'CANCELADO' } });
  fail(400, 'Ação inválida');
});
