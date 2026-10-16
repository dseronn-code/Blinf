import { prisma } from '@/lib/db';
import { route } from '@/server/http';

export const GET = route(null, 'view', async ({ ctx }) => ({ rows: await prisma.notification.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: 'desc' }, take: 40 }), unread: await prisma.notification.count({ where: { companyId: ctx.companyId, read: false } }) }));

export const POST = route(null, 'view', async ({ ctx, body }) => {
  await prisma.notification.updateMany({ where: { companyId: ctx.companyId, ...(body?.id ? { id: body.id } : {}) }, data: { read: true } });
  return { ok: true };
});
