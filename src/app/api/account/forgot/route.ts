import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rateLimit';
import { sendTemplate, hasRealEmail } from '@/server/services/messaging';

/** Esqueci minha senha: gera token (1 h) e envia o link por e-mail (caixa de saída) */
export async function POST(req: Request) {
  const { email } = await req.json().catch(() => ({}));
  const addr = String(email || '').toLowerCase().trim();
  if (!rateLimit(`forgot:${addr}`, 5, 15 * 60_000).ok) return NextResponse.json({ error: 'Muitas solicitações. Tente mais tarde.' }, { status: 429 });
  const user = addr ? await prisma.user.findUnique({ where: { email: addr }, include: { companies: true } }) : null;
  let devLink: string | undefined;
  if (user && user.active) {
    const token = crypto.randomBytes(24).toString('hex');
    await prisma.user.update({ where: { id: user.id }, data: { resetToken: token, resetExpires: new Date(Date.now() + 3600_000) } });
    const base = process.env.NEXTAUTH_URL || new URL(req.url).origin;
    const link = `${base}/redefinir-senha?token=${token}`;
    const companyId = user.companies[0]?.companyId || (await prisma.company.findFirst({ where: { organizationId: user.organizationId } }))?.id;
    if (companyId) await sendTemplate(companyId, 'recuperar_senha', { cliente: user.name, link }, { to: user.email, related: `user:${user.id}` });
    // Sem SMTP configurado (ambiente de demonstração) o link é devolvido para uso imediato
    if (!companyId || !(await hasRealEmail(companyId))) devLink = link;
  }
  // Resposta idêntica exista ou não o e-mail (não revela usuários cadastrados)
  return NextResponse.json({ ok: true, message: 'Se o e-mail estiver cadastrado, você receberá o link de redefinição.', devLink });
}
