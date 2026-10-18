import { enterDemo } from '@/lib/demo';
import { storeIsDemo } from '@/server/demoContext';
import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/server/http';
import { storeFreight } from '@/server/services/store';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    enterDemo(await storeIsDemo((await params).slug));
    const body = await req.json();
    return NextResponse.json({ options: await storeFreight((await params).slug, body.zip, body.items || [], body.uf) });
  } catch (e) {
    return toErrorResponse(e);
  }
}
