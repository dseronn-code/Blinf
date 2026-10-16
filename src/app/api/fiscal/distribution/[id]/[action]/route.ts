import { prisma } from '@/lib/db';
import { route, fileResponse } from '@/server/http';
import { fail } from '@/server/errors';
import { manifest, importDistribution } from '@/server/services/fiscalExtras';

export const POST = route('fiscal', 'edit', async ({ ctx, params, body }) => {
  if (params.action === 'manifest') return manifest(ctx, params.id, body?.status, body?.justification);
  if (params.action === 'import') return importDistribution(ctx, params.id);
  fail(404, 'Ação inválida');
});

export const GET = route('fiscal', 'view', async ({ ctx, params }) => {
  if (params.action !== 'xml') fail(404, 'Ação inválida');
  const d = await prisma.nfeDistribution.findFirst({ where: { id: params.id, companyId: ctx.companyId } });
  if (!d) fail(404, 'Documento não encontrado');
  if (d!.status === 'SEM_MANIFESTACAO') fail(400, 'Manifeste ciência da operação para baixar o XML completo');
  return fileResponse(d!.xml, 'application/xml', `${d!.accessKey}.xml`, false);
});
