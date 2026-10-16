import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/server/http';
import { storeCheckout } from '@/server/services/store';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    return NextResponse.json(await storeCheckout((await params).slug, await req.json()));
  } catch (e) {
    return toErrorResponse(e);
  }
}
