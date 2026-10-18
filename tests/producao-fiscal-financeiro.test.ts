/**
 * Produção (NODE_ENV=production, DEMO_MODE=false): nada de nota, boleto, retorno ou XML inventados.
 * Os blocos com banco rodam com RUN_DB_TESTS=1 (usa a empresa do seed, emissor SIMULADO e sem provedor de cobrança).
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { vi } from 'vitest';
import { RealIntegrationRequired } from '@/lib/demo';
import { billingData } from '@/server/services/finance';
import { cnabRetornoSample } from '@/server/services/financeExtras';
import { requireRealFiscal, fiscalSimulationBlocked } from '@/server/services/fiscal';

const prod = () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('DEMO_MODE', 'false');
};
afterEach(() => vi.unstubAllEnvs());

const company = { cnpj: '11444777000161', tradeName: 'Loja', name: 'Loja LTDA', city: 'São Paulo' };
const fakeBank = { bankCode: '999', agency: '0001', accountNumber: '1234567', pixKey: '11444777000161' };
const realBank = { bankCode: '341', agency: '1234', accountNumber: '56789', pixKey: 'financeiro@loja.com.br' };

describe('produção sem integrações (sem banco)', () => {
  it('modo demonstração continua simulando boleto + Pix', () => {
    const d = billingData(company, fakeBank, 100, new Date());
    expect(d.boletoLine).toBeTruthy();
    expect(d.pixPayload).toBeTruthy();
  });

  it('boleto/Pix sem provedor: nada de linha digitável inventada; Pix estático só com chave real', () => {
    prod();
    expect(billingData(company, realBank, 100, new Date(), 'BOLETO')).toEqual({});
    expect(billingData(company, fakeBank, 100, new Date(), 'PIX')).toEqual({});
    const pix = billingData(company, realBank, 100, new Date(), 'PIX');
    expect(pix.boletoLine).toBeUndefined();
    expect(pix.boletoNumber).toBeUndefined();
    expect(pix.pixPayload).toContain('financeiro@loja.com.br');
  });

  it('retorno CNAB simulado é recusado', () => {
    prod();
    expect(() => cnabRetornoSample('')).toThrow(RealIntegrationRequired);
  });

  it('emissão fiscal com SIMULADO é bloqueada; SEFAZ/Focus seguem', () => {
    expect(fiscalSimulationBlocked({ fiscalProvider: 'SIMULADO' })).toBe(false);
    prod();
    expect(fiscalSimulationBlocked({ fiscalProvider: 'SIMULADO' })).toBe(true);
    expect(() => requireRealFiscal({ fiscalProvider: 'SIMULADO' })).toThrow(RealIntegrationRequired);
    expect(() => requireRealFiscal({ fiscalProvider: 'SEFAZ' })).not.toThrow();
    expect(() => requireRealFiscal({ fiscalProvider: 'FOCUS_NFE' })).not.toThrow();
  });
});

describe.skipIf(process.env.RUN_DB_TESTS !== '1')('produção sem integrações (banco)', () => {
  type Actor = { companyId: string; orgId: string; userName: string };
  let actor: Actor;
  let productId: string;
  let customerId: string;
  const db = async () => (await import('@/lib/db')).prisma;

  beforeAll(async () => {
    const prisma = await db();
    const c = await prisma.company.findFirstOrThrow({ where: { cnpj: '11444777000161' } });
    expect(c.fiscalProvider).toBe('SIMULADO');
    actor = { companyId: c.id, orgId: c.organizationId, userName: 'Teste produção' };
    productId = (await prisma.product.findFirstOrThrow({ where: { organizationId: c.organizationId, sku: 'BON-ABA-01' } })).id;
    customerId = (await prisma.contact.findFirstOrThrow({ where: { organizationId: c.organizationId, types: { has: 'CLIENTE' }, personType: 'PF', document: { not: null }, code: null } })).id;
  });

  it('faturar com nota é recusado sem criar rascunho; faturar sem nota continua', async () => {
    const prisma = await db();
    const { createOrder, invoiceOrder, markInvoicedWithoutNote } = await import('@/server/services/sales');
    const order = await createOrder(actor, { customerId, items: [{ productId, quantity: 1 }], paymentMethod: 'PIX', installments: 1 });
    prod();
    await expect(invoiceOrder(actor, order.id, { model: 'NFE' })).rejects.toThrow(RealIntegrationRequired);
    expect(await prisma.invoice.count({ where: { salesOrderId: order.id } })).toBe(0);
    await markInvoicedWithoutNote(actor, order.id);
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('FATURADO');
  });

  it('venda do PDV sem emissor: NFC-e não é gerada e a empresa é notificada', async () => {
    const prisma = await db();
    const { createOrder, invoiceOrder } = await import('@/server/services/sales');
    const order = await createOrder(actor, { customerId, origin: 'PDV', items: [{ productId, quantity: 1 }], paymentMethod: 'DINHEIRO', installments: 1 });
    prod();
    await expect(invoiceOrder(actor, order.id, { model: 'NFCE' })).rejects.toThrow(RealIntegrationRequired);
    expect(await prisma.invoice.count({ where: { salesOrderId: order.id } })).toBe(0);
    const n = await prisma.notification.findFirst({ where: { companyId: actor.companyId, title: 'Venda sem nota fiscal', message: { contains: `Pedido nº ${order.number}` } } });
    expect(n).toBeTruthy();
  });

  it('rascunho existente não é "autorizado" e inutilização sem SEFAZ é recusada', async () => {
    const prisma = await db();
    const { buildInvoice, transmitInvoice, voidNumbers } = await import('@/server/services/fiscal');
    const inv = await buildInvoice(prisma, { companyId: actor.companyId, model: 'NFE', customerId, items: [{ productId, quantity: 1, unitPrice: 10 }] });
    prod();
    await expect(transmitInvoice(actor.companyId, actor.orgId, inv.id)).rejects.toThrow(RealIntegrationRequired);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe('RASCUNHO');
    await expect(voidNumbers(actor.companyId, { model: 'NFE', series: 99, fromNumber: 1, toNumber: 1, reason: 'Teste de inutilização em produção' })).rejects.toThrow(RealIntegrationRequired);
    vi.unstubAllEnvs();
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'CANCELADA', cancelReason: 'teste' } });
  });

  it('Distribuição DF-e e XML de exemplo não geram notas fictícias', async () => {
    const prisma = await db();
    const { fetchDistribution } = await import('@/server/services/fiscalExtras');
    const { sampleSupplierXml } = await import('@/server/services/purchases');
    const before = await prisma.nfeDistribution.count({ where: { companyId: actor.companyId } });
    prod();
    await expect(fetchDistribution(actor, 2)).rejects.toThrow(RealIntegrationRequired);
    await expect(sampleSupplierXml(actor)).rejects.toThrow(RealIntegrationRequired);
    expect(await prisma.nfeDistribution.count({ where: { companyId: actor.companyId } })).toBe(before);
  });

  it('conta a receber por boleto nasce sem cobrança; "emitir boleto" sem provedor é recusado', async () => {
    const prisma = await db();
    const { createEntries } = await import('@/server/services/finance');
    const { createCharge } = await import('@/server/services/payments');
    prod();
    const [e] = await createEntries(prisma, { companyId: actor.companyId, type: 'RECEBER', description: 'Teste produção boleto', total: 50, firstDueDate: new Date(), paymentMethod: 'BOLETO' });
    expect(e.boletoLine).toBeNull();
    expect(e.boletoBarcode).toBeNull();
    expect(e.pixPayload).toBeNull();
    await expect(createCharge(actor.companyId, e.id, 'BOLETO')).rejects.toThrow(RealIntegrationRequired);
    vi.unstubAllEnvs();
    await prisma.financialEntry.update({ where: { id: e.id }, data: { status: 'CANCELADO' } });
  });

  it('remessa CNAB exige conta com código de banco real (não 999)', async () => {
    const prisma = await db();
    const { cnabRemessa } = await import('@/server/services/financeExtras');
    const real = await prisma.bankAccount.count({ where: { companyId: actor.companyId, active: true, bankCode: { notIn: ['999', ''] }, NOT: { bankCode: null }, type: { notIn: ['CAIXA', 'CARTAO'] } } });
    prod();
    if (!real) await expect(cnabRemessa(actor)).rejects.toThrow(RealIntegrationRequired);
    else await expect(cnabRemessa(actor)).resolves.toBeTruthy();
  });
});
