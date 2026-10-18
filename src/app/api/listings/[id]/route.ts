import { route } from '@/server/http';
import { fail, HttpError } from '@/server/errors';
import { RealIntegrationRequired } from '@/lib/demo';
import { updateListing } from '@/server/services/integrations';

/** Pausar/ativar anúncio ou ajustar título/preço (canal real: na API do canal, revertendo se ela recusar) */
export const PUT = route('vendas', 'edit', async ({ ctx, params, body }) => {
  try {
    return await updateListing(ctx, params.id, body || {});
  } catch (e) {
    if (e instanceof HttpError || e instanceof RealIntegrationRequired) throw e;
    const msg = (e as Error).message;
    return fail(msg === 'Anúncio não encontrado' ? 404 : 400, msg);
  }
});
