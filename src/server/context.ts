import { getServerSession } from 'next-auth';
import { cookies } from 'next/headers';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { can, type AccessLevel, type ModuleKey, type Permissions } from '@/lib/permissions';
import { HttpError } from './errors';

export const COMPANY_COOKIE = 'gp_company';

export type Ctx = {
  userId: string;
  userName: string;
  email: string;
  orgId: string;
  companyId: string;
  companyIds: string[];
  isAdmin: boolean;
  roleName: string;
  permissions: Permissions;
  stockMode: string;
  /** true quando o usuário pediu visão consolidada (todas as empresas) */
  consolidated: boolean;
  /** entrou com senha padrão/fraca fora do modo demonstração: precisa trocar antes de continuar */
  mustChangePassword: boolean;
  /** usuário da organização de demonstração (dados fictícios, integrações simuladas) */
  demo: boolean;
};

/**
 * Resolve o contexto da requisição: usuário autenticado + empresa ativa (cookie).
 * Lança 401 quando não autenticado.
 */
export async function getCtx(): Promise<Ctx> {
  const session = await getServerSession(authOptions);
  const uid = (session?.user as { id?: string } | undefined)?.id;
  if (!uid) throw new HttpError(401, 'Não autenticado');
  const user = await prisma.user.findUnique({
    where: { id: uid },
    include: { role: true, organization: true, companies: true },
  });
  if (!user || !user.active) throw new HttpError(401, 'Usuário inativo');
  const companyIds = user.role.isAdmin
    ? (await prisma.company.findMany({ where: { organizationId: user.organizationId }, select: { id: true }, orderBy: { createdAt: 'asc' } })).map((c) => c.id)
    : user.companies.map((c) => c.companyId);
  if (!companyIds.length) throw new HttpError(403, 'Usuário sem acesso a nenhuma empresa');
  const jar = await cookies();
  const wanted = jar.get(COMPANY_COOKIE)?.value;
  const companyId = wanted && companyIds.includes(wanted) ? wanted : companyIds[0];
  return {
    userId: user.id,
    userName: user.name,
    email: user.email,
    orgId: user.organizationId,
    companyId,
    companyIds,
    isAdmin: user.role.isAdmin,
    roleName: user.role.name,
    permissions: (user.role.permissions || {}) as Permissions,
    stockMode: user.organization.stockMode,
    consolidated: jar.get('gp_consolidated')?.value === '1',
    mustChangePassword: !!(session?.user as { mustChangePassword?: boolean } | undefined)?.mustChangePassword,
    demo: user.organization.demo,
  };
}

export function requirePerm(ctx: Ctx, mod: ModuleKey, level: AccessLevel = 'view') {
  if (!can(ctx.permissions, ctx.isAdmin, mod, level)) {
    throw new HttpError(403, `Sem permissão para ${level === 'edit' ? 'alterar' : 'acessar'} o módulo "${mod}"`);
  }
}

/** Filtro de empresa para consultas (respeita visão consolidada quando permitido) */
export function companyScope(ctx: Ctx, allowConsolidated = false) {
  if (allowConsolidated && ctx.consolidated) return { companyId: { in: ctx.companyIds } };
  return { companyId: ctx.companyId };
}
