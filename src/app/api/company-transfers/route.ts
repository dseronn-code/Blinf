import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { transferBetweenCompanies } from '@/server/services/fiscalExtras';

/** Transferências de estoque entre empresas (CNPJs) do grupo, com NF-e de transferência */
export const GET = route('estoque', 'view', async ({ ctx }) => {
  const rows = await prisma.companyTransfer.findMany({ where: { OR: [{ fromCompanyId: { in: ctx.companyIds } }, { toCompanyId: { in: ctx.companyIds } }] }, orderBy: { createdAt: 'desc' }, take: 200 });
  const companies = await prisma.company.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, tradeName: true } });
  const invoices = await prisma.invoice.findMany({ where: { id: { in: rows.map((r) => r.invoiceId).filter(Boolean) as string[] } }, select: { id: true, number: true, status: true } });
  return rows.map((r) => ({ ...r, from: companies.find((c) => c.id === r.fromCompanyId)?.tradeName, to: companies.find((c) => c.id === r.toCompanyId)?.tradeName, invoice: invoices.find((i) => i.id === r.invoiceId) }));
});

export const POST = route('estoque', 'edit', async ({ ctx, body }) => transferBetweenCompanies(ctx, body));
