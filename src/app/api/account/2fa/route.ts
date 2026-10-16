import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { generateSecret, otpauthUrl, verifyTotp } from '@/lib/totp';

/** Autenticação em dois fatores do próprio usuário (TOTP) */
export const GET = route(null, 'view', async ({ ctx }) => {
  const u = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { twoFactorEnabled: true } });
  return { enabled: !!u?.twoFactorEnabled };
});

export const POST = route(null, 'view', async ({ ctx, body }) => {
  const u = (await prisma.user.findUnique({ where: { id: ctx.userId } }))!;
  switch (body?.action) {
    case 'setup': {
      if (u.twoFactorEnabled) fail(400, '2FA já está ativo');
      const secret = generateSecret();
      await prisma.user.update({ where: { id: u.id }, data: { twoFactorSecret: secret } });
      return { secret, otpauth: otpauthUrl(secret, u.email) };
    }
    case 'enable':
      if (!u.twoFactorSecret) fail(400, 'Gere o QR Code primeiro');
      if (!verifyTotp(u.twoFactorSecret!, body.code)) fail(400, 'Código inválido — confira o horário do celular');
      await prisma.user.update({ where: { id: u.id }, data: { twoFactorEnabled: true } });
      return { ok: true, enabled: true };
    case 'disable':
      if (!u.twoFactorEnabled) return { ok: true, enabled: false };
      if (!verifyTotp(u.twoFactorSecret!, body.code)) fail(400, 'Código inválido');
      await prisma.user.update({ where: { id: u.id }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
      return { ok: true, enabled: false };
    case 'reset-user': {
      // Administrador remove o 2FA de um usuário que perdeu o celular
      if (!ctx.isAdmin) fail(403, 'Somente administradores');
      const r = await prisma.user.updateMany({ where: { id: body.userId, organizationId: ctx.orgId }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
      if (!r.count) fail(404, 'Usuário não encontrado');
      return { ok: true };
    }
    default:
      fail(400, 'Ação inválida');
  }
});
