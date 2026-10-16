import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { getAvailability } from '@/server/services/stock';
import { saveProduct, generateVariations } from '@/server/services/products';

export const GET = route('cadastros', 'view', async ({ ctx, params }) => {
  const p = await prisma.product.findFirst({
    where: { id: params.id, organizationId: ctx.orgId },
    include: {
      category: true,
      parent: { select: { id: true, name: true, sku: true } },
      components: { include: { component: { select: { id: true, sku: true, name: true, costPrice: true, unit: true } } } },
      variations: { orderBy: { sku: 'asc' } },
      balances: { include: { warehouse: { select: { id: true, name: true, companyId: true } } } },
      lots: { where: { quantity: { gt: 0 } }, orderBy: { expiresAt: 'asc' } },
      priceItems: { include: { priceList: { select: { name: true } } } },
      listings: { include: { channel: { select: { name: true, provider: true } } } },
    },
  });
  if (!p) fail(404, 'Produto não encontrado');
  const avail = await getAvailability(prisma, ctx, [p!.id, ...p!.variations.map((v) => v.id)]);
  const movements = await prisma.stockMovement.findMany({ where: { productId: { in: [p!.id, ...p!.variations.map((v) => v.id)] }, companyId: ctx.companyId }, orderBy: { createdAt: 'desc' }, take: 30 });
  return { ...p, stock: avail.get(p!.id), variations: p!.variations.map((v) => ({ ...v, stock: avail.get(v.id) })), movements };
});

export const PUT = route('cadastros', 'edit', async ({ ctx, params, body }) => {
  if (body?.action === 'generate-variations') return generateVariations(ctx, params.id, body.attributes);
  return saveProduct(ctx, body, params.id);
});

export const DELETE = route('cadastros', 'edit', async ({ ctx, params }) => {
  const p = await prisma.product.findFirst({ where: { id: params.id, organizationId: ctx.orgId } });
  if (!p) fail(404, 'Produto não encontrado');
  const used = await prisma.salesOrderItem.count({ where: { productId: params.id } });
  if (used) {
    // Produtos com histórico são inativados (preserva relatórios)
    await prisma.product.update({ where: { id: params.id }, data: { active: false } });
    return { ok: true, inactivated: true };
  }
  await prisma.product.delete({ where: { id: params.id } });
  return { ok: true };
});
