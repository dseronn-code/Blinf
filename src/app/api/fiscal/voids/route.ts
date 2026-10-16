import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { voidNumbers } from '@/server/services/fiscal';

/** Inutilização de numeração de NF-e/NFC-e */
export const GET = route('fiscal', 'view', async ({ ctx }) => prisma.numberVoid.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: 'desc' } }));

export const POST = route('fiscal', 'edit', async ({ ctx, body }) =>
  voidNumbers(ctx.companyId, { model: body?.model || 'NFE', series: Number(body?.series) || 1, fromNumber: Number(body?.fromNumber), toNumber: Number(body?.toNumber || body?.fromNumber), reason: body?.reason || '' }),
);
