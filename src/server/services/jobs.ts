/**
 * Fila de tarefas persistida no banco (tabela Job).
 * Usada para trabalhos que podem falhar e precisam de novas tentativas
 * (entrega de webhooks, envio de e-mails/WhatsApp). Um worker interno
 * (instrumentation.ts) processa a fila a cada poucos segundos, com backoff
 * exponencial. Em produção pode ser trocada por BullMQ/SQS mantendo a API.
 */
import { prisma } from '@/lib/db';

type Handler = (payload: any) => Promise<void>;
const handlers: Record<string, Handler> = {};

export function registerJob(type: string, fn: Handler) {
  handlers[type] = fn;
}

export async function enqueue(type: string, payload: object, opts: { delayMs?: number; maxAttempts?: number } = {}) {
  return prisma.job.create({ data: { type, payload, runAt: new Date(Date.now() + (opts.delayMs || 0)), maxAttempts: opts.maxAttempts || 5 } });
}

let running = false;

/** Processa as tarefas vencidas. Retorna quantas foram executadas. */
export async function processJobs(limit = 20) {
  if (running) return 0;
  running = true;
  let n = 0;
  try {
    await loadHandlers();
    const due = await prisma.job.findMany({ where: { status: 'PENDENTE', runAt: { lte: new Date() } }, orderBy: { runAt: 'asc' }, take: limit });
    for (const job of due) {
      // trava otimista: só processa se ainda estiver pendente
      const lock = await prisma.job.updateMany({ where: { id: job.id, status: 'PENDENTE' }, data: { status: 'PROCESSANDO', attempts: { increment: 1 } } });
      if (!lock.count) continue;
      const fn = handlers[job.type];
      try {
        if (!fn) throw new Error(`Sem handler para ${job.type}`);
        await fn(job.payload);
        await prisma.job.update({ where: { id: job.id }, data: { status: 'CONCLUIDO', doneAt: new Date(), lastError: null } });
      } catch (e) {
        const attempts = job.attempts + 1;
        const final = attempts >= job.maxAttempts;
        await prisma.job.update({
          where: { id: job.id },
          data: { status: final ? 'ERRO' : 'PENDENTE', lastError: (e as Error).message.slice(0, 500), runAt: new Date(Date.now() + Math.min(2 ** attempts * 5000, 3600000)) },
        });
      }
      n++;
    }
  } finally {
    running = false;
  }
  return n;
}

let loaded = false;
async function loadHandlers() {
  if (loaded) return;
  loaded = true;
  await import('./webhooks');
  await import('./messaging');
  await import('../integrations/inbound');
  await import('../integrations/scheduler');
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startWorker(intervalMs = 3000) {
  if (timer) return;
  timer = setInterval(() => processJobs().catch((e) => console.error('[jobs]', e)), intervalMs);
  // Sincronizações periódicas das integrações reais (pedidos, rastreio, status de cobranças...)
  setInterval(() => import('../integrations/scheduler').then((m) => m.pollAll()).catch((e) => console.error('[poll]', e)), 60_000);
}
