import { prisma } from '@/lib/db';
import { route } from '@/server/http';

export const GET = route('integracoes', 'view', async ({ ctx, query }) => {
  const rows = await prisma.integrationLog.findMany({ where: { channel: { companyId: ctx.companyId }, ...(query.get('channelId') ? { channelId: query.get('channelId')! } : {}), ...(query.get('type') ? { type: query.get('type')! } : {}) }, include: { channel: { select: { name: true, provider: true } } }, orderBy: { createdAt: 'desc' }, take: 300 });
  return { rows };
});
