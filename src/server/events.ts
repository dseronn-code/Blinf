/**
 * Barramento de eventos de domínio.
 * Serviços emitem eventos APÓS o commit da transação principal; o motor de
 * automações (automations.ts) e os webhooks reagem a eles.
 */
export type DomainEvent =
  | 'order.created'
  | 'order.updated'
  | 'order.invoiced'
  | 'order.cancelled'
  | 'order.returned'
  | 'inventory.finished'
  | 'transfer.created'
  | 'order.separated'
  | 'order.shipped'
  | 'order.delivered'
  | 'quote.approved'
  | 'invoice.authorized'
  | 'invoice.cancelled'
  | 'stock.changed'
  | 'product.price_changed'
  | 'purchase.received'
  | 'receivable.paid'
  | 'payable.paid'
  | 'payment_link.paid'
  | 'production.finished'
  | 'production.started'
  | 'service_order.finished'
  | 'service_order.invoiced'
  | 'shipment.label_created'
  | 'shipment.posted'
  | 'shipment.delivered'
  | 'contact.created'
  | 'pdv.sale'
  | 'daily.routine';

export type EventPayload = { companyId: string; orgId: string; userName?: string; [k: string]: unknown };

type Listener = (event: DomainEvent, payload: EventPayload) => Promise<void>;
const listeners: Listener[] = [];

export function onEvent(fn: Listener) {
  listeners.push(fn);
}

/** Emite o evento e aguarda os handlers (execução síncrona torna o demo previsível) */
export async function emit(event: DomainEvent, payload: EventPayload) {
  // import tardio evita ciclo de dependências entre serviços e automações
  const { runAutomations } = await import('./services/automations');
  const { dispatchWebhooks } = await import('./services/webhooks');
  try {
    await runAutomations(event, payload);
  } catch (e) {
    console.error('[automations]', event, e);
  }
  try {
    await dispatchWebhooks(event, payload);
  } catch (e) {
    console.error('[webhooks]', event, e);
  }
  for (const l of listeners) {
    try {
      await l(event, payload);
    } catch (e) {
      console.error('[listener]', e);
    }
  }
}
