/**
 * Webhooks: entrega dos eventos de domínio para URLs cadastradas, via fila
 * (com novas tentativas e backoff). URLs com "simulado"/"example" — ou com
 * WEBHOOKS_SIMULATE_ONLY diferente de "false" — geram entregas simuladas (200).
 * Assinatura HMAC-SHA256 do corpo no header X-GestaoPro-Signature.
 */
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import type { DomainEvent, EventPayload } from '../events';
import { enqueue, registerJob } from './jobs';

export const WEBHOOK_EVENTS: DomainEvent[] = [
  'order.created', 'order.invoiced', 'order.cancelled', 'order.returned', 'order.separated', 'order.shipped', 'order.delivered',
  'invoice.authorized', 'invoice.cancelled', 'stock.changed', 'product.price_changed', 'purchase.received',
  'receivable.paid', 'payable.paid', 'shipment.posted', 'shipment.delivered', 'contact.created',
];

export async function dispatchWebhooks(event: DomainEvent, payload: EventPayload) {
  const hooks = await prisma.webhook.findMany({ where: { companyId: payload.companyId, active: true, events: { has: event } } });
  for (const h of hooks) {
    const { orgId: _o, ...data } = payload;
    await enqueue('webhook.deliver', { webhookId: h.id, body: { id: crypto.randomUUID(), event, createdAt: new Date().toISOString(), data } }, { maxAttempts: 6 });
  }
}

/** Entrega uma vez (usado pela fila e pelo botão "Testar") */
export async function deliverWebhook(webhookId: string, body: { event: string; [k: string]: unknown }) {
  const h = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!h || !h.active) return;
  const json = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', h.secret).update(json).digest('hex');
  const started = Date.now();
  const simulated = /simulad|example|localhost\.test/i.test(h.url) || process.env.WEBHOOKS_SIMULATE_ONLY !== 'false';
  let statusCode = 200;
  let response = '{"received":true} (entrega simulada)';
  let success = true;
  if (!simulated) {
    try {
      const r = await fetch(h.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GestaoPro-Event': body.event, 'X-GestaoPro-Signature': signature }, body: json, signal: AbortSignal.timeout(8000) });
      statusCode = r.status;
      response = (await r.text()).slice(0, 500);
      success = r.ok;
    } catch (e) {
      statusCode = 0;
      response = (e as Error).message;
      success = false;
    }
  }
  await prisma.webhookDelivery.create({ data: { webhookId: h.id, event: body.event, payload: body as object, statusCode, success, response, durationMs: Date.now() - started + (simulated ? Math.floor(Math.random() * 120) + 30 : 0) } });
  if (!success) throw new Error(`Webhook respondeu ${statusCode}`);
}

registerJob('webhook.deliver', async ({ webhookId, body }) => deliverWebhook(webhookId, body));
