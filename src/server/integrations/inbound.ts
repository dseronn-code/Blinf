/**
 * Webhooks de entrada (notificações dos provedores): gravados em InboundEvent
 * e processados pela fila de tarefas (com novas tentativas em caso de falha).
 */
import { prisma } from '@/lib/db';
import { registerJob, enqueue } from '@/server/services/jobs';
import { getProvider } from './registry';
import { toCtx, webhookToken, ensureFreshToken } from './accounts';
import type { AccountCtx } from './types';

export async function receiveWebhook(providerKey: string, slug: string[], req: Request) {
  const def = getProvider(providerKey);
  if (!def?.webhook) return { status: 404, body: { error: 'Provedor sem webhook' } };
  const url = new URL(req.url);
  const raw = await req.text();
  let body: any = {};
  try {
    body = raw ? JSON.parse(raw) : Object.fromEntries(url.searchParams);
  } catch {
    body = Object.fromEntries(new URLSearchParams(raw));
  }
  let acc: AccountCtx | null = null;
  const accountId = slug[0];
  if (accountId) {
    const row = await prisma.integrationAccount.findUnique({ where: { id: accountId } });
    if (!row || row.provider !== def.key) return { status: 404, body: { error: 'Conta não encontrada' } };
    if (url.searchParams.get('token') !== webhookToken(row.id)) return { status: 401, body: { error: 'Token inválido' } };
    acc = toCtx(row);
  } else if (def.webhook.findAccount) acc = await def.webhook.findAccount(body);
  if (def.webhook.verify && !(await def.webhook.verify(acc, { headers: req.headers, raw, query: url.searchParams }))) return { status: 401, body: { error: 'Assinatura inválida' } };
  const d = def.webhook.describe?.(body) || {};
  const ev = await prisma.inboundEvent.create({ data: { provider: def.key, companyId: acc?.companyId || null, topic: d.topic || null, externalId: d.externalId || null, payload: body, status: acc ? 'RECEBIDO' : 'IGNORADO', error: acc ? null : 'Conta não identificada' } });
  if (acc) await enqueue('inbound.process', { id: ev.id, accountId: acc.id });
  // Responde rápido (os provedores exigem 2xx em poucos segundos); o processamento é assíncrono
  return { status: 200, body: { ok: true, id: ev.id } };
}

registerJob('inbound.process', async ({ id, accountId }) => {
  const ev = await prisma.inboundEvent.findUnique({ where: { id } });
  const row = await prisma.integrationAccount.findUnique({ where: { id: accountId } });
  if (!ev || !row || ev.status === 'PROCESSADO') return;
  const def = getProvider(ev.provider);
  try {
    const msg = await def!.webhook!.process(ev, await ensureFreshToken(toCtx(row)));
    await prisma.inboundEvent.update({ where: { id }, data: { status: 'PROCESSADO', processedAt: new Date(), error: msg || null } });
  } catch (e) {
    await prisma.inboundEvent.update({ where: { id }, data: { status: 'ERRO', error: (e as Error).message } });
    throw e;
  }
});
