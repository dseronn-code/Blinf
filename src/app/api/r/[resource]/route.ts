import { route } from '@/server/http';
import { requirePerm } from '@/server/context';
import { sanitize } from '@/server/resources';
import { getDef, delegate, scopeWhere, clean } from '../_shared';

// GET /api/r/:resource?q=&page=&pageSize=&<filtro>=
export const GET = route(null, 'view', async ({ ctx, params, query }) => {
  const def = getDef(params.resource);
  requirePerm(ctx, def.module, 'view');
  const where: Record<string, unknown> = { ...scopeWhere(def, ctx) };
  const q = query.get('q')?.trim();
  if (q && def.search?.length) where.OR = def.search.map((f) => ({ [f]: { contains: q, mode: 'insensitive' } }));
  for (const [k, fn] of Object.entries(def.filters || {})) {
    const v = query.get(k);
    if (v) Object.assign(where, fn(v));
  }
  const pageSize = Math.min(Number(query.get('pageSize')) || 50, 500);
  const page = Math.max(Number(query.get('page')) || 1, 1);
  const d = delegate(def);
  const [rows, total] = await Promise.all([
    d.findMany({ where, include: def.include, orderBy: def.orderBy, take: pageSize, skip: (page - 1) * pageSize }),
    d.count({ where }),
  ]);
  return { rows: rows.map(clean), total, page, pageSize };
});

// POST /api/r/:resource
export const POST = route(null, 'edit', async ({ ctx, params, body }) => {
  const def = getDef(params.resource);
  requirePerm(ctx, def.module, 'edit');
  let data = sanitize(def, body || {});
  if (def.beforeSave) data = await def.beforeSave(data, ctx);
  if (def.scope === 'org') data.organizationId = ctx.orgId;
  if (def.scope === 'company') data.companyId = ctx.companyId;
  if (def.model === 'user' && !data.companies) data.companies = { create: [{ companyId: ctx.companyId }] };
  const row = await delegate(def).create({ data, include: def.include });
  if (def.afterCreate) await def.afterCreate(row, ctx);
  return clean(row);
});
