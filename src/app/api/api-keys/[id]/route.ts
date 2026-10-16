import { prisma } from '@/lib/db';
import { route } from '@/server/http';

export const DELETE = route('integracoes', 'edit', async ({ ctx, params }) => {
  await prisma.apiKey.deleteMany({ where: { id: params.id, companyId: ctx.companyId } });
  return { ok: true };
});
