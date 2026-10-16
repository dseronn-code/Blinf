import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/server/http';
import { storeCatalog } from '@/server/services/store';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    return NextResponse.json(await storeCatalog((await params).slug));
  } catch (e) {
    return toErrorResponse(e);
  }
}
