import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { buildInvoice } from '@/server/services/fiscal';

export const GET = route('fiscal', 'view', async ({ ctx, query }) => {
  const where: any = { companyId: ctx.consolidated ? { in: ctx.companyIds } : ctx.companyId };
  if (query.get('model')) where.model = query.get('model');
  if (query.get('status')) where.status = query.get('status');
  const q = query.get('q')?.trim();
  if (q) where.OR = [{ customerName: { contains: q, mode: 'insensitive' } }, { accessKey: { contains: q } }, ...(Number(q) ? [{ number: Number(q) }] : [])];
  if (query.get('from') || query.get('to')) where.issueDate = { ...(query.get('from') ? { gte: new Date(query.get('from')!) } : {}), ...(query.get('to') ? { lte: new Date(query.get('to') + 'T23:59:59') } : {}) };
  const pageSize = Math.min(Number(query.get('pageSize')) || 50, 500);
  const page = Math.max(Number(query.get('page')) || 1, 1);
  const [rows, total, sums] = await Promise.all([
    prisma.invoice.findMany({ where, orderBy: [{ issueDate: 'desc' }], take: pageSize, skip: (page - 1) * pageSize, select: { id: true, model: true, number: true, series: true, status: true, customerName: true, customerDoc: true, issueDate: true, total: true, accessKey: true, natureName: true, salesOrderId: true, rejectionReason: true, icmsValue: true, issValue: true } }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({ where: { ...where, status: 'AUTORIZADA' }, _sum: { total: true, icmsValue: true, ipiValue: true, pisValue: true, cofinsValue: true, issValue: true } }),
  ]);
  return { rows, total, page, pageSize, sums: sums._sum };
});

/** Emissão de nota avulsa (rascunho) */
export const POST = route('fiscal', 'edit', async ({ ctx, body }) => buildInvoice(prisma, { companyId: ctx.companyId, model: body.model || 'NFE', natureId: body.natureId, customerId: body.customerId, items: body.items || [], freight: Number(body.freight) || 0, discount: Number(body.discount) || 0, additionalInfo: body.additionalInfo }));
