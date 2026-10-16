/**
 * Agendador das sincronizações periódicas: para cada conta conectada cujo
 * provedor define `poll`, enfileira a execução respeitando o intervalo.
 */
import { prisma } from '@/lib/db';
import { registerJob, enqueue } from '@/server/services/jobs';
import { getProvider } from './registry';
import { toCtx, ensureFreshToken, updateAccount } from './accounts';

export async function pollAll() {
  const rows = await prisma.integrationAccount.findMany({ where: { status: 'CONECTADO' } });
  for (const r of rows) {
    const def = getProvider(r.provider);
    if (!def?.poll) continue;
    const last = Number((r.settings as any)?.lastPollAt || 0);
    if (Date.now() - last < def.poll.everyMinutes * 60_000) continue;
    await prisma.integrationAccount.update({ where: { id: r.id }, data: { settings: { ...(r.settings as object), lastPollAt: Date.now() } } });
    await enqueue('integration.poll', { accountId: r.id }, { maxAttempts: 2 });
  }
}

registerJob('integration.poll', async ({ accountId }) => {
  const row = await prisma.integrationAccount.findUnique({ where: { id: accountId } });
  if (!row || row.status !== 'CONECTADO') return;
  const def = getProvider(row.provider);
  if (!def?.poll) return;
  const acc = await ensureFreshToken(toCtx(row));
  try {
    const msg = await def.poll.run(acc);
    await updateAccount(acc, { settings: { lastPollResult: msg || 'ok', lastPollAt: Date.now() }, lastError: null });
  } catch (e) {
    await updateAccount(acc, { lastError: `Sincronização: ${(e as Error).message}` });
    throw e;
  }
});
