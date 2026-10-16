import { NextResponse } from 'next/server';
import { storeByDomain } from '@/server/services/store';

/** Usado pelo middleware: domínio próprio → slug da loja */
export async function GET(req: Request) {
  const host = new URL(req.url).searchParams.get('host') || '';
  return NextResponse.json({ slug: host ? await storeByDomain(host) : null });
}
