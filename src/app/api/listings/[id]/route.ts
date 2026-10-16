import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';

/** Pausar/ativar anúncio ou ajustar título/preço manualmente */
export const PUT = route('vendas', 'edit', async ({ ctx, params, body }) => {
  const l = await prisma.listing.findFirst({ where: { id: params.id, channel: { companyId: ctx.companyId } } });
  if (!l) fail(404, 'Anúncio não encontrado');
  const data: any = { lastSyncAt: new Date() };
  if (body.status) data.status = body.status;
  if (body.title) data.title = body.title;
  if (body.price != null) data.price = Number(body.price);
  const updated = await prisma.listing.update({ where: { id: params.id }, data });
  await prisma.integrationLog.create({ data: { channelId: l!.channelId, type: 'ANUNCIO', message: `Anúncio ${l!.externalId} atualizado: ${JSON.stringify(body)}` } });
  return updated;
});
