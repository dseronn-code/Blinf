import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { saveCredentials, testConnection, disconnect } from '@/server/integrations/accounts';
import { getProvider } from '@/server/integrations/registry';

/** Salva credenciais (PUT) | testar / desconectar (POST {action}) */
export const PUT = route('integracoes', 'edit', async ({ ctx, params, body }) => {
  const key = params.provider.toUpperCase();
  if (!getProvider(key)) fail(404, 'Provedor desconhecido');
  await saveCredentials(ctx.companyId, key, body || {});
  if (body?.test === false) return { ok: true };
  try {
    return { ok: true, test: await testConnection(ctx.companyId, key) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

export const POST = route('integracoes', 'edit', async ({ ctx, params, body }) => {
  const key = params.provider.toUpperCase();
  if (!getProvider(key)) fail(404, 'Provedor desconhecido');
  if (body?.action === 'test') {
    try {
      return await testConnection(ctx.companyId, key);
    } catch (e) {
      fail(400, (e as Error).message);
    }
  }
  if (body?.action === 'disconnect') {
    await disconnect(ctx.companyId, key);
    return { ok: true };
  }
  fail(400, 'Ação inválida');
});
