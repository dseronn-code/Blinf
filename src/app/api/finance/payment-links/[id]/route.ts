import { prisma } from '@/lib/db';
import { route } from '@/server/http';

export const DELETE = route('financeiro', 'edit', async ({ ctx, params }) => {
  await prisma.paymentLink.updateMany({ where: { id: params.id, companyId: ctx.companyId, status: 'ATIVO' }, data: { status: 'CANCELADO' } });
  return { ok: true };
});
