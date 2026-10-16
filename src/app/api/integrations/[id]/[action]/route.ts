import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { importOrders, syncListings, publishListings, disconnectChannel } from '@/server/services/integrations';

export const POST = route('integracoes', 'edit', async ({ ctx, params, body }) => {
  switch (params.action) {
    case 'import':
      return { orders: (await importOrders(ctx, params.id, Math.min(Number(body?.count) || 3, 20))).length };
    case 'sync-stock':
      return { updated: await syncListings(ctx, { channelId: params.id }) };
    case 'sync-price':
      return { updated: await syncListings(ctx, { channelId: params.id, prices: true }) };
    case 'publish':
      return { published: await publishListings(ctx, params.id, body?.productIds) };
    case 'disconnect':
      return disconnectChannel(ctx, params.id);
    default:
      fail(404, 'Ação inválida');
  }
});
