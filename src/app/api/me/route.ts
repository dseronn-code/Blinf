import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { COMPANY_COOKIE } from '@/server/context';
import { fail } from '@/server/errors';
import { runDailyRoutine } from '@/server/services/automations';
import { isDemoMode } from '@/lib/demo';

// Dados do usuário logado, empresas disponíveis e permissões
export const GET = route(null, 'view', async ({ ctx }) => {
  const companies = await prisma.company.findMany({ where: { id: { in: ctx.companyIds } }, select: { id: true, name: true, tradeName: true, cnpj: true, logoColor: true, uf: true, taxRegime: true }, orderBy: { createdAt: 'asc' } });
  const unread = await prisma.notification.count({ where: { companyId: ctx.companyId, read: false } });
  // Rotina diária de automações (1x por dia por empresa)
  runDailyRoutine({ companyId: ctx.companyId, orgId: ctx.orgId, userName: 'Rotina diária' }).catch(() => {});
  return { user: { id: ctx.userId, name: ctx.userName, email: ctx.email, role: ctx.roleName, isAdmin: ctx.isAdmin }, permissions: ctx.permissions, companyId: ctx.companyId, companies, consolidated: ctx.consolidated, stockMode: ctx.stockMode, unread, demo: isDemoMode(), mustChangePassword: ctx.mustChangePassword };
});

// Troca de empresa ativa / visão consolidada
export const POST = route(null, 'view', async ({ ctx, body }) => {
  const jar = await cookies();
  if (body?.companyId) {
    if (!ctx.companyIds.includes(body.companyId)) fail(403, 'Sem acesso a esta empresa');
    jar.set(COMPANY_COOKIE, body.companyId, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  }
  if (typeof body?.consolidated === 'boolean') jar.set('gp_consolidated', body.consolidated ? '1' : '0', { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  return { ok: true };
});
