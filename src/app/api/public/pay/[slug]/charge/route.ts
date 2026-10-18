import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { enterDemo } from '@/lib/demo';
import { orgIsDemo } from '@/server/demoContext';
import { toErrorResponse, HttpError } from '@/server/http';
import { appUrl } from '@/server/integrations/accounts';
import { paymentAccount, createCharge, type ChargeMethod } from '@/server/services/payments';

type P = { params: Promise<{ slug: string }> };

/** Página pública: registra (ou reaproveita) a cobrança real do meio escolhido — Pix, boleto ou cartão */
export async function POST(req: Request, { params }: P) {
  try {
    const { slug } = await params;
    const body = await req.json().catch(() => ({}));
    const link = await prisma.paymentLink.findUnique({ where: { slug } });
    enterDemo(await orgIsDemo(link?.companyId));
    if (!link) throw new HttpError(404, 'Link não encontrado');
    if (link.status !== 'ATIVO') throw new HttpError(400, `Link ${link.status.toLowerCase()}`);
    if (!link.entryId) throw new HttpError(400, 'Link sem conta a receber vinculada');
    if (!(await paymentAccount(link.companyId))) throw new HttpError(400, 'Nenhum provedor de cobrança conectado');
    const method = (['PIX', 'BOLETO', 'CARTAO'].includes(body.method) ? body.method : 'PIX') as ChargeMethod;
    if (link.methods !== 'TODOS' && link.methods !== method) throw new HttpError(400, 'Meio de pagamento não aceito neste link');
    const r = await createCharge(link.companyId, link.entryId, method, { backUrl: `${appUrl(new URL(req.url).origin)}/pagar/${slug}` });
    if (r.entry.pixPayload && r.entry.pixPayload !== link.pixPayload) await prisma.paymentLink.update({ where: { id: link.id }, data: { pixPayload: r.entry.pixPayload } });
    return NextResponse.json({
      provider: r.entry.provider, pixPayload: r.entry.pixPayload, boletoLine: r.entry.boletoLine, paymentUrl: r.entry.paymentUrl,
      redirectUrl: 'redirectUrl' in r ? r.redirectUrl : null, pixImage: 'pixImage' in r ? r.pixImage : null,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
