import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { emit } from '@/server/events';
import { checkinPurchase, receivePurchase, postPurchaseStock, postPurchaseFinancial } from '@/server/services/purchases';

export const POST = route('compras', 'edit', async ({ ctx, params, body }) => {
  const a = { companyId: ctx.companyId, orgId: ctx.orgId, userName: ctx.userName };
  const po = await prisma.purchaseOrder.findFirst({ where: { id: params.id, companyId: ctx.companyId } });
  if (!po) fail(404, 'Pedido de compra não encontrado');
  switch (params.action) {
    case 'send':
      return prisma.purchaseOrder.update({ where: { id: params.id }, data: { status: 'ENVIADO' } });
    case 'checkin':
      return checkinPurchase(a, params.id, body.items || []);
    case 'receive':
      return receivePurchase(a, params.id);
    case 'cancel':
      if (po!.status === 'RECEBIDO') fail(400, 'Pedido já recebido');
      return prisma.purchaseOrder.update({ where: { id: params.id }, data: { status: 'CANCELADO' } });
    case 'post-stock': {
      const c = await postPurchaseStock(a, params.id);
      await emit('stock.changed', { ...a, productIds: c });
      return { ok: true };
    }
    case 'post-financial':
      return { ok: true, entries: (await postPurchaseFinancial(a, params.id)).length };
    default:
      fail(404, 'Ação inválida');
  }
});
