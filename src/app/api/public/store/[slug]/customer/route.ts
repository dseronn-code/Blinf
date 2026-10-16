import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { toErrorResponse } from '@/server/http';
import { rateLimit } from '@/lib/rateLimit';
import { signCustomerToken, verifyCustomerToken, storeCustomerLogin, storeCustomerOrders } from '@/server/services/store';

type P = { params: Promise<{ slug: string }> };
const cookieName = (slug: string) => `gp_cli_${slug}`;

/** Área do cliente da loja: GET pedidos | POST login (e-mail + CPF/CNPJ) | DELETE sair */
export async function GET(_req: Request, { params }: P) {
  try {
    const { slug } = await params;
    const id = verifyCustomerToken(slug, (await cookies()).get(cookieName(slug))?.value);
    if (!id) return NextResponse.json({ logged: false });
    return NextResponse.json({ logged: true, ...(await storeCustomerOrders(slug, id)) });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function POST(req: Request, { params }: P) {
  try {
    const { slug } = await params;
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'local';
    if (!rateLimit(`store-login:${ip}`, 10, 10 * 60_000).ok) return NextResponse.json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, { status: 429 });
    const body = await req.json().catch(() => ({}));
    const contact = await storeCustomerLogin(slug, body.email, body.document);
    const res = NextResponse.json({ logged: true, ...(await storeCustomerOrders(slug, contact.id)) });
    res.cookies.set(cookieName(slug), signCustomerToken(slug, contact.id), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 86400, secure: process.env.NODE_ENV === 'production' && (process.env.NEXTAUTH_URL || '').startsWith('https') });
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: P) {
  const { slug } = await params;
  const res = NextResponse.json({ logged: false });
  res.cookies.delete(cookieName(slug));
  return res;
}
