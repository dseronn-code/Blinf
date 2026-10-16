import { prisma } from '@/lib/db';
import { route } from '@/server/http';

export const GET = route('vendas', 'view', async ({ ctx, query }) => {
  const q = query.get('q')?.trim();
  const rows = await prisma.listing.findMany({
    where: { channel: { companyId: ctx.companyId }, ...(query.get('channelId') ? { channelId: query.get('channelId')! } : {}), ...(query.get('status') ? { status: query.get('status')! } : {}), ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { externalId: { contains: q } }] } : {}) },
    include: { channel: { select: { name: true, provider: true } }, product: { select: { sku: true, name: true, price: true, costPrice: true } } },
    orderBy: { title: 'asc' },
    take: 500,
  });
  return { rows };
});
