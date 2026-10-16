import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { saveQuote } from '@/server/services/sales';

export const GET = route('vendas', 'view', async ({ ctx, params }) => {
  const q = await prisma.quote.findFirst({ where: { id: params.id, companyId: ctx.companyId }, include: { items: true, customer: true } });
  if (!q) fail(404, 'Proposta não encontrada');
  return q;
});
export const PUT = route('vendas', 'edit', async ({ ctx, params, body }) => saveQuote(ctx, body, params.id));
export const DELETE = route('vendas', 'edit', async ({ ctx, params }) => {
  const q = await prisma.quote.findFirst({ where: { id: params.id, companyId: ctx.companyId } });
  if (!q) fail(404, 'Proposta não encontrada');
  if (q!.status === 'CONVERTIDA') fail(400, 'Proposta convertida não pode ser excluída');
  await prisma.quote.delete({ where: { id: params.id } });
  return { ok: true };
});
