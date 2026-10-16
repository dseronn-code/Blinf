import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { dispatchWebhooks } from '@/server/services/webhooks';

export const POST = route('integracoes', 'edit', async ({ ctx, params }) => {
  const h = await prisma.webhook.findFirst({ where: { id: params.id, companyId: ctx.companyId } });
  if (!h) fail(404, 'Webhook não encontrado');
  const event = h!.events[0] || 'order.created';
  await dispatchWebhooks(event as never, { companyId: ctx.companyId, orgId: ctx.orgId, test: true, message: 'Evento de teste enviado pelo GestãoPro' });
  return { ok: true };
});
