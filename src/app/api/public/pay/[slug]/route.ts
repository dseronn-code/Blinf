import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { emit } from '@/server/events';
import { toErrorResponse, HttpError } from '@/server/http';
import { defaultBankAccount } from '@/server/services/finance';
import { paymentAccount, gatewayFor } from '@/server/services/payments';
import { isDemoMode, requireRealOrDemo } from '@/lib/demo';

type P = { params: Promise<{ slug: string }> };

// Página pública de pagamento (link / Pix) — sem autenticação
export async function GET(_req: Request, { params }: P) {
  const { slug } = await params;
  const link = await prisma.paymentLink.findUnique({ where: { slug } });
  if (!link) return NextResponse.json({ error: 'Link não encontrado' }, { status: 404 });
  const company = await prisma.company.findUnique({ where: { id: link.companyId }, select: { name: true, tradeName: true, cnpj: true, logoColor: true } });
  // Cobrança real (Asaas/Mercado Pago) vinculada ao título, quando houver provedor conectado
  const acc = await paymentAccount(link.companyId);
  const e = link.entryId ? await prisma.financialEntry.findUnique({ where: { id: link.entryId } }) : null;
  const charge = e?.provider ? { provider: e.provider, providerName: gatewayFor(e.provider)?.name || e.provider, paymentUrl: e.paymentUrl, boletoLine: e.boletoLine, pixPayload: e.pixPayload, card: e.provider === 'MERCADO_PAGO' ? !!e.providerRef?.startsWith('pref-') : !!e.paymentUrl && !!e.boletoLine === !!e.pixPayload } : null;
  return NextResponse.json({ ...link, ...(charge?.pixPayload ? { pixPayload: charge.pixPayload } : {}), company, gateway: acc ? gatewayFor(acc.provider)?.name || acc.provider : null, charge, entryPaid: e?.status === 'PAGO', demo: isDemoMode() });
}

/** Simula a confirmação do pagamento pelo PSP (Pix/boleto/cartão) — só no modo demonstração, sem provedor real conectado */
export async function POST(req: Request, { params }: P) {
  try {
    requireRealOrDemo('Simulação de pagamento', 'O pagamento é confirmado pelo provedor de cobrança (Asaas/Mercado Pago) ou, no Pix estático, registrado pela empresa ao conferir o extrato.');
    const { slug } = await params;
    const body = await req.json().catch(() => ({}));
    const link = await prisma.paymentLink.findUnique({ where: { slug } });
    if (!link) throw new HttpError(404, 'Link não encontrado');
    if (link.status !== 'ATIVO') throw new HttpError(400, `Link ${link.status.toLowerCase()}`);
    // Com provedor real conectado, só o provedor confirma o pagamento (webhook)
    if (await paymentAccount(link.companyId)) throw new HttpError(400, 'O pagamento é confirmado automaticamente pelo provedor de cobrança');
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
