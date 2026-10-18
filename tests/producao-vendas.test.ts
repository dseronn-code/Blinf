/**
 * Produção (fora do modo demonstração): vendas multicanal, frete, loja virtual,
 * mensagens e webhooks não inventam nada — recusam com orientação ou seguem o fluxo manual.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { RealIntegrationRequired } from '@/lib/demo';
import { webhookSimulated } from '@/server/services/webhooks';
import { unsentStatus, EMAIL_HOWTO } from '@/server/services/messaging';
import { manualFreightOptions } from '@/server/services/logistics';
import { storeFixedFreight } from '@/server/services/store';
import { visibleConnectors } from '@/server/services/integrations';

const prod = () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('DEMO_MODE', 'false');
};
afterEach(() => vi.unstubAllEnvs());

describe('produção sem integrações (sem banco)', () => {
  it('webhooks: entrega real por padrão; simula só com WEBHOOKS_SIMULATE_ONLY="true"', () => {
    prod();
    vi.stubEnv('WEBHOOKS_SIMULATE_ONLY', '');
    expect(webhookSimulated('https://example.com/hook')).toBe(false);
    vi.stubEnv('WEBHOOKS_SIMULATE_ONLY', 'true');
    expect(webhookSimulated('https://cliente.com.br/hook')).toBe(true);
    vi.unstubAllEnvs();
    vi.stubEnv('WEBHOOKS_SIMULATE_ONLY', '');
    expect(webhookSimulated('https://cliente.com.br/hook')).toBe(true); // demonstração mantém a simulação
  });

  it('mensagens sem SMTP/WhatsApp ficam NAO_ENVIADO com o motivo (demonstração: SIMULADO)', () => {
    expect(unsentStatus(EMAIL_HOWTO).status).toBe('SIMULADO');
    prod();
    const r = unsentStatus(EMAIL_HOWTO) as { status: string; error: string };
    expect(r.status).toBe('NAO_ENVIADO');
    expect(r.error).toContain('SMTP');
  });

  it('"GestãoPro Envios" (fictício) some dos conectores; frete manual sem preço inventado', () => {
    expect(visibleConnectors().some((c) => c.provider === 'GESTAO_ENVIOS')).toBe(true);
    prod();
    expect(visibleConnectors().some((c) => c.provider === 'GESTAO_ENVIOS')).toBe(false);
    const m = manualFreightOptions(12.5);
    expect(m.every((o) => o.manual && !o.simulated)).toBe(true);
    expect(m[0].price).toBe(12.5);
    vi.stubEnv('STORE_FIXED_FREIGHT', '19,90');
    expect(storeFixedFreight()).toBe(19.9);
    vi.stubEnv('STORE_FIXED_FREIGHT', '');
    expect(storeFixedFreight()).toBeNull();
  });
});

describe.skipIf(process.env.RUN_DB_TESTS !== '1')('produção sem integrações (banco)', () => {
  let actor: { companyId: string; orgId: string; userName: string };
  let prisma: typeof import('@/lib/db').prisma;
  beforeAll(async () => {
    prisma = (await import('@/lib/db')).prisma;
    const company = await prisma.company.findFirstOrThrow({ where: { cnpj: '11444777000161' } });
    actor = { companyId: company.id, orgId: company.organizationId, userName: 'Teste produção' };
  });

  it('marketplace sem conta real: conectar, importar pedidos fictícios e simulação em tempo real recusam', async () => {
    const { connectChannel, simulationTick, importOrders, publishListings, fakeBuyer } = await import('@/server/services/integrations');
    prod();
    await expect(connectChannel(actor, 'MAGALU', 'Teste')).rejects.toBeInstanceOf(RealIntegrationRequired);
    await expect(connectChannel(actor, 'MAGALU', 'Teste')).rejects.toThrow(/Contas e credenciais/);
    await expect(simulationTick(actor)).rejects.toBeInstanceOf(RealIntegrationRequired);
    await expect(fakeBuyer(actor.orgId)).rejects.toBeInstanceOf(RealIntegrationRequired);
    // Canal conectado sem conta real (criado no modo demonstração)
    vi.unstubAllEnvs();
    const ch = await connectChannel(actor, 'MAGALU', 'Canal de teste');
    prod();
    await expect(importOrders(actor, ch.id, 1)).rejects.toBeInstanceOf(RealIntegrationRequired);
    await expect(publishListings(actor, ch.id)).rejects.toBeInstanceOf(RealIntegrationRequired);
    await prisma.salesChannel.update({ where: { id: ch.id }, data: { status: 'DESCONECTADO' } });
  });

  it('frete: sem provedor não há cotação inventada; envio vira frete próprio sem rastreio gerado', async () => {
    const { quoteFreightDetailed, createShipment, advanceTracking, markManualShipment, labelsPdf } = await import('@/server/services/logistics');
    const { createOrder } = await import('@/server/services/sales');
    const hasCarrier = await prisma.integrationAccount.count({ where: { companyId: actor.companyId, provider: { in: ['MELHOR_ENVIO', 'CORREIOS'] }, status: 'CONECTADO' } });
    if (hasCarrier) return;
    prod();
    const q = await quoteFreightDetailed(actor.companyId, { fromZip: '01001000', toZip: '22250040', weight: 1 });
    expect(q.options).toHaveLength(0);
    expect(q.manual.length).toBeGreaterThan(0);

    const product = await prisma.product.findFirstOrThrow({ where: { organizationId: actor.orgId, sku: 'BON-ABA-01' } });
    const customer = await prisma.contact.findFirstOrThrow({ where: { organizationId: actor.orgId, types: { has: 'CLIENTE' }, personType: 'PF', document: { not: null } } });
    const order = await createOrder(actor, { customerId: customer.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'PIX', freight: 15, shipTo: { name: customer.name, zip: '22250040', street: 'Rua B', number: '20', district: 'Botafogo', city: 'Rio de Janeiro', uf: 'RJ' } });
    const s = (await createShipment(actor, order.id))!;
    expect(s.provider).toBe('PROPRIO');
    expect(s.trackingCode).toBeNull();
    expect(s.price).toBe(15);
    const pdf = await labelsPdf([{ shipment: s, order: { ...order, customer: { name: customer.name } } as any, company: (await prisma.company.findUniqueOrThrow({ where: { id: actor.companyId } })) }]);
    expect(pdf.length).toBeGreaterThan(500);
    const posted = await advanceTracking(actor, s.id);
    expect(posted?.status).toBe('POSTADO');
    const withCode = await markManualShipment(actor, s.id, { trackingCode: 'ab123' });
    expect(withCode.trackingCode).toBe('AB123');
    const delivered = await markManualShipment(actor, s.id, { status: 'ENTREGUE' });
    expect(delivered.status).toBe('ENTREGUE');

    // Envio simulado antigo (código UPU inventado): rastreio/etiqueta recusados em produção
    const sim = await prisma.shipment.create({ data: { companyId: actor.companyId, salesOrderId: order.id, provider: 'CORREIOS', carrier: 'Correios', service: 'PAC', price: 20, deadlineDays: 5, weight: 1, height: 2, width: 11, length: 16, trackingCode: 'PN000000000BR', status: 'CANCELADO' } });
    await prisma.shipment.update({ where: { id: sim.id }, data: { status: 'ETIQUETA_GERADA' } });
    await expect(advanceTracking(actor, sim.id)).rejects.toBeInstanceOf(RealIntegrationRequired);
    await expect(labelsPdf([{ shipment: { ...sim, status: 'ETIQUETA_GERADA' }, order: { ...order, customer: { name: customer.name } } as any, company: (await prisma.company.findUniqueOrThrow({ where: { id: actor.companyId } })) }])).rejects.toBeInstanceOf(RealIntegrationRequired);
    await prisma.shipment.update({ where: { id: sim.id }, data: { status: 'CANCELADO' } });
  });

  it('loja virtual: sem provedor não aprova cartão nem gera boleto; frete com retirada e sem tabela fictícia', async () => {
    const { storeFreight, storeCheckout, storePaymentMethods } = await import('@/server/services/store');
    const store = await prisma.store.findFirst({ where: { companyId: actor.companyId } });
    if (!store) return;
    prod();
    const pay = await storePaymentMethods(actor.companyId);
    const product = await prisma.product.findFirstOrThrow({ where: { organizationId: actor.orgId, sku: 'BON-ABA-01' } });
    const opts = await storeFreight(store.slug, '22250040', [{ productId: product.id, quantity: 1 }], 'RJ');
    expect(opts.some((o) => o.service === 'Retirada no local')).toBe(true);
    expect(opts.some((o) => o.simulated)).toBe(false);
    if (pay.gateway) return;
    expect(pay.card).toBe(false);
    expect(pay.boleto).toBe(false);
    const customer = { name: 'Cliente Produção', email: 'cliente@exemplo.com.br', document: '529.982.247-25', zip: '22250040', street: 'Rua B', number: '20', district: 'Botafogo', city: 'Rio de Janeiro', uf: 'RJ' };
    await expect(storeCheckout(store.slug, { customer, items: [{ productId: product.id, quantity: 1 }], shipping: { service: 'Retirada no local', price: 0 }, paymentMethod: 'CARTAO_CREDITO' })).rejects.toThrow(/Cartão indisponível/);
    await expect(storeCheckout(store.slug, { customer, items: [{ productId: product.id, quantity: 1 }], shipping: { service: 'Retirada no local', price: 0 }, paymentMethod: 'BOLETO' })).rejects.toThrow(/Boleto indisponível/);
  });
});
