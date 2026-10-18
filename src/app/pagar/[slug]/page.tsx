'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CheckCircle2, QrCode, FileText, CreditCard, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { money, fmtDate, fmtDoc, cn } from '@/lib/utils';

/** Página pública de pagamento (link / Pix) — cobrança real do Asaas/Mercado Pago quando conectado; senão Pix estático da empresa (produção) ou checkout simulado (modo demonstração) */
export default function PayPage() {
  const { slug } = useParams<{ slug: string }>();
  const [link, setLink] = useState<any>(null);
  const [method, setMethod] = useState('PIX');
  const [paying, setPaying] = useState(false);
  const [real, setReal] = useState<Record<string, any>>({});
  const [loadingCharge, setLoadingCharge] = useState(false);
  const load = () => api<any>(`/api/public/pay/${slug}`).then((l) => { setLink(l); if (l?.methods && l.methods !== 'TODOS') setMethod(l.methods); }).catch((e) => setLink({ error: e.message }));
  useEffect(() => { load(); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
  const gateway: string | null = link?.gateway || null;
  const active = link && !link.error && link.status === 'ATIVO';
  // Provedor real: a confirmação chega pelo webhook — atualiza a página periodicamente
  useEffect(() => {
    if (!gateway || !active) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [gateway, active]); // eslint-disable-line react-hooks/exhaustive-deps
  // Dados reais do meio escolhido (Pix/boleto do provedor); gera a cobrança se ainda não existir
  const charge = link?.charge || {};
  const realPix = real.PIX?.pixPayload || charge.pixPayload;
  const realLine = real.BOLETO?.boletoLine || charge.boletoLine;
  const realBoletoUrl = real.BOLETO?.paymentUrl || (charge.boletoLine ? charge.paymentUrl : null);
  const requestCharge = async (m: string) => {
    setLoadingCharge(true);
    try {
      const r: any = await api(`/api/public/pay/${slug}/charge`, { method: 'POST', json: { method: m } });
      setReal((x) => ({ ...x, [m]: r }));
      return r;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingCharge(false);
    }
  };
  useEffect(() => {
    if (!gateway || !active || real[method]) return;
    if ((method === 'PIX' && !realPix) || (method === 'BOLETO' && !realLine)) requestCharge(method);
  }, [gateway, active, method]); // eslint-disable-line react-hooks/exhaustive-deps
  const payCard = async () => {
    const url = charge.card && charge.paymentUrl ? charge.paymentUrl : (await requestCharge('CARTAO'))?.redirectUrl;
    if (url) window.location.href = url;
  };
  const pay = async () => {
    setPaying(true);
    try {
      await api(`/api/public/pay/${slug}`, { method: 'POST', json: { method } });
      toast.success('Pagamento confirmado!');
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setPaying(false);
  };
  if (!link) return null;
  if (link.error) return <div className="flex min-h-screen items-center justify-center">{link.error}</div>;
  const qr = link.pixPayload ? `/api/public/qr?data=${encodeURIComponent(link.pixPayload)}` : null;
  const realQr = realPix ? `/api/public/qr?data=${encodeURIComponent(realPix)}` : null;
  const demo = !!link.demo;
  // Produção sem provedor: só existe o Pix estático para a chave da empresa (sem boleto/cartão simulados)
  const methods = !gateway && !demo ? (link.pixPayload ? ['PIX'] : []) : link.methods === 'TODOS' ? ['PIX', 'BOLETO', 'CARTAO'] : [link.methods];
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <div className="rounded-t-lg p-5 text-white" style={{ background: link.company?.logoColor || '#16a34a' }}>
          <div className="text-sm opacity-80">{link.company?.tradeName || link.company?.name}</div>
          <div className="text-xs opacity-70">CNPJ {fmtDoc(link.company?.cnpj)}</div>
          <div className="mt-3 text-3xl font-bold">{money(link.amount)}</div>
          <div className="text-sm opacity-90">{link.description}</div>
        </div>
        <CardContent className="space-y-4">
          {link.status === 'PAGO' ? (
            <div className="py-6 text-center"><CheckCircle2 className="mx-auto mb-2 h-12 w-12 text-green-600" /><div className="text-lg font-bold">Pagamento confirmado</div><div className="text-sm text-muted-foreground">via {link.paidMethod} em {fmtDate(link.paidAt)}. A conta foi baixada automaticamente no ERP.</div></div>
          ) : link.status !== 'ATIVO' ? <div className="py-6 text-center text-muted-foreground">Link {link.status.toLowerCase()}</div> : (
            <>
              <div className="grid grid-cols-3 gap-2">
                {methods.map((m: string) => {
                  const Icon = m === 'PIX' ? QrCode : m === 'BOLETO' ? FileText : CreditCard;
                  return <button key={m} onClick={() => setMethod(m)} className={cn('flex flex-col items-center gap-1 rounded-md border py-3 text-xs', method === m && 'border-primary bg-accent')}><Icon className="h-5 w-5" />{m === 'CARTAO' ? 'Cartão' : m === 'PIX' ? 'Pix' : 'Boleto'}</button>;
                })}
              </div>
              {gateway ? (
                <>
                  {method === 'PIX' && (realPix ? (
                    <div className="space-y-2 text-center">
                      {realQr && <img src={realQr} alt="QR Code Pix" className="mx-auto h-48 w-48 rounded border" />}
                      <button className="flex w-full items-center gap-2 rounded border bg-muted/40 p-2 text-left font-mono text-[10px] break-all" onClick={() => { navigator.clipboard.writeText(realPix); toast.success('Pix copia e cola copiado'); }}><Copy className="h-4 w-4 shrink-0" />{realPix}</button>
                      <p className="text-xs text-muted-foreground">Pague pelo app do seu banco. A confirmação aparece aqui automaticamente.</p>
                    </div>
                  ) : <p className="py-4 text-center text-sm text-muted-foreground">{loadingCharge ? 'Gerando QR Code Pix…' : 'Pix indisponível no momento.'}</p>)}
                  {method === 'BOLETO' && (realLine ? (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">Linha digitável</div>
                      <button className="flex w-full items-center gap-2 rounded border bg-muted/40 p-2 text-left font-mono text-[11px] break-all" onClick={() => { navigator.clipboard.writeText(realLine); toast.success('Linha digitável copiada'); }}><Copy className="h-4 w-4 shrink-0" />{realLine}</button>
                      {realBoletoUrl && <Button asChild variant="outline" className="w-full"><a href={realBoletoUrl} target="_blank" rel="noreferrer"><FileText className="mr-1 h-4 w-4" /> Abrir boleto</a></Button>}
                      <p className="text-xs text-muted-foreground">A compensação do boleto leva até 1 dia útil; a baixa é automática.</p>
                    </div>
                  ) : <p className="py-4 text-center text-sm text-muted-foreground">{loadingCharge ? 'Gerando boleto…' : 'Boleto indisponível no momento.'}</p>)}
                  {method === 'CARTAO' && <Button className="h-11 w-full" disabled={loadingCharge} onClick={payCard}><CreditCard className="mr-1 h-4 w-4" />{loadingCharge ? 'Aguarde…' : `Pagar com cartão (${gateway})`}</Button>}
                  <p className="text-center text-[11px] text-muted-foreground">Pagamento processado com segurança por {gateway}.{link.expiresAt && ` Vence em ${fmtDate(link.expiresAt)}.`}</p>
                </>
              ) : !demo ? (
                link.pixPayload ? (
                  <div className="space-y-2 text-center">
                    {qr && <img src={qr} alt="QR Code Pix" className="mx-auto h-48 w-48 rounded border" />}
                    <button className="flex w-full items-center gap-2 rounded border bg-muted/40 p-2 text-left font-mono text-[10px] break-all" onClick={() => { navigator.clipboard.writeText(link.pixPayload); toast.success('Pix copia e cola copiado'); }}><Copy className="h-4 w-4 shrink-0" />{link.pixPayload}</button>
                    <p className="text-xs text-muted-foreground">Pague pelo app do seu banco. O valor vai direto para a conta de {link.company?.tradeName || link.company?.name}, que confirmará o recebimento.{link.expiresAt && ` Vence em ${fmtDate(link.expiresAt)}.`}</p>
                  </div>
                ) : <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma forma de pagamento online disponível para este link. Entre em contato com {link.company?.tradeName || link.company?.name}.</p>
              ) : (
                <>
                {method === 'PIX' && link.pixPayload && (
                  <div className="space-y-2 text-center">
                    {qr && <img src={qr} alt="QR Code Pix" className="mx-auto h-48 w-48 rounded border" />}
                    <button className="flex w-full items-center gap-2 rounded border bg-muted/40 p-2 text-left font-mono text-[10px] break-all" onClick={() => { navigator.clipboard.writeText(link.pixPayload); toast.success('Pix copia e cola copiado'); }}><Copy className="h-4 w-4 shrink-0" />{link.pixPayload}</button>
                  </div>
                )}
                {method === 'CARTAO' && <div className="space-y-2"><input className="h-9 w-full rounded border px-3 text-sm" placeholder="4111 1111 1111 1111" defaultValue="4111 1111 1111 1111" /><div className="flex gap-2"><input className="h-9 w-full rounded border px-3 text-sm" defaultValue="12/30" /><input className="h-9 w-full rounded border px-3 text-sm" defaultValue="123" /></div></div>}
                {method === 'BOLETO' && <p className="text-sm text-muted-foreground">O boleto será compensado em até 1 dia útil (simulado: compensação imediata).</p>}
                <Button className="h-11 w-full" disabled={paying} onClick={pay}>{method === 'PIX' ? 'Simular pagamento Pix' : method === 'BOLETO' ? 'Simular compensação do boleto' : 'Pagar com cartão'}</Button>
                <p className="text-center text-[11px] text-muted-foreground">Ambiente de demonstração — nenhum valor real é cobrado.{link.expiresAt && ` Vence em ${fmtDate(link.expiresAt)}.`}</p>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
