import { route } from '@/server/http';
import { requirePerm } from '@/server/context';
import { sanitize } from '@/server/resources';
import { fail } from '@/server/errors';
import { getDef, delegate, scopeWhere, clean } from '../../_shared';

async function findScoped(resource: string, id: string, ctx: Parameters<typeof scopeWhere>[1]) {
  const def = getDef(resource);
  const row = await delegate(def).findFirst({ where: { id, ...scopeWhere(def, ctx) }, include: def.include });
  if (!row) fail(404, 'Registro não encontrado');
  return { def, row };
}

export const GET = route(null, 'view', async ({ ctx, params }) => {
  const { def, row } = await findScoped(params.resource, params.id, ctx);
  requirePerm(ctx, def.module, 'view');
  return clean(row);
});

export const PUT = route(null, 'edit', async ({ ctx, params, body }) => {
  const { def } = await findScoped(params.resource, params.id, ctx);
  requirePerm(ctx, def.module, 'edit');
  let data = sanitize(def, body || {});
  if (def.beforeSave) data = await def.beforeSave(data, ctx, params.id);
  const row = await delegate(def).update({ where: { id: params.id }, data, include: def.include });
  if (params.resource === 'price-lists') {
    const { emit } = await import('@/server/events');
    await emit('product.price_changed', { companyId: ctx.companyId, orgId: ctx.orgId });
  }
  return clean(row);
});

export const DELETE = route(null, 'edit', async ({ ctx, params }) => {
  const { def } = await findScoped(params.resource, params.id, ctx);
  requirePerm(ctx, def.module, 'edit');
  if (def.canDelete) await def.canDelete(params.id, ctx);
  await delegate(def).delete({ where: { id: params.id } });
  return { ok: true };
});
