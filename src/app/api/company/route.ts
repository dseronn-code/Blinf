import { prisma } from '@/lib/db';
import { route } from '@/server/http';

export const GET = route(null, 'view', async ({ ctx }) => prisma.company.findUnique({ where: { id: ctx.companyId }, include: { organization: { select: { name: true, stockMode: true } } } }));

/** Preferências da organização (modo de estoque unificado/separado) */
export const PUT = route('configuracoes', 'edit', async ({ ctx, body }) => {
  if (body.stockMode) await prisma.organization.update({ where: { id: ctx.orgId }, data: { stockMode: body.stockMode === 'UNIFICADO' ? 'UNIFICADO' : 'SEPARADO' } });
  if (body.organizationName) await prisma.organization.update({ where: { id: ctx.orgId }, data: { name: body.organizationName } });
  return { ok: true };
});
