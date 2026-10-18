import { enterDemo } from '@/lib/demo';
import { storeIsDemo } from '@/server/demoContext';
import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/server/http';
import { storeCheckout } from '@/server/services/store';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    enterDemo(await storeIsDemo((await params).slug));
    return NextResponse.json(await storeCheckout((await params).slug, await req.json()));
  } catch (e) {
    return toErrorResponse(e);
  }
}
