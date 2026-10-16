'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CheckCircle2, QrCode, FileText, CreditCard, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { money, fmtDate, fmtDoc, cn } from '@/lib/utils';

/** Página pública de pagamento (link / Pix) — simula o checkout do PSP */
export default function PayPage() {
  const { slug } = useParams<{ slug: string }>();
  const [link, setLink] = useState<any>(null);
  const [method, setMethod] = useState('PIX');
  const [paying, setPaying] = useState(false);
  const load = () => api(`/api/public/pay/${slug}`).then(setLink).catch((e) => setLink({ error: e.message }));
  useEffect(() => { load(); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const methods = link.methods === 'TODOS' ? ['PIX', 'BOLETO', 'CARTAO'] : [link.methods];
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
        </CardContent>
      </Card>
    </div>
  );
}
