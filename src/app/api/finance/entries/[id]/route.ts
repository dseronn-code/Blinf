import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';

export const GET = route('financeiro', 'view', async ({ ctx, params }) => {
  const e = await prisma.financialEntry.findFirst({ where: { id: params.id, companyId: { in: ctx.companyIds } } });
  if (!e) fail(404, 'Lançamento não encontrado');
  const transactions = await prisma.bankTransaction.findMany({ where: { entryId: e!.id }, include: { bankAccount: { select: { name: true } } } });
  const links = await prisma.paymentLink.findMany({ where: { entryId: e!.id } });
  return { ...e, transactions, links };
});

export const PUT = route('financeiro', 'edit', async ({ ctx, params, body }) => {
  const e = await prisma.financialEntry.findFirst({ where: { id: params.id, companyId: ctx.companyId } });
  if (!e) fail(404, 'Lançamento não encontrado');
  if (e!.status === 'PAGO') fail(400, 'Lançamento quitado não pode ser alterado (estorne a baixa)');
  const data: any = {};
  for (const f of ['description', 'contactName', 'documentNumber', 'paymentMethod', 'chartAccountId', 'costCenterId', 'notes']) if (f in body) data[f] = body[f] || null;
  if (body.amount != null) data.amount = Number(body.amount);
  if (body.dueDate) data.dueDate = new Date(body.dueDate);
  if (body.competenceDate) data.competenceDate = new Date(body.competenceDate);
  return prisma.financialEntry.update({ where: { id: params.id }, data });
});

export const DELETE = route('financeiro', 'edit', async ({ ctx, params }) => {
  const e = await prisma.financialEntry.findFirst({ where: { id: params.id, companyId: ctx.companyId } });
  if (!e) fail(404, 'Lançamento não encontrado');
  if (e!.paidAmount > 0) fail(400, 'Lançamento com baixa não pode ser excluído — estorne antes');
  if (e!.origin !== 'MANUAL') {
    await prisma.financialEntry.update({ where: { id: params.id }, data: { status: 'CANCELADO' } });
    return { ok: true, cancelled: true };
  }
  await prisma.financialEntry.delete({ where: { id: params.id } });
  return { ok: true };
});
