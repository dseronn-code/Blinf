import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { askAssistant } from '@/server/services/assistant';

export const GET = route('relatorios', 'view', async ({ ctx }) => ({ rows: await prisma.aiMessage.findMany({ where: { companyId: ctx.companyId, userId: ctx.userId }, orderBy: { createdAt: 'asc' }, take: 100 }), engine: process.env.ANTHROPIC_API_KEY ? 'claude' : 'local' }));

export const POST = route('relatorios', 'view', async ({ ctx, body }) => {
  const message = String(body?.message || '').trim();
  if (!message) fail(400, 'Digite uma pergunta');
  const history = (await prisma.aiMessage.findMany({ where: { companyId: ctx.companyId, userId: ctx.userId }, orderBy: { createdAt: 'desc' }, take: 10 })).reverse().map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  const r = await askAssistant(ctx, message, history);
  await prisma.aiMessage.createMany({ data: [{ companyId: ctx.companyId, userId: ctx.userId, role: 'user', content: message }, { companyId: ctx.companyId, userId: ctx.userId, role: 'assistant', content: r.answer }] });
  return r;
});

export const DELETE = route('relatorios', 'view', async ({ ctx }) => {
  await prisma.aiMessage.deleteMany({ where: { companyId: ctx.companyId, userId: ctx.userId } });
  return { ok: true };
});
