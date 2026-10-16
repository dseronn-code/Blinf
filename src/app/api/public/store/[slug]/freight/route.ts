import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/server/http';
import { storeFreight } from '@/server/services/store';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const body = await req.json();
    return NextResponse.json({ options: await storeFreight((await params).slug, body.zip, body.items || []) });
  } catch (e) {
    return toErrorResponse(e);
  }
}
