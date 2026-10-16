import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { CONNECTORS, connectChannel } from '@/server/services/integrations';

export const GET = route('integracoes', 'view', async ({ ctx }) => {
  const channels = await prisma.salesChannel.findMany({ where: { companyId: ctx.companyId }, include: { _count: { select: { listings: true } } } });
  const orders = await prisma.salesOrder.groupBy({ by: ['channelId'], where: { companyId: ctx.companyId, channelId: { not: null }, status: { not: 'CANCELADO' } }, _count: true, _sum: { total: true } });
  return {
    connectors: CONNECTORS.map((c) => {
      const ch = channels.find((x) => x.provider === c.provider);
      const o = ch ? orders.find((x) => x.channelId === ch.id) : null;
      return { ...c, channel: ch ? { ...ch, orders: o?._count || 0, revenue: o?._sum.total || 0 } : null };
    }),
  };
});

export const POST = route('integracoes', 'edit', async ({ ctx, body }) => connectChannel(ctx, body.provider, body.storeName));
