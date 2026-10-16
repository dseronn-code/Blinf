import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { round2, startOfDay } from '@/lib/utils';
import { createEntries, effectiveStatus } from '@/server/services/finance';

export const GET = route('financeiro', 'view', async ({ ctx, query }) => {
  const where: any = { companyId: ctx.consolidated ? { in: ctx.companyIds } : ctx.companyId };
  if (query.get('type')) where.type = query.get('type');
  const status = query.get('status');
  if (status === 'VENCIDO') Object.assign(where, { status: { in: ['ABERTO', 'PARCIAL'] }, dueDate: { lt: startOfDay() } });
  else if (status === 'EM_ABERTO') where.status = { in: ['ABERTO', 'PARCIAL'] };
  else if (status) where.status = status;
  else where.status = { not: 'CANCELADO' };
  const q = query.get('q')?.trim();
  if (q) where.OR = [{ description: { contains: q, mode: 'insensitive' } }, { contactName: { contains: q, mode: 'insensitive' } }, { documentNumber: { contains: q } }];
  if (query.get('contactId')) where.contactId = query.get('contactId');
  if (query.get('origin')) where.origin = query.get('origin');
  if (query.get('from') || query.get('to')) where.dueDate = { ...(where.dueDate || {}), ...(query.get('from') ? { gte: new Date(query.get('from')!) } : {}), ...(query.get('to') ? { lte: new Date(query.get('to') + 'T23:59:59') } : {}) };
  const pageSize = Math.min(Number(query.get('pageSize')) || 100, 1000);
  const page = Math.max(Number(query.get('page')) || 1, 1);
  const [rows, total, all] = await Promise.all([
    prisma.financialEntry.findMany({ where, orderBy: [{ dueDate: 'asc' }], take: pageSize, skip: (page - 1) * pageSize }),
    prisma.financialEntry.count({ where }),
    prisma.financialEntry.findMany({ where, select: { amount: true, paidAmount: true, status: true, dueDate: true } }),
  ]);
  const charts = await prisma.chartAccount.findMany({ where: { companyId: { in: ctx.companyIds } }, select: { id: true, name: true, code: true } });
  const today = startOfDay();
  const totals = {
    amount: round2(all.reduce((a, e) => a + e.amount, 0)),
    paid: round2(all.reduce((a, e) => a + e.paidAmount, 0)),
    open: round2(all.filter((e) => e.status !== 'PAGO').reduce((a, e) => a + e.amount - e.paidAmount, 0)),
    overdue: round2(all.filter((e) => e.status !== 'PAGO' && e.dueDate < today).reduce((a, e) => a + e.amount - e.paidAmount, 0)),
  };
  return { rows: rows.map((r) => ({ ...r, effectiveStatus: effectiveStatus(r), chartAccount: charts.find((c) => c.id === r.chartAccountId) })), total, page, pageSize, totals };
});

export const POST = route('financeiro', 'edit', async ({ ctx, body }) => {
  const total = round2(Number(String(body.amount ?? '').replace(',', '.')));
  if (!(total > 0)) fail(400, 'Informe o valor');
  if (!body.description) fail(400, 'Informe a descrição');
  const contact = body.contactId ? await prisma.contact.findFirst({ where: { id: body.contactId, organizationId: ctx.orgId } }) : null;
  const recurrence = Number(body.recurrence) || 0; // repetir mensalmente N vezes
  const entries = await createEntries(prisma, {
    companyId: ctx.companyId, type: body.type === 'PAGAR' ? 'PAGAR' : 'RECEBER', description: body.description, contactId: contact?.id, contactName: contact?.name || body.contactName,
    total: recurrence > 1 ? round2(total * recurrence) : total, installments: recurrence > 1 ? recurrence : Number(body.installments) || 1, firstDueDate: body.dueDate ? new Date(body.dueDate) : new Date(),
    intervalDays: 30, origin: 'MANUAL', chartAccountId: body.chartAccountId || null, costCenterId: body.costCenterId || null, paymentMethod: body.paymentMethod || null, documentNumber: body.documentNumber || null,
    competenceDate: body.competenceDate ? new Date(body.competenceDate) : undefined, notes: body.notes,
  });
  return { ok: true, entries };
});
