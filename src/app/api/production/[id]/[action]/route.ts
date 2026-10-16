import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { startProduction, finishProduction } from '@/server/services/production';

export const POST = route('producao', 'edit', async ({ ctx, params, body }) => {
  switch (params.action) {
    case 'start':
      await startProduction(ctx, params.id);
      return { ok: true };
    case 'finish':
      return finishProduction(ctx, params.id, body?.producedQty ? Number(body.producedQty) : undefined);
    case 'cancel':
      return prisma.productionOrder.updateMany({ where: { id: params.id, companyId: ctx.companyId, status: { in: ['PLANEJADA', 'EM_PRODUCAO'] } }, data: { status: 'CANCELADA' } });
    case 'reschedule':
      return prisma.productionOrder.updateMany({ where: { id: params.id, companyId: ctx.companyId }, data: { ...(body.startDate ? { startDate: new Date(body.startDate) } : {}), ...(body.dueDate ? { dueDate: new Date(body.dueDate) } : {}) } });
    default:
      fail(404, 'Ação inválida');
  }
});
