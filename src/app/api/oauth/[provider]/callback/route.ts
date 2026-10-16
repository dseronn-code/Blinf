import { NextResponse } from 'next/server';
import { finishOAuth, appUrl } from '@/server/integrations/accounts';

/** Retorno do OAuth: troca o código pelo token e volta para a tela de contas */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const back = `${appUrl(url.origin)}/integracoes/contas`;
  try {
    await finishOAuth(provider.toUpperCase(), url.searchParams, url.origin);
    return NextResponse.redirect(`${back}?conectado=${provider}`);
  } catch (e) {
    return NextResponse.redirect(`${back}?erro=${encodeURIComponent((e as Error).message)}`);
  }
}
