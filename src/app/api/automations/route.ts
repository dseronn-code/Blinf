import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { AUTOMATIONS } from '@/server/services/automations';

export const GET = route('automacoes', 'view', async ({ ctx, query }) => {
  const rows = await prisma.automation.findMany({ where: { companyId: ctx.companyId } });
  const logs = await prisma.automationLog.findMany({ where: { companyId: ctx.companyId, ...(query.get('key') ? { key: query.get('key')! } : {}) }, orderBy: { createdAt: 'desc' }, take: 150 });
  return {
    automations: AUTOMATIONS.map((d) => {
      const r = rows.find((x) => x.key === d.key);
      return { key: d.key, name: d.name, description: d.description, event: d.event, group: d.group, active: r ? r.active : d.defaultActive !== false, runs: r?.runs || 0, lastRunAt: r?.lastRunAt || null };
    }),
    logs: logs.map((l) => ({ ...l, name: AUTOMATIONS.find((d) => d.key === l.key)?.name || l.key })),
  };
});

export const PUT = route('automacoes', 'edit', async ({ ctx, body }) => {
  if (!AUTOMATIONS.find((d) => d.key === body.key)) fail(400, 'Automação inválida');
  return prisma.automation.upsert({ where: { companyId_key: { companyId: ctx.companyId, key: body.key } }, create: { companyId: ctx.companyId, key: body.key, active: !!body.active }, update: { active: !!body.active } });
});
