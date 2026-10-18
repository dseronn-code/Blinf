import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { emit } from '@/server/events';
import { round2, randomDigits, onlyDigits } from '@/lib/utils';
import { isValidCPF, isValidCNPJ } from '@/lib/br';
import { createOrder, markInvoicedWithoutNote } from '@/server/services/sales';
import { defaultBankAccount } from '@/server/services/finance';
import { isDemoMode } from '@/lib/demo';

/**
 * Finaliza uma venda no PDV: cria o pedido (origem PDV), registra os pagamentos
 * no caixa/maquininha (POS simulado só no modo demonstração; em produção NSU/autorização/bandeira
 * são os informados pelo operador, opcionais) e dispara a emissão da NFC-e (automação).
 */
export const POST = route('pdv', 'edit', async ({ ctx, body }) => {
  const session = await prisma.cashSession.findFirst({ where: { companyId: ctx.companyId, status: 'ABERTO' } });
  if (!session) fail(400, 'Abra o caixa antes de vender');
  const payments: { method: string; amount: number; installments?: number; nsu?: string; authCode?: string; brand?: string }[] = (body.payments || []).filter((p: { amount: number }) => Number(p.amount) > 0);
  if (!payments.length) fail(400, 'Informe a forma de pagamento');
  const doc = onlyDigits(body.customerDoc);
  if (doc && !(doc.length === 11 ? isValidCPF(doc) : isValidCNPJ(doc))) fail(400, 'CPF/CNPJ do consumidor inválido');
  let customer = body.customerId ? await prisma.contact.findFirst({ where: { id: body.customerId, organizationId: ctx.orgId } }) : null;
  if (!customer && doc) customer = (await prisma.contact.findFirst({ where: { organizationId: ctx.orgId, document: doc } })) || (await prisma.contact.create({ data: { organizationId: ctx.orgId, types: ['CLIENTE'], personType: doc.length === 14 ? 'PJ' : 'PF', name: body.customerName || `Consumidor ${doc.slice(-4)}`, document: doc, city: 'São Paulo', uf: 'SP' } }));
  if (!customer) customer = (await prisma.contact.findFirst({ where: { organizationId: ctx.orgId, code: 'CONSUMIDOR' } })) || (await prisma.contact.create({ data: { organizationId: ctx.orgId, code: 'CONSUMIDOR', types: ['CLIENTE'], name: 'Consumidor Final' } }));
  const main = [...payments].sort((a, b) => b.amount - a.amount)[0];
  const order = await createOrder(ctx, {
    customerId: customer.id, origin: 'PDV', items: body.items, discount: Number(body.discount) || 0, paymentMethod: main.method, installments: main.installments || 1,
    paidOnCreate: true, warehouseId: body.warehouseId || null, cashSessionId: session!.id, sellerId: body.sellerId || null, notes: 'Venda balcão (PDV)',
  });
  const paid = round2(payments.reduce((a, p) => a + Number(p.amount), 0));
  if (paid + 0.009 < order.total) {
    await prisma.salesOrder.delete({ where: { id: order.id } });
    fail(400, `Pagamento insuficiente: total ${order.total.toFixed(2)}, pago ${paid.toFixed(2)}`);
  }
  const change = round2(paid - order.total);
  // Registra pagamentos no caixa e transações POS (cartão/pix) com taxa
  const terminal = await prisma.posTerminal.findFirst({ where: { companyId: ctx.companyId, active: true, ...(body.terminalId ? { id: body.terminalId } : {}) } });
  const demo = isDemoMode();
  const posSlip = (p: (typeof payments)[number]) => demo
    ? { nsu: randomDigits(9), authCode: randomDigits(6), brand: p.method === 'PIX' ? null : ['Visa', 'Mastercard', 'Elo'][Math.floor(Math.random() * 3)] }
    : { nsu: String(p.nsu ?? '').trim().slice(0, 20), authCode: String(p.authCode ?? '').trim().slice(0, 20), brand: p.method === 'PIX' ? null : String(p.brand ?? '').trim().slice(0, 30) || null };
  let remaining = order.total;
  for (const p of payments) {
    const amount = round2(Math.min(Number(p.amount), remaining + (p.method === 'DINHEIRO' ? 0 : 0)));
    const value = p.method === 'DINHEIRO' ? round2(Math.min(Number(p.amount), remaining)) : amount;
    remaining = round2(remaining - value);
    await prisma.cashMovement.create({ data: { sessionId: session!.id, type: 'VENDA', method: p.method, amount: value, orderId: order.id } });
    if (terminal && ['CARTAO_CREDITO', 'CARTAO_DEBITO', 'PIX'].includes(p.method) && value > 0) {
      const rate = p.method === 'CARTAO_CREDITO' ? terminal.creditFee : p.method === 'CARTAO_DEBITO' ? terminal.debitFee : terminal.pixFee;
      const fee = round2((value * rate) / 100);
      await prisma.posTransaction.create({ data: { companyId: ctx.companyId, terminalId: terminal.id, method: p.method === 'PIX' ? 'PIX' : p.method === 'CARTAO_CREDITO' ? 'CREDITO' : 'DEBITO', installments: p.installments || 1, amount: value, fee, netAmount: round2(value - fee), ...posSlip(p), orderId: order.id } });
      // taxa lançada na conta de recebíveis de cartão (liquidação líquida em D+1/D+30)
      const bank = p.method === 'PIX' ? await defaultBankAccount(prisma, ctx.companyId, 'CONTA_DIGITAL') : await defaultBankAccount(prisma, ctx.companyId, 'CARTAO');
      if (bank && fee > 0) await prisma.bankTransaction.create({ data: { companyId: ctx.companyId, bankAccountId: bank.id, date: new Date(), description: `Taxa ${terminal.acquirer} - pedido ${order.number}`, amount: -fee, source: 'TARIFA', reconciled: true } });
    }
  }
  await emit('pdv.sale', { companyId: ctx.companyId, orgId: ctx.orgId, orderId: order.id, userName: ctx.userName });
  let fresh = await prisma.salesOrder.findUnique({ where: { id: order.id } });
  // Sem automação de NFC-e ativa (ou nota rejeitada): conclui a venda sem documento fiscal
  if (fresh?.status === 'ABERTO') {
    await markInvoicedWithoutNote(ctx, order.id);
    fresh = await prisma.salesOrder.findUnique({ where: { id: order.id } });
  }
  const invoice = await prisma.invoice.findFirst({ where: { salesOrderId: order.id }, orderBy: { createdAt: 'desc' } });
  return { order: fresh, change, invoice };
});
