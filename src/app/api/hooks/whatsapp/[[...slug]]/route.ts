import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { receiveWebhook } from '@/server/integrations/inbound';
import { toCtx } from '@/server/integrations/accounts';
import { verifyChallenge } from '@/server/integrations/providers/whatsapp';

/**
 * Webhook do WhatsApp Cloud API: /api/hooks/whatsapp[/<idDaConta>]
 * GET = verificação da Meta (hub.mode/hub.verify_token → devolve hub.challenge em texto puro)
 * POST = notificações de status/mensagens (assinatura X-Hub-Signature-256)
 */
type Params = { params: Promise<{ slug?: string[] }> };

export async function GET(req: Request, { params }: Params) {
  const { slug } = await params;
  const query = new URL(req.url).searchParams;
  const rows = await prisma.integrationAccount.findMany({ where: { provider: 'WHATSAPP', ...(slug?.[0] ? { id: slug[0] } : {}) } });
  for (const r of rows) {
    const challenge = verifyChallenge(query, toCtx(r));
    if (challenge) return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return NextResponse.json({ error: 'Token de verificação inválido' }, { status: 403 });
}

export async function POST(req: Request, { params }: Params) {
  const { slug } = await params;
  try {
    const r = await receiveWebhook('WHATSAPP', slug || [], req);
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error('webhook whatsapp', e);
    return NextResponse.json({ error: 'Falha ao registrar notificação' }, { status: 500 });
  }
}
