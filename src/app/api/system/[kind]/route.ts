import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { enqueue, processJobs } from '@/server/services/jobs';

/** Monitoramento do sistema: trilha de auditoria (audit), caixa de saída (outbox) e fila de tarefas (jobs) */
export const GET = route('configuracoes', 'view', async ({ ctx, params, query }) => {
  const take = Math.min(Number(query.get('take')) || 200, 1000);
  const q = query.get('q')?.trim();
  switch (params.kind) {
    case 'audit': {
      const rows = await prisma.auditLog.findMany({ where: { companyId: { in: ctx.companyIds }, ...(q ? { OR: [{ action: { contains: q, mode: 'insensitive' } }, { details: { contains: q, mode: 'insensitive' } }, { entity: { contains: q, mode: 'insensitive' } }] } : {}) }, orderBy: { createdAt: 'desc' }, take });
      const users = await prisma.user.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true } });
      return rows.map((r) => ({ ...r, user: users.find((u) => u.id === r.userId)?.name || 'Sistema' }));
    }
    case 'outbox':
      return prisma.outboxMessage.findMany({ where: { companyId: { in: ctx.companyIds }, ...(q ? { OR: [{ to: { contains: q, mode: 'insensitive' } }, { subject: { contains: q, mode: 'insensitive' } }] } : {}) }, orderBy: { createdAt: 'desc' }, take });
    case 'jobs': {
      const [rows, stats] = await Promise.all([prisma.job.findMany({ orderBy: { createdAt: 'desc' }, take }), prisma.job.groupBy({ by: ['status'], _count: true })]);
      return { rows, stats: Object.fromEntries(stats.map((s) => [s.status, s._count])) };
    }
    default:
      fail(404, 'Recurso inválido');
  }
});

/** POST /api/system/jobs {action:'run'|'retry', id?} | /api/system/outbox {action:'resend', id} */
export const POST = route('configuracoes', 'edit', async ({ ctx, params, body }) => {
  if (params.kind === 'jobs') {
    if (body?.action === 'retry') {
      await prisma.job.updateMany({ where: { ...(body.id ? { id: body.id } : {}), status: 'ERRO' }, data: { status: 'PENDENTE', attempts: 0, runAt: new Date() } });
    }
    return { processed: await processJobs(100) };
  }
  if (params.kind === 'outbox' && body?.action === 'resend') {
    const m = await prisma.outboxMessage.findFirst({ where: { id: body.id, companyId: { in: ctx.companyIds } } });
    if (!m) fail(404, 'Mensagem não encontrada');
    await prisma.outboxMessage.update({ where: { id: m!.id }, data: { status: 'PENDENTE', error: null } });
    await enqueue('outbox.send', { id: m!.id });
    await processJobs(20);
    return { ok: true };
  }
  fail(400, 'Ação inválida');
});
