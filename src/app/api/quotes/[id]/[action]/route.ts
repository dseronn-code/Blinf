import { prisma } from '@/lib/db';
import { route, fileResponse } from '@/server/http';
import { fail } from '@/server/errors';
import { approveQuote, convertQuote } from '@/server/services/sales';
import { tablePdf } from '@/server/pdf';
import { money, fmtDate } from '@/lib/utils';

export const POST = route('vendas', 'edit', async ({ ctx, params }) => {
  const a = { companyId: ctx.companyId, orgId: ctx.orgId, userName: ctx.userName };
  const q = await prisma.quote.findFirst({ where: { id: params.id, companyId: ctx.companyId } });
  if (!q) fail(404, 'Proposta não encontrada');
  switch (params.action) {
    case 'send':
      return prisma.quote.update({ where: { id: params.id }, data: { status: 'ENVIADA' } });
    case 'approve':
      return approveQuote(a, params.id);
    case 'reject':
      return prisma.quote.update({ where: { id: params.id }, data: { status: 'RECUSADA' } });
    case 'convert':
      return convertQuote(a, params.id);
    default:
      fail(404, 'Ação inválida');
  }
});

export const GET = route('vendas', 'view', async ({ ctx, params }) => {
  const q = await prisma.quote.findFirst({ where: { id: params.id, companyId: ctx.companyId }, include: { items: true, customer: true } });
  if (!q) fail(404, 'Proposta não encontrada');
  const company = await prisma.company.findUnique({ where: { id: ctx.companyId } });
  const pdf = await tablePdf(
    `Proposta comercial nº ${q!.number} - ${company?.tradeName}`,
    [{ key: 'description', label: 'Descrição' }, { key: 'quantity', label: 'Qtd', align: 'right' }, { key: 'unitPrice', label: 'Unitário', align: 'right' }, { key: 'discount', label: 'Desconto', align: 'right' }, { key: 'total', label: 'Total', align: 'right' }],
    q!.items.map((i) => ({ ...i })),
    `Cliente: ${q!.customer.name} | Validade: ${fmtDate(q!.validUntil)} | Pagamento: ${q!.paymentTerms || '-'} | Entrega: ${q!.deliveryTerms || '-'}`,
    { description: `TOTAL DA PROPOSTA: ${money(q!.total)}` },
  );
  return fileResponse(Buffer.from(pdf), 'application/pdf', `proposta-${q!.number}.pdf`);
});
