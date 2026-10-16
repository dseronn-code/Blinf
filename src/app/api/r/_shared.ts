import { prisma } from '@/lib/db';
import { RESOURCES, type ResourceDef } from '@/server/resources';
import { fail } from '@/server/errors';
import type { Ctx } from '@/server/context';

export function getDef(name: string): ResourceDef {
  const def = RESOURCES[name];
  if (!def) fail(404, `Recurso desconhecido: ${name}`);
  return def!;
}

export const delegate = (def: ResourceDef) => (prisma as any)[def.model];

export function scopeWhere(def: ResourceDef, ctx: Ctx): Record<string, unknown> {
  if (def.listWhere) return def.listWhere(ctx);
  if (def.scope === 'org') return { organizationId: ctx.orgId };
  if (def.scope === 'company') return { companyId: ctx.companyId };
  return {};
}

/** Remove campos sensíveis das respostas */
export function clean<T>(row: T): T {
  if (row && typeof row === 'object') delete (row as Record<string, unknown>).passwordHash;
  return row;
}
