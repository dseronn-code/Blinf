import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { WEAK_PASSWORDS } from '@/lib/demo';

/** Troca da própria senha (obrigatória no primeiro acesso com senha padrão) */
export const POST = route(null, 'view', async ({ ctx, body }) => {
  const u = await prisma.user.findUnique({ where: { id: ctx.userId } });
  if (!u || !(await bcrypt.compare(String(body?.current || ''), u.passwordHash))) fail(400, 'Senha atual incorreta');
  const next = String(body?.password || '');
  if (next.length < 8) fail(400, 'A nova senha deve ter pelo menos 8 caracteres');
  if (WEAK_PASSWORDS.includes(next)) fail(400, 'Escolha uma senha menos comum');
  if (await bcrypt.compare(next, u!.passwordHash)) fail(400, 'A nova senha deve ser diferente da atual');
  await prisma.user.update({ where: { id: u!.id }, data: { passwordHash: await bcrypt.hash(next, 10) } });
  return { ok: true };
});
