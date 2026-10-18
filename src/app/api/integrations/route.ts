import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { visibleConnectors, connectChannel } from '@/server/services/integrations';
import { syncAccountChannels, MARKETPLACE_PROVIDERS } from '@/server/services/marketplace';

export const GET = route('integracoes', 'view', async ({ ctx }) => {
  // Canais ligados às contas reais (Integrações → Contas) antes de montar a lista
  await syncAccountChannels(ctx.companyId).catch(() => {});
  const [channels, accounts] = await Promise.all([
    prisma.salesChannel.findMany({ where: { companyId: ctx.companyId }, include: { _count: { select: { listings: true } } }, orderBy: { createdAt: 'asc' } }),
    prisma.integrationAccount.findMany({ where: { companyId: ctx.companyId, provider: { in: MARKETPLACE_PROVIDERS } }, select: { id: true, provider: true, status: true, accountName: true, lastError: true } }),
  ]);
  const orders = await prisma.salesOrder.groupBy({ by: ['channelId'], where: { companyId: ctx.companyId, channelId: { not: null }, status: { not: 'CANCELADO' } }, _count: true, _sum: { total: true } });
  return {
    connectors: visibleConnectors().map((c) => {
      const ch = channels.find((x) => x.provider === c.provider);
      const o = ch ? orders.find((x) => x.channelId === ch.id) : null;
      const acc = accounts.find((a) => a.provider === c.provider) || null;
      const { accessToken: _t, ...config } = ((ch?.config || {}) as Record<string, unknown>);
      const real = !!ch && !!acc && config.realAccountId === acc.id && acc.status === 'CONECTADO';
      return {
        ...c,
        // supportsReal: conector com integração real disponível em Integrações → Contas
        supportsReal: MARKETPLACE_PROVIDERS.includes(c.provider),
        account: acc ? { status: acc.status, accountName: acc.accountName, lastError: acc.lastError } : null,
        channel: ch ? { ...ch, config, real, orders: o?._count || 0, revenue: o?._sum.total || 0 } : null,
      };
    }),
  };
});

export const POST = route('integracoes', 'edit', async ({ ctx, body }) => connectChannel(ctx, body.provider, body.storeName));
