import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { updateFiscalSettings } from '@/server/services/fiscal';
import { requirePerm } from '@/server/context';

const omit = { certPfx: false, certPassword: false } as const;

export const GET = route(null, 'view', async ({ ctx }) => {
  const c = await prisma.company.findUnique({ where: { id: ctx.companyId }, include: { organization: { select: { name: true, stockMode: true } } }, omit });
  const hasPfx = !!(await prisma.company.count({ where: { id: ctx.companyId, certPfx: { not: null } } }));
  // O CSC (token da NFC-e) não volta para a tela: só indica se está cadastrado
  return { ...c, cscToken: undefined, hasCscToken: !!c?.cscToken, hasPfx };
});

/** Preferências da organização (modo de estoque unificado/separado) */
export const PUT = route('configuracoes', 'edit', async ({ ctx, body }) => {
  if (body.stockMode) await prisma.organization.update({ where: { id: ctx.orgId }, data: { stockMode: body.stockMode === 'UNIFICADO' ? 'UNIFICADO' : 'SEPARADO' } });
  if (body.organizationName) await prisma.organization.update({ where: { id: ctx.orgId }, data: { name: body.organizationName } });
  // Fiscal: modo de emissão, ambiente, CSC da NFC-e e IE de substituto por UF
  if (['fiscalProvider', 'nfeEnvironment', 'cscId', 'cscToken', 'ieSt'].some((k) => body[k] !== undefined)) {
    requirePerm(ctx, 'fiscal', 'edit');
    return { ok: true, ...(await updateFiscalSettings(ctx.companyId, body)) };
  }
  return { ok: true };
});
