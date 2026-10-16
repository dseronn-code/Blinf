import { NextResponse } from 'next/server';
import { route } from '@/server/http';
import { startOAuth } from '@/server/integrations/accounts';

/** Inicia o OAuth ("Conectar"): redireciona para a tela de autorização do provedor */
export const GET = route('integracoes', 'edit', async ({ ctx, params, req }) => {
  const url = await startOAuth(ctx.companyId, params.provider.toUpperCase(), ctx.userId, new URL(req.url).origin);
  return NextResponse.redirect(url);
});
