import { NextResponse } from 'next/server';
import { receiveWebhook } from '@/server/integrations/inbound';

/**
 * Receptor público de notificações: /api/hooks/<provedor>/<idDaConta>?token=...
 * (Mercado Livre e similares, que notificam por usuário, usam /api/hooks/<provedor>)
 */
async function handle(req: Request, { params }: { params: Promise<{ provider: string; slug?: string[] }> }) {
  const { provider, slug } = await params;
  try {
    const r = await receiveWebhook(provider.toUpperCase().replace(/-/g, '_'), slug || [], req);
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error('webhook', provider, e);
    return NextResponse.json({ error: 'Falha ao registrar notificação' }, { status: 500 });
  }
}

export { handle as POST, handle as GET, handle as PUT };
