import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { deliverWebhook } from '@/server/services/webhooks';

export const POST = route('integracoes', 'edit', async ({ ctx, params }) => {
  const h = await prisma.webhook.findFirst({ where: { id: params.id, companyId: ctx.companyId } });
  if (!h) fail(404, 'Webhook não encontrado');
  const event = h!.events[0] || 'order.created';
  await deliverWebhook(h!.id, { id: crypto.randomUUID(), event, createdAt: new Date().toISOString(), data: { companyId: ctx.companyId, test: true, message: 'Evento de teste enviado pelo GestãoPro' } }).catch(() => {});
  return { ok: true };
});
