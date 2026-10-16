import { prisma } from '@/lib/db';
import { route, fileResponse } from '@/server/http';
import { fail } from '@/server/errors';
import { changeServiceOrderStatus, invoiceServiceOrder } from '@/server/services/serviceOrders';
import { tablePdf } from '@/server/pdf';
import { money } from '@/lib/utils';

export const POST = route('servicos', 'edit', async ({ ctx, params, body }) => {
  switch (params.action) {
    case 'status':
      await changeServiceOrderStatus(ctx, params.id, body.status, body.note);
      return { ok: true };
    case 'invoice':
      return invoiceServiceOrder(ctx, params.id, { installments: body?.installments, paymentMethod: body?.paymentMethod, emitNfse: body?.emitNfse });
    default:
      fail(404, 'Ação inválida');
  }
});

export const GET = route('servicos', 'view', async ({ ctx, params }) => {
  const os = await prisma.serviceOrder.findFirst({ where: { id: params.id, companyId: ctx.companyId }, include: { items: true, customer: true } });
  if (!os) fail(404, 'OS não encontrada');
  const pdf = await tablePdf(`Ordem de serviço nº ${os!.number}`, [{ key: 'kind', label: 'Tipo' }, { key: 'description', label: 'Descrição' }, { key: 'quantity', label: 'Qtd', align: 'right' }, { key: 'unitPrice', label: 'Unitário', align: 'right' }, { key: 'total', label: 'Total', align: 'right' }], os!.items.map((i) => ({ ...i })), `Cliente: ${os!.customer.name} | Equipamento: ${os!.equipment || '-'} ${os!.brand || ''} ${os!.model || ''} | Defeito: ${os!.problem}`, { description: `TOTAL ${money(os!.total)}` });
  return fileResponse(Buffer.from(pdf), 'application/pdf', `os-${os!.number}.pdf`);
});
