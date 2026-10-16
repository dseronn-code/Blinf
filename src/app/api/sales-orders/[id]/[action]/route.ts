import { prisma } from '@/lib/db';
import { route, fileResponse } from '@/server/http';
import { fail } from '@/server/errors';
import { emit } from '@/server/events';
import {
  invoiceOrder, markInvoicedWithoutNote, cancelOrder, reserveOrder, releaseOrderReservation, postOrderStock, postOrderFinancial, postCommission, setOrderStatus,
} from '@/server/services/sales';
import { createShipment } from '@/server/services/logistics';
import { splitOrder } from '@/server/services/operations';
import { tablePdf } from '@/server/pdf';
import { money } from '@/lib/utils';

/** Ações do pedido de venda: faturar, cancelar, lançar estoque/contas, status, etiqueta, PDF */
export const POST = route('vendas', 'edit', async ({ ctx, params, body }) => {
  const id = params.id;
  const a = { companyId: ctx.companyId, orgId: ctx.orgId, userName: ctx.userName };
  switch (params.action) {
    case 'invoice':
      return invoiceOrder(a, id, { model: body?.model, natureId: body?.natureId });
    case 'invoice-without-note':
      await markInvoicedWithoutNote(a, id);
      return { ok: true };
    case 'cancel':
      await cancelOrder(a, id, body?.reason || '');
      return { ok: true };
    case 'reserve': {
      const c = await reserveOrder(a, id);
      await emit('stock.changed', { ...a, productIds: c });
      return { ok: true, changed: c.length };
    }
    case 'release': {
      const c = await releaseOrderReservation(a, id);
      await emit('stock.changed', { ...a, productIds: c });
      return { ok: true };
    }
    case 'post-stock': {
      const c = await postOrderStock(a, id);
      await emit('stock.changed', { ...a, productIds: c });
      return { ok: true, changed: c.length };
    }
    case 'post-financial':
      return { ok: true, entries: (await postOrderFinancial(a, id)).length };
    case 'commission':
      return { ok: true, commission: await postCommission(a, id) };
    case 'status':
      return setOrderStatus(a, id, body?.status);
    case 'split':
      return splitOrder(a, id, body?.items || []);
    case 'shipment':
      return createShipment(a, id, body?.option || null);
    default:
      fail(404, 'Ação inválida');
  }
});

// GET /api/sales-orders/:id/pdf — espelho do pedido
export const GET = route('vendas', 'view', async ({ ctx, params }) => {
  if (params.action !== 'pdf') fail(404, 'Ação inválida');
  const o = await prisma.salesOrder.findFirst({ where: { id: params.id, companyId: { in: ctx.companyIds } }, include: { items: true, customer: true } });
  if (!o) fail(404, 'Pedido não encontrado');
  const company = await prisma.company.findUnique({ where: { id: o!.companyId } });
  const pdf = await tablePdf(
    `Pedido de venda nº ${o!.number} - ${company?.tradeName}`,
    [{ key: 'sku', label: 'Código' }, { key: 'description', label: 'Descrição' }, { key: 'quantity', label: 'Qtd', align: 'right' }, { key: 'unitPrice', label: 'Unitário', align: 'right' }, { key: 'total', label: 'Total', align: 'right' }],
    o!.items.map((i) => ({ ...i })),
    `Cliente: ${o!.customer.name} | Data: ${o!.date.toLocaleDateString('pt-BR')} | Situação: ${o!.status} | Pagamento: ${o!.paymentMethod} ${o!.installments}x`,
    { description: `Subtotal ${money(o!.subtotal)}  Desconto ${money(o!.discount)}  Frete ${money(o!.freight)}  TOTAL ${money(o!.total)}` },
  );
  return fileResponse(Buffer.from(pdf), 'application/pdf', `pedido-${o!.number}.pdf`);
});
