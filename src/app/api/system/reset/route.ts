import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { resetEverything } from '@/server/services/setup';

/** Apaga todos os dados (inclusive os de demonstração) e recomeça com a empresa real — só administrador */
export const POST = route('configuracoes', 'edit', async ({ ctx, body }) => {
  if (!ctx.isAdmin) fail(403, 'Somente administradores');
  if (body?.confirm !== 'APAGAR TUDO') fail(400, 'Para confirmar, digite APAGAR TUDO');
  return resetEverything(body);
});
