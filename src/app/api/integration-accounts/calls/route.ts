import { prisma } from '@/lib/db';
import { route } from '@/server/http';

/** Histórico de chamadas às APIs externas e notificações recebidas */
export const GET = route('integracoes', 'view', async ({ ctx, query }) => {
  const provider = query.get('provider') || undefined;
  const [calls, events] = await Promise.all([
    prisma.integrationCall.findMany({ where: { companyId: ctx.companyId, ...(provider ? { provider } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.inboundEvent.findMany({ where: { companyId: ctx.companyId, ...(provider ? { provider } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);
  return { calls, events };
});
