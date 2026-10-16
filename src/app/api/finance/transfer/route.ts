import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { round2, randomDigits } from '@/lib/utils';
import { bankBalance } from '@/server/services/finance';

/**
 * Transferências (SIMULADAS): entre contas próprias, Pix ou TED para terceiros
 * a partir da Conta Digital PJ.
 */
export const POST = route('financeiro', 'edit', async ({ ctx, body }) => {
  const amount = round2(Number(body.amount));
  if (!(amount > 0)) fail(400, 'Informe o valor');
  const from = await prisma.bankAccount.findFirst({ where: { id: body.fromId, companyId: ctx.companyId } });
  if (!from) fail(400, 'Conta de origem inválida');
  const balance = await bankBalance(prisma, from!.id);
  if (from!.type === 'CONTA_DIGITAL' && balance < amount) fail(400, `Saldo insuficiente (disponível ${balance.toFixed(2)})`);
  const e2e = `E${randomDigits(8)}${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${randomDigits(11)}`;
  if (body.kind === 'INTERNA') {
    const to = await prisma.bankAccount.findFirst({ where: { id: body.toId, companyId: ctx.companyId } });
    if (!to || to.id === from!.id) fail(400, 'Conta de destino inválida');
    await prisma.bankTransaction.create({ data: { companyId: ctx.companyId, bankAccountId: from!.id, date: new Date(), description: `Transferência para ${to!.name}`, amount: -amount, source: 'TRANSFERENCIA', reconciled: true } });
    await prisma.bankTransaction.create({ data: { companyId: ctx.companyId, bankAccountId: to!.id, date: new Date(), description: `Transferência de ${from!.name}`, amount, source: 'TRANSFERENCIA', reconciled: true } });
    return { ok: true };
  }
  if (!body.recipient) fail(400, 'Informe o favorecido / chave Pix');
  const fee = body.kind === 'TED' ? 8.5 : 0;
  const tx = await prisma.bankTransaction.create({ data: { companyId: ctx.companyId, bankAccountId: from!.id, date: new Date(), description: `${body.kind === 'TED' ? 'TED' : 'Pix enviado'} - ${body.recipient}${body.description ? ' - ' + body.description : ''}`, amount: -amount, source: body.kind === 'TED' ? 'TRANSFERENCIA' : 'PIX', reconciled: true, counterpart: body.recipient, fitId: e2e } });
  if (fee) await prisma.bankTransaction.create({ data: { companyId: ctx.companyId, bankAccountId: from!.id, date: new Date(), description: 'Tarifa TED', amount: -fee, source: 'TARIFA', reconciled: true } });
  return { ok: true, receipt: { id: tx.id, e2e, amount, recipient: body.recipient, date: tx.date, simulated: true } };
});
