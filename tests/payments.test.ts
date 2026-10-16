/**
 * Cobranças reais (Asaas / Mercado Pago): mapeamento das chamadas às APIs com
 * respostas simuladas (setHttpMock) e baixa automática pelo webhook.
 * O teste com banco roda com RUN_DB_TESTS=1.
 */
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setHttpMock, type HttpRequest } from '@/server/integrations/http';
import type { AccountCtx } from '@/server/integrations/types';
import { createAsaasCharge, asaasPayment, formatLine } from '@/server/integrations/providers/asaas';
import { createMpCharge, verifyMpSignature, mpPayment } from '@/server/integrations/providers/mercadopago';
import type { ChargeRequest } from '@/server/services/payments';

const LINE = '23793381286000000000300000000400184340000012345';
const payer = { contactId: 'c1', name: 'Maria da Silva Souza', document: '52998224725', email: 'maria@exemplo.com', phone: '11999990000', zip: '01310100', street: 'Av. Paulista', number: '1000', district: 'Bela Vista', city: 'São Paulo', uf: 'SP' };
const req = (method: ChargeRequest['method']): ChargeRequest => ({ entryId: 'entry_1', description: 'Pedido de venda nº 10', amount: 150.5, dueDate: new Date('2099-01-10T12:00:00Z'), method, payer, notificationUrl: 'https://erp.exemplo.com/api/hooks/x/1?token=t', backUrl: 'https://erp.exemplo.com/pagar/pg1' });
const acc = (provider: string, secrets: Record<string, string>, settings: Record<string, any> = {}): AccountCtx => ({ id: 'acc1', companyId: 'cmp1', provider, environment: 'SANDBOX', status: 'CONECTADO', secrets, settings, externalAccountId: null, accountName: null, tokenExpiresAt: null });

let calls: HttpRequest[] = [];
const mock = (routes: [RegExp, (r: HttpRequest) => any][]) => {
  calls = [];
  setHttpMock((r) => {
    calls.push(r);
    const hit = routes.find(([re]) => re.test(`${r.method} ${r.url}`));
    return hit ? { status: 200, data: hit[1](r) } : { status: 404, data: { message: 'rota não simulada' } };
  });
};
afterEach(() => setHttpMock(null));

describe('Asaas', () => {
  const a = acc('ASAAS', { apiKey: '$aact_hmlg_teste' }, { customers: { '52998224725': 'cus_123' } });

  it('cobrança Pix: POST /payments + QR Code', async () => {
    mock([
      [/^POST .*\/payments$/, () => ({ id: 'pay_1', status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/pay_1' })],
      [/^GET .*\/payments\/pay_1\/pixQrCode$/, () => ({ payload: '00020126580014br.gov.bcb.pix-REAL', encodedImage: 'iVBOR' })],
    ]);
    const r = await createAsaasCharge(a, req('PIX'));
    const post = calls[0];
    expect(post.url).toBe('https://sandbox.asaas.com/api/v3/payments');
    expect(post.headers?.access_token).toBe('$aact_hmlg_teste');
    expect(post.body).toMatchObject({ customer: 'cus_123', billingType: 'PIX', value: 150.5, dueDate: '2099-01-10', externalReference: 'entry_1' });
    expect(r).toMatchObject({ ref: 'pay_1', pixPayload: '00020126580014br.gov.bcb.pix-REAL', paymentUrl: 'https://sandbox.asaas.com/i/pay_1' });
    expect(r.pixImage).toContain('data:image/png;base64,');
    expect(calls.some((c) => c.url.includes('identificationField'))).toBe(false);
  });

  it('cobrança boleto: linha digitável, código de barras e nosso número', async () => {
    mock([
      [/^POST .*\/payments$/, () => ({ id: 'pay_2', status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/pay_2', bankSlipUrl: 'https://sandbox.asaas.com/b/pdf/pay_2' })],
      [/identificationField$/, () => ({ identificationField: LINE, nossoNumero: '6543', barCode: '23791843400000123453381260000000000300000000' })],
    ]);
    const r = await createAsaasCharge({ ...a, environment: 'PRODUCAO' }, req('BOLETO'));
    expect(calls[0].url).toBe('https://api.asaas.com/v3/payments');
    expect((calls[0].body as any).billingType).toBe('BOLETO');
    expect(r).toMatchObject({ ref: 'pay_2', boletoLine: formatLine(LINE), boletoBarcode: '23791843400000123453381260000000000300000000', boletoNumber: '6543' });
    expect(r.boletoLine).toBe('23793.38128 60000.000003 00000.000400 1 84340000012345');
  });

  it('cartão gera fatura (CREDIT_CARD → invoiceUrl)', async () => {
    mock([[/^POST .*\/payments$/, () => ({ id: 'pay_3', invoiceUrl: 'https://sandbox.asaas.com/i/pay_3' })]]);
    const r = await createAsaasCharge(a, req('CARTAO'));
    expect((calls[0].body as any).billingType).toBe('CREDIT_CARD');
    expect(r.paymentUrl).toBe('https://sandbox.asaas.com/i/pay_3');
  });

  it('eventos do webhook → situação do título', () => {
    const p = { id: 'pay_1', value: 100, netValue: 98.01, externalReference: 'e1', billingType: 'PIX', paymentDate: '2026-10-10' };
    expect(asaasPayment(p, 'PAYMENT_RECEIVED')).toMatchObject({ status: 'PAGO', gross: 100, net: 98.01, method: 'PIX', externalReference: 'e1' });
    expect(asaasPayment(p, 'PAYMENT_REFUNDED').status).toBe('ESTORNADO');
    expect(asaasPayment(p, 'PAYMENT_DELETED').status).toBe('CANCELADO');
    expect(asaasPayment(p, 'PAYMENT_OVERDUE').status).toBe('VENCIDO');
    expect(asaasPayment({ ...p, status: 'RECEIVED' }).status).toBe('PAGO');
  });
});

describe('Mercado Pago', () => {
  const m = acc('MERCADO_PAGO', { token: 'TEST-123-abc' });

  it('Pix: payment_method_id pix → QR do point_of_interaction', async () => {
    mock([[/^POST .*\/v1\/payments$/, () => ({ id: 1234567, status: 'pending', point_of_interaction: { transaction_data: { qr_code: '00020126PIXMP', qr_code_base64: 'iVBORmp', ticket_url: 'https://www.mercadopago.com.br/payments/1234567/ticket' } } })]]);
    const r = await createMpCharge(m, req('PIX'));
    const post = calls[0];
    expect(post.url).toBe('https://api.mercadopago.com/v1/payments');
    expect(post.headers?.Authorization).toBe('Bearer TEST-123-abc');
    expect(post.headers?.['X-Idempotency-Key']).toBeTruthy();
    expect(post.body).toMatchObject({ transaction_amount: 150.5, payment_method_id: 'pix', external_reference: 'entry_1', notification_url: 'https://erp.exemplo.com/api/hooks/x/1?token=t', payer: { email: 'maria@exemplo.com', first_name: 'Maria', last_name: 'da Silva Souza', identification: { type: 'CPF', number: '52998224725' } } });
    expect((post.body as any).date_of_expiration).toMatch(/^\d{4}-\d{2}-\d{2}T23:59:59\.000-03:00$/);
    expect(r).toMatchObject({ ref: '1234567', pixPayload: '00020126PIXMP' });
  });

  it('boleto: bolbradesco com endereço → link e código de barras', async () => {
    mock([[/^POST .*\/v1\/payments$/, () => ({ id: 777, status: 'pending', barcode: { content: '23791843400000123453381260000000000300000000' }, transaction_details: { external_resource_url: 'https://www.mercadopago.com.br/payments/777/ticket', digitable_line: LINE } })]]);
    const r = await createMpCharge(m, req('BOLETO'));
    expect(calls[0].body).toMatchObject({ payment_method_id: 'bolbradesco', payer: { address: { zip_code: '01310100', street_name: 'Av. Paulista', street_number: '1000', neighborhood: 'Bela Vista', city: 'São Paulo', federal_unit: 'SP' } } });
    expect(r).toMatchObject({ ref: '777', paymentUrl: 'https://www.mercadopago.com.br/payments/777/ticket', boletoBarcode: '23791843400000123453381260000000000300000000', boletoLine: formatLine(LINE) });
  });

  it('boleto exige CPF/CNPJ e endereço', async () => {
    mock([]);
    await expect(createMpCharge(m, { ...req('BOLETO'), payer: { name: 'Sem Doc', email: 'x@y.com' } })).rejects.toThrow(/CPF\/CNPJ/);
    expect(calls).toHaveLength(0);
  });

  it('cartão: Checkout Pro (preferência) com sandbox_init_point nas credenciais de teste', async () => {
    mock([[/^POST .*\/checkout\/preferences$/, () => ({ id: 'pref123', init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref123', sandbox_init_point: 'https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=pref123' })]]);
    const r = await createMpCharge(m, req('CARTAO'));
    expect(calls[0].body).toMatchObject({ external_reference: 'entry_1', auto_return: 'approved', back_urls: { success: 'https://erp.exemplo.com/pagar/pg1' }, items: [{ quantity: 1, unit_price: 150.5, currency_id: 'BRL' }] });
    expect(r.ref).toBe('pref-pref123');
    expect(r.paymentUrl).toContain('sandbox.mercadopago');
  });

  it('assinatura x-signature do webhook', () => {
    const secret = 'segredo-do-webhook';
    const ts = '1742505638683';
    const v1 = crypto.createHmac('sha256', secret).update(`id:123456;request-id:req-1;ts:${ts};`).digest('hex');
    expect(verifyMpSignature(secret, { signature: `ts=${ts},v1=${v1}`, requestId: 'req-1', dataId: '123456' })).toBe(true);
    expect(verifyMpSignature(secret, { signature: `ts=${ts},v1=${v1}`, requestId: 'req-1', dataId: '999' })).toBe(false);
    expect(verifyMpSignature('outro', { signature: `ts=${ts},v1=${v1}`, requestId: 'req-1', dataId: '123456' })).toBe(false);
    expect(verifyMpSignature(secret, { signature: null, requestId: 'req-1', dataId: '123456' })).toBe(false);
    // id alfanumérico entra em minúsculas no manifesto
    const v2 = crypto.createHmac('sha256', secret).update(`id:abc9;request-id:r;ts:${ts};`).digest('hex');
    expect(verifyMpSignature(secret, { signature: `ts=${ts}, v1=${v2}`, requestId: 'r', dataId: 'ABC9' })).toBe(true);
  });

  it('pagamento aprovado → baixa com líquido', () => {
    expect(mpPayment({ id: 5, status: 'approved', transaction_amount: 100, transaction_details: { net_received_amount: 99.01 }, external_reference: 'e1', payment_type_id: 'bank_transfer', date_approved: '2026-10-10T10:00:00.000-03:00' })).toMatchObject({ ref: '5', status: 'PAGO', gross: 100, net: 99.01, method: 'PIX', externalReference: 'e1' });
    expect(mpPayment({ id: 5, status: 'refunded' }).status).toBe('ESTORNADO');
    expect(mpPayment({ id: 5, status: 'pending' }).status).toBe('PENDENTE');
  });
});

describe.skipIf(process.env.RUN_DB_TESTS !== '1')('cobrança real + webhook (banco)', () => {
  let prisma: typeof import('@/lib/db').prisma;
  let companyId = '';
  let entryId = '';
  let accountId = '';
  let hadAccount = false;

  beforeAll(async () => {
    prisma = (await import('@/lib/db')).prisma;
    const { encryptJson } = await import('@/server/integrations/crypto');
    const company = await prisma.company.findFirstOrThrow({ where: { cnpj: '11444777000161' } });
    companyId = company.id;
    const contact = await prisma.contact.findFirstOrThrow({ where: { organizationId: company.organizationId, types: { has: 'CLIENTE' }, personType: 'PF', document: { not: null } } });
    hadAccount = !!(await prisma.integrationAccount.findUnique({ where: { companyId_provider: { companyId, provider: 'ASAAS' } } }));
    const data = { status: 'CONECTADO', environment: 'SANDBOX', secrets: encryptJson({ apiKey: '$aact_hmlg_teste' }), settings: { webhookToken: 'tok-webhook', autoCharge: false, default: true } };
    const a = hadAccount
      ? await prisma.integrationAccount.update({ where: { companyId_provider: { companyId, provider: 'ASAAS' } }, data })
      : await prisma.integrationAccount.create({ data: { companyId, provider: 'ASAAS', ...data } });
    accountId = a.id;
    const e = await prisma.financialEntry.create({ data: { companyId, type: 'RECEBER', description: 'Teste cobrança Asaas', contactId: contact.id, contactName: contact.name, dueDate: new Date(Date.now() + 5 * 86400_000), amount: 200, paymentMethod: 'BOLETO', origin: 'MANUAL' } });
    entryId = e.id;
  });

  afterAll(async () => {
    setHttpMock(null);
    if (!prisma) return;
    const fees = await prisma.financialEntry.findMany({ where: { companyId, origin: 'INTEGRACAO', originId: entryId } });
    const ids = [entryId, ...fees.map((f) => f.id)];
    await prisma.bankTransaction.deleteMany({ where: { entryId: { in: ids } } });
    await prisma.paymentLink.deleteMany({ where: { entryId } });
    await prisma.financialEntry.deleteMany({ where: { id: { in: ids } } });
    if (hadAccount) await prisma.integrationAccount.update({ where: { id: accountId }, data: { status: 'DESCONECTADO', secrets: null } });
    else await prisma.integrationAccount.delete({ where: { id: accountId } }).catch(() => {});
  });

  it('emite o boleto no Asaas e o webhook PAYMENT_RECEIVED baixa o título com a tarifa', async () => {
    const { createCharge } = await import('@/server/services/payments');
    const { getProvider } = await import('@/server/integrations/registry');
    const { toCtx } = await import('@/server/integrations/accounts');
    mock([
      [/^GET .*\/customers\?cpfCnpj=/, () => ({ data: [] })],
      [/^POST .*\/customers$/, () => ({ id: 'cus_db1' })],
      [/^POST .*\/payments$/, () => ({ id: 'pay_db1', status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/pay_db1' })],
      [/identificationField$/, () => ({ identificationField: LINE, nossoNumero: '111', barCode: '2379184340000012345' })],
    ]);
    const r = await createCharge(companyId, entryId);
    expect(r.simulated).toBe(false);
    expect(r.entry).toMatchObject({ provider: 'ASAAS', providerRef: 'pay_db1', paymentUrl: 'https://sandbox.asaas.com/i/pay_db1', boletoLine: formatLine(LINE), boletoNumber: '111', pixPayload: null });
    expect((calls.find((c) => c.url.endsWith('/payments'))!.body as any).customer).toBe('cus_db1');
    // cliente guardado para reaproveitar
    const row = await prisma.integrationAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(Object.values((row.settings as any).customers)).toContain('cus_db1');

    const def = getProvider('ASAAS')!;
    const ctx = toCtx(row);
    expect(await def.webhook!.verify!(ctx, { headers: new Headers({ 'asaas-access-token': 'errado' }), raw: '', query: new URLSearchParams() })).toBe(false);
    expect(await def.webhook!.verify!(ctx, { headers: new Headers({ 'asaas-access-token': 'tok-webhook' }), raw: '', query: new URLSearchParams() })).toBe(true);

    const payload = { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_db1', value: 200, netValue: 198.01, externalReference: entryId, billingType: 'BOLETO', status: 'RECEIVED', paymentDate: new Date().toISOString().slice(0, 10) } };
    const msg = await def.webhook!.process({ id: 'ev1', provider: 'ASAAS', companyId, payload } as any, ctx);
    expect(msg).toMatch(/quitado/);
    const paid = await prisma.financialEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(paid.status).toBe('PAGO');
    expect(paid.paidAmount).toBe(200);
    const tx = await prisma.bankTransaction.findMany({ where: { entryId } });
    expect(tx.reduce((s, t) => s + t.amount, 0)).toBe(200);
    const fee = await prisma.financialEntry.findFirstOrThrow({ where: { companyId, origin: 'INTEGRACAO', originId: entryId, type: 'PAGAR' } });
    expect(fee.amount).toBe(1.99);
    expect(fee.status).toBe('PAGO');
    // reentrega do mesmo evento é idempotente
    expect(await def.webhook!.process({ id: 'ev2', provider: 'ASAAS', companyId, payload } as any, ctx)).toMatch(/já quitado/);
  });
});
