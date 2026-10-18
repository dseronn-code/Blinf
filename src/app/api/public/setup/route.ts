import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/server/http';
import { rateLimit } from '@/lib/rateLimit';
import { firstSetup } from '@/server/services/setup';

/** Primeiro acesso: cria a empresa e o administrador (só com o banco vazio) */
export async function POST(req: Request) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'local';
    if (!rateLimit(`setup:${ip}`, 10, 10 * 60_000).ok) return NextResponse.json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, { status: 429 });
    return NextResponse.json(await firstSetup(await req.json()));
  } catch (e) {
    return toErrorResponse(e);
  }
}
