import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fetchDistribution } from '@/server/services/fiscalExtras';

/** Manifestação do destinatário: NF-e emitidas contra o CNPJ da empresa (Distribuição DF-e simulada) */
export const GET = route('fiscal', 'view', async ({ ctx }) =>
  prisma.nfeDistribution.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: 'desc' }, take: 300, omit: { xml: true } }),
);

export const POST = route('fiscal', 'edit', async ({ ctx, body }) => {
  const rows = await fetchDistribution(ctx, Math.min(Number(body?.count) || 3, 10));
  return { ok: true, found: rows.length };
});
