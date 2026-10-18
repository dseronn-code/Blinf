import { route } from '@/server/http';
import { fail, HttpError } from '@/server/errors';
import { RealIntegrationRequired } from '@/lib/demo';
import { importOrders, syncListings, publishListings, disconnectChannel, linkChannelListings, createChannelListing, suggestCategories } from '@/server/services/integrations';

export const POST = route('integracoes', 'edit', async ({ ctx, params, body }) => {
  const run = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof HttpError || e instanceof RealIntegrationRequired) throw e;
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
    // Cria o anúncio a partir do produto do ERP (canal real → API oficial)
    case 'create-listing':
      return run(() => createChannelListing(ctx, params.id, { productId: String(body?.productId || ''), listingType: body?.listingType || null, categoryId: body?.categoryId ? String(body.categoryId).trim() : null, price: body?.price != null && body.price !== '' ? Number(body.price) : null, quantity: body?.quantity != null && body.quantity !== '' ? Number(body.quantity) : null, title: body?.title || null }));
    // Sugestão de categoria pelo título (Mercado Livre / Shopee)
    case 'categories':
      return run(async () => ({ rows: await suggestCategories(ctx, params.id, String(body?.title || '')) }));
    case 'disconnect':
      return disconnectChannel(ctx, params.id);
    default:
      fail(404, 'Ação inválida');
  }
});
