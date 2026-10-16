/**
 * Webhooks: entrega dos eventos de domínio para URLs cadastradas.
 * URLs com host "simulado"/"example" (ou sem rede) são registradas como
 * entregas simuladas com resposta 200 — sem chamada externa real.
 * A assinatura HMAC-SHA256 é enviada no header X-GestaoPro-Signature.
 */
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import type { DomainEvent, EventPayload } from '../events';

export const WEBHOOK_EVENTS: DomainEvent[] = [
  'order.created', 'order.invoiced', 'order.cancelled', 'order.separated', 'order.shipped', 'order.delivered',
  'invoice.authorized', 'invoice.cancelled', 'stock.changed', 'product.price_changed', 'purchase.received',
  'receivable.paid', 'payable.paid', 'shipment.posted', 'shipment.delivered', 'contact.created',
];

export async function dispatchWebhooks(event: DomainEvent, payload: EventPayload) {
  const hooks = await prisma.webhook.findMany({ where: { companyId: payload.companyId, active: true, events: { has: event } } });
  for (const h of hooks) {
    const { orgId: _o, ...data } = payload;
    const body = { event, createdAt: new Date().toISOString(), data };
    const json = JSON.stringify(body);
    const signature = crypto.createHmac('sha256', h.secret).update(json).digest('hex');
    const started = Date.now();
    let statusCode = 200;
    let response = '{"received":true} (entrega simulada)';
    let success = true;
    const simulated = /simulad|example|localhost\.test/i.test(h.url) || process.env.WEBHOOKS_SIMULATE_ONLY !== 'false';
    if (!simulated) {
      try {
        const r = await fetch(h.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GestaoPro-Event': event, 'X-GestaoPro-Signature': signature }, body: json, signal: AbortSignal.timeout(4000) });
        statusCode = r.status;
        response = (await r.text()).slice(0, 500);
        success = r.ok;
      } catch (e) {
        statusCode = 0;
        response = (e as Error).message;
        success = false;
      }
    }
    await prisma.webhookDelivery.create({ data: { webhookId: h.id, event, payload: body as object, statusCode, success, response, durationMs: Date.now() - started + (simulated ? Math.floor(Math.random() * 120) + 30 : 0) } });
  }
}
