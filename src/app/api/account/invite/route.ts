import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { sendTemplate, hasRealEmail } from '@/server/services/messaging';

/** Convida um usuário por e-mail: cria o acesso sem senha e envia link para definir a senha (72 h) */
export const POST = route('configuracoes', 'edit', async ({ ctx, body, req }) => {
  const email = String(body?.email || '').toLowerCase().trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) fail(400, 'E-mail inválido');
  if (!body?.name) fail(400, 'Informe o nome');
  const role = await prisma.role.findFirst({ where: { id: body?.roleId, organizationId: ctx.orgId } });
  if (!role) fail(400, 'Perfil inválido');
  if (await prisma.user.findUnique({ where: { email } })) fail(409, 'Já existe um usuário com este e-mail');
  const token = crypto.randomBytes(24).toString('hex');
  const companyIds: string[] = (Array.isArray(body?.companyIds) && body.companyIds.length ? body.companyIds : [ctx.companyId]).filter((c: string) => ctx.companyIds.includes(c));
  const user = await prisma.user.create({
    data: {
      organizationId: ctx.orgId, name: body.name, email, roleId: role!.id, passwordHash: await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10),
      resetToken: token, resetExpires: new Date(Date.now() + 72 * 3600_000), companies: { create: companyIds.map((companyId) => ({ companyId })) },
    },
  });
  const link = `${process.env.NEXTAUTH_URL || new URL(req.url).origin}/redefinir-senha?token=${token}&convite=1`;
  await sendTemplate(ctx.companyId, 'convite_usuario', { cliente: body.name, perfil: role!.name, link, mensagem: `${ctx.userName} enviou este convite.` }, { to: email, related: `user:${user.id}` });
  return { ok: true, id: user.id, devLink: (await hasRealEmail(ctx.companyId)) ? undefined : link };
});
