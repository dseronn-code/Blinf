import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { emit } from '@/server/events';
import { toErrorResponse, HttpError } from '@/server/http';
import { defaultBankAccount } from '@/server/services/finance';

type P = { params: Promise<{ slug: string }> };

// Página pública de pagamento (link / Pix) — sem autenticação
export async function GET(_req: Request, { params }: P) {
  const { slug } = await params;
  const link = await prisma.paymentLink.findUnique({ where: { slug } });
  if (!link) return NextResponse.json({ error: 'Link não encontrado' }, { status: 404 });
  const company = await prisma.company.findUnique({ where: { id: link.companyId }, select: { name: true, tradeName: true, cnpj: true, logoColor: true } });
  return NextResponse.json({ ...link, company });
}

/** Simula a confirmação do pagamento pelo PSP (Pix/boleto/cartão) */
export async function POST(req: Request, { params }: P) {
  try {
    const { slug } = await params;
    const body = await req.json().catch(() => ({}));
    const link = await prisma.paymentLink.findUnique({ where: { slug } });
    if (!link) throw new HttpError(404, 'Link não encontrado');
    if (link.status !== 'ATIVO') throw new HttpError(400, `Link ${link.status.toLowerCase()}`);
    const method = ['PIX', 'BOLETO', 'CARTAO'].includes(body.method) ? body.method : 'PIX';
    await prisma.paymentLink.update({ where: { id: link.id }, data: { status: 'PAGO', paidAt: new Date(), paidMethod: method } });
    const company = await prisma.company.findUnique({ where: { id: link.companyId } });
    if (!link.entryId) {
      const bank = await defaultBankAccount(prisma, link.companyId, 'CONTA_DIGITAL');
      if (bank) await prisma.bankTransaction.create({ data: { companyId: link.companyId, bankAccountId: bank.id, date: new Date(), description: `${method} recebido - ${link.description}`, amount: link.amount, source: 'PIX', reconciled: true } });
    }
    await emit('payment_link.paid', { companyId: link.companyId, orgId: company!.organizationId, linkId: link.id, userName: 'Gateway de pagamento' });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
