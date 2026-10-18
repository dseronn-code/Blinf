import { prisma } from '@/lib/db';
import { route, fileResponse } from '@/server/http';
import { fail } from '@/server/errors';
import { randomDigits } from '@/lib/utils';
import { payEntry, billingData, defaultBankAccount, realPixKey, PAYMENT_HOWTO } from '@/server/services/finance';
import { isDemoMode, requireRealOrDemo } from '@/lib/demo';
import { boletoPdf } from '@/server/pdf';
import { buildPixPayload } from '@/lib/br';
import { createCharge, cancelCharge, refundCharge, paymentAccount, type ChargeMethod } from '@/server/services/payments';

export const POST = route('financeiro', 'edit', async ({ ctx, params, body }) => {
  const e = await prisma.financialEntry.findFirst({ where: { id: params.id, companyId: ctx.companyId } });
  if (!e) fail(404, 'Lançamento não encontrado');
  switch (params.action) {
    case 'pay':
      return payEntry(ctx.companyId, ctx.orgId, params.id, {
        amount: body.amount != null && body.amount !== '' ? Number(body.amount) : undefined, date: body.date ? new Date(body.date + 'T12:00:00') : new Date(), bankAccountId: body.bankAccountId,
        method: body.method, interest: Number(body.interest) || 0, fine: Number(body.fine) || 0, discount: Number(body.discount) || 0, userName: ctx.userName,
      });
    case 'reverse': {
      // Estorno da baixa: remove movimentos bancários e reabre o título
      await prisma.bankTransaction.deleteMany({ where: { entryId: e!.id, source: { not: 'OFX' } } });
      await prisma.bankTransaction.updateMany({ where: { entryId: e!.id }, data: { entryId: null, reconciled: false } });
      return prisma.financialEntry.update({ where: { id: e!.id }, data: { status: 'ABERTO', paidAmount: 0, paymentDate: null, interest: 0, fine: 0, discountAmount: 0 } });
    }
    case 'cancel':
      if (e!.paidAmount > 0) fail(400, 'Estorne a baixa antes de cancelar');
      // Cancela também a cobrança registrada no provedor (boleto/Pix não fica pagável)
      if (e!.provider) await cancelCharge(ctx.companyId, e!.id).catch(() => {});
      return prisma.financialEntry.update({ where: { id: e!.id }, data: { status: 'CANCELADO' } });
    case 'charge': {
      // Emite a cobrança no Asaas/Mercado Pago (ou a simulada, sem provedor conectado)
      const method = (['PIX', 'BOLETO', 'CARTAO', 'UNDEFINED'].includes(body?.method) ? body.method : undefined) as ChargeMethod | undefined;
      const r = await createCharge(ctx.companyId, e!.id, method);
      return { ...r.entry, simulated: r.simulated, redirectUrl: 'redirectUrl' in r ? r.redirectUrl : null };
    }
    case 'cancel-charge':
      if (!e!.provider) fail(400, 'O título não tem cobrança registrada em provedor');
      return cancelCharge(ctx.companyId, e!.id);
    case 'refund-charge':
      return refundCharge(ctx.companyId, e!.id, body?.amount ? Number(body.amount) : undefined);
    case 'billing': {
      // Provedor conectado (ou produção: sem boleto inventado — createCharge recusa ou gera só o Pix estático)
      if (!isDemoMode() || (await paymentAccount(ctx.companyId))) return (await createCharge(ctx.companyId, e!.id)).entry;
      // Gera (ou regenera) boleto + Pix para o título
      const company = await prisma.company.findUnique({ where: { id: ctx.companyId } });
      const bank = await defaultBankAccount(prisma, ctx.companyId, 'CONTA_DIGITAL');
      return prisma.financialEntry.update({ where: { id: e!.id }, data: { ...billingData(company!, bank!, e!.amount - e!.paidAmount, e!.dueDate), paymentMethod: e!.paymentMethod || 'BOLETO' } });
    }
    case 'link': {
      const company = await prisma.company.findUnique({ where: { id: ctx.companyId } });
      const bank = await defaultBankAccount(prisma, ctx.companyId, 'CONTA_DIGITAL');
      const slug = `pg${randomDigits(10)}`;
      const amount = e!.amount - e!.paidAmount;
      const pixKey = isDemoMode() ? bank?.pixKey || company!.cnpj : realPixKey(bank);
      if (!pixKey && !(await paymentAccount(ctx.companyId))) requireRealOrDemo('Link de pagamento', `${PAYMENT_HOWTO} Ou cadastre a chave Pix da conta bancária em Finanças → Contas bancárias.`);
      return prisma.paymentLink.create({ data: { companyId: ctx.companyId, slug, description: e!.description, amount, entryId: e!.id, customerName: e!.contactName, methods: body?.methods || 'TODOS', expiresAt: e!.dueDate, pixPayload: pixKey ? buildPixPayload({ key: pixKey, name: company!.tradeName || company!.name, city: company!.city || 'SAO PAULO', amount, txid: slug }) : null } });
    }
    default:
      fail(404, 'Ação inválida');
  }
});

// GET /api/finance/entries/:id/boleto
export const GET = route('financeiro', 'view', async ({ ctx, params }) => {
  if (params.action !== 'boleto') fail(404, 'Ação inválida');
  let e = await prisma.financialEntry.findFirst({ where: { id: params.id, companyId: { in: ctx.companyIds } } });
  if (!e) fail(404, 'Lançamento não encontrado');
  // Cobrança real: o boleto/fatura oficial fica no provedor
  if (e!.provider && e!.paymentUrl) return Response.redirect(e!.paymentUrl, 302);
  // Boleto local (linha digitável inventada) só no modo demonstração
  requireRealOrDemo('Boleto em PDF', `O boleto só existe registrado no provedor de cobrança. ${PAYMENT_HOWTO}`);
  const company = await prisma.company.findUnique({ where: { id: e!.companyId } });
  const bank = await defaultBankAccount(prisma, e!.companyId, 'CONTA_DIGITAL');
  if (!e!.boletoLine) e = await prisma.financialEntry.update({ where: { id: e!.id }, data: billingData(company!, bank!, e!.amount - e!.paidAmount, e!.dueDate) });
  const payer = e!.contactId ? await prisma.contact.findUnique({ where: { id: e!.contactId } }) : null;
  const pdf = await boletoPdf(e!, company!, bank, payer ? { ...payer } : { name: e!.contactName || '' });
  return fileResponse(Buffer.from(pdf), 'application/pdf', `boleto-${e!.boletoNumber}.pdf`);
});
