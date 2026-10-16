import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/server/http';
import { storeBySlug } from '@/server/services/store';
import { evaluateCoupon } from '@/server/services/operations';

/** Valida um cupom no carrinho (o desconto é recalculado no checkout) */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { company } = await storeBySlug((await params).slug);
    const body = await req.json().catch(() => ({}));
    const r = await evaluateCoupon(company.id, body.code, Number(body.subtotal) || 0);
    if (!r) return NextResponse.json({ error: 'Informe o cupom' }, { status: 400 });
    return NextResponse.json({ code: r.coupon.code, type: r.coupon.type, discount: r.discount, freeShipping: r.freeShipping });
  } catch (e) {
    return toErrorResponse(e);
  }
}
