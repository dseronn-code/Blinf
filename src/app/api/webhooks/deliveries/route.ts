import { prisma } from '@/lib/db';
import { route } from '@/server/http';

export const GET = route('integracoes', 'view', async ({ ctx }) => ({ rows: await prisma.webhookDelivery.findMany({ where: { webhook: { companyId: ctx.companyId } }, include: { webhook: { select: { url: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }) }));
