import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { route } from '@/server/http';

export const GET = route('integracoes', 'view', async ({ ctx }) => ({ rows: await prisma.apiKey.findMany({ where: { companyId: ctx.companyId }, select: { id: true, name: true, prefix: true, active: true, lastUsedAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } }) }));

/** Gera nova chave — exibida uma única vez (armazenamos apenas o hash SHA-256) */
export const POST = route('integracoes', 'edit', async ({ ctx, body }) => {
  const key = `gp_live_${crypto.randomBytes(20).toString('hex')}`;
  const row = await prisma.apiKey.create({ data: { companyId: ctx.companyId, name: body.name || 'Integração', prefix: key.slice(0, 12), keyHash: crypto.createHash('sha256').update(key).digest('hex') } });
  return { ...row, keyHash: undefined, key };
});
