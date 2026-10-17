import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from './db';
import { verifyTotp } from './totp';
import { rateLimit } from './rateLimit';

/**
 * Autenticação por e-mail/senha (NextAuth + JWT), com segundo fator (TOTP)
 * opcional por usuário e limite de tentativas por e-mail.
 */
export const SESSION_COOKIE = 'gp.session-token';

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 7 },
  secret: process.env.NEXTAUTH_SECRET || 'gestaopro-dev-secret',
  pages: { signIn: '/login' },
  // Nome de cookie fixo: a sessão funciona igual em http://localhost, no IP da rede e em
  // endereços HTTPS (domínio próprio ou túnel para o celular). AUTH_TRUST_HOST=true faz o
  // NextAuth usar o endereço pelo qual o sistema foi acessado.
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE,
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: (process.env.NEXTAUTH_URL || '').startsWith('https://') },
    },
  },
  providers: [
    CredentialsProvider({
      name: 'E-mail e senha',
      credentials: { email: { label: 'E-mail', type: 'email' }, password: { label: 'Senha', type: 'password' }, otp: { label: 'Código 2FA', type: 'text' } },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const email = credentials.email.toLowerCase().trim();
        if (!rateLimit(`login:${email}`, 10, 15 * 60_000).ok) throw new Error('Muitas tentativas. Aguarde 15 minutos.');
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active) return null;
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;
        if (user.twoFactorEnabled && user.twoFactorSecret) {
          if (!credentials.otp) throw new Error('2FA_REQUIRED');
          if (!verifyTotp(user.twoFactorSecret, credentials.otp)) throw new Error('Código de verificação inválido');
        }
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.uid = (user as { id: string }).id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) (session.user as { id?: string }).id = token.uid as string;
      return session;
    },
  },
};
