import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/** Redefine a senha a partir do token enviado por e-mail (também usado no convite de usuário) */
export async function POST(req: Request) {
  const { token, password } = await req.json().catch(() => ({}));
  if (!token) return NextResponse.json({ error: 'Token ausente' }, { status: 400 });
  if (!password || String(password).length < 6) return NextResponse.json({ error: 'A senha deve ter ao menos 6 caracteres' }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { resetToken: String(token) } });
  if (!user || !user.resetExpires || user.resetExpires < new Date()) return NextResponse.json({ error: 'Link inválido ou expirado. Solicite um novo.' }, { status: 400 });
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(String(password), 10), resetToken: null, resetExpires: null, active: true } });
  return NextResponse.json({ ok: true, email: user.email });
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') || '';
  const user = token ? await prisma.user.findUnique({ where: { resetToken: token }, select: { name: true, email: true, resetExpires: true } }) : null;
  if (!user || !user.resetExpires || user.resetExpires < new Date()) return NextResponse.json({ valid: false });
  return NextResponse.json({ valid: true, name: user.name, email: user.email });
}
