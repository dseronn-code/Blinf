import { route } from '@/server/http';
import { fail, HttpError } from '@/server/errors';
import { importOrders, syncListings, publishListings, disconnectChannel, linkChannelListings } from '@/server/services/integrations';

export const POST = route('integracoes', 'edit', async ({ ctx, params, body }) => {
  const run = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof HttpError) throw e;
      // Erros das APIs dos canais (token expirado, credencial inválida...) viram 400 com a mensagem
      return fail(400, (e as Error).message);
    }
  };
  switch (params.action) {
    case 'import':
      return run(async () => ({ orders: (await importOrders(ctx, params.id, Math.min(Number(body?.count) || 3, 20))).length }));
    case 'sync-stock':
      return run(async () => ({ updated: await syncListings(ctx, { channelId: params.id, force: !!body?.force }) }));
    case 'sync-price':
      return run(async () => ({ updated: await syncListings(ctx, { channelId: params.id, prices: true, force: !!body?.force }) }));
    // Envia estoque e preço de todos os anúncios agora (canal real)
    case 'push':
      return run(async () => ({ updated: await syncListings(ctx, { channelId: params.id, prices: true, force: true }) }));
    case 'link':
      return run(() => linkChannelListings(ctx, params.id));
    case 'publish':
      return run(async () => ({ published: await publishListings(ctx, params.id, body?.productIds) }));
    case 'disconnect':
      return disconnectChannel(ctx, params.id);
    default:
      fail(404, 'Ação inválida');
  }
});
