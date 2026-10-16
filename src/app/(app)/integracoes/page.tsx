'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Radio, Plug, KeyRound, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, useAction, api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader, Chips, Filters, SimBanner, Field } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Switch } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { money, fmtDateTime } from '@/lib/utils';

const CATS: Record<string, string> = { '': 'Todos', MARKETPLACE: 'Marketplaces', ECOMMERCE: 'Plataformas de e-commerce', DELIVERY: 'Delivery', SOCIAL: 'Social / catálogo', LOGISTICA: 'Logística', PAGAMENTO: 'Pagamentos', ERP: 'Contabilidade' };

export default function Integrations() {
  const { data } = useApi<any>('/api/integrations');
  const [cat, setCat] = useState('');
  const [connect, setConnect] = useState<any>(null);
  const [step, setStep] = useState(0);
  const [live, setLive] = useState(false);
  const act = useAction();
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    try { setLive(localStorage.getItem('gp_live_sim') === '1'); } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('gp_live_sim', live ? '1' : '0'); } catch {}
    if (timer.current) clearInterval(timer.current);
    if (live) {
      timer.current = setInterval(async () => {
        const r: any = await api('/api/integrations/tick', { method: 'POST', json: {} }).catch(() => null);
        if (r?.created?.length) { toast.success(`🛒 ${r.created.length} novo(s) pedido(s) importado(s) dos marketplaces`); qc.invalidateQueries(); }
      }, 20000);
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [live, qc]);
  const list = (data?.connectors || []).filter((c: any) => !cat || c.category === cat);
  const connected = (data?.connectors || []).filter((c: any) => c.channel?.status === 'CONECTADO');
  const realCount = connected.filter((c: any) => c.channel.real).length;
  const doConnect = async () => {
    setStep(1);
    await new Promise((r) => setTimeout(r, 1200));
    const r = await act('POST', '/api/integrations', { provider: connect.provider, storeName: connect.storeName }, `${connect.name} conectado`);
    setStep(0);
    if (r) setConnect(null);
  };
  return (
    <div>
      <PageHeader title="Central de integrações" description={`${data?.connectors.length ?? 0} conectores · ${connected.length} conectados. Pedidos importados automaticamente, estoque e preços sincronizados em tempo real.`}
        actions={<Card className="flex items-center gap-3 px-3 py-2"><Radio className={live ? 'h-4 w-4 animate-pulse text-green-600' : 'h-4 w-4 text-muted-foreground'} /><div className="text-xs"><div className="font-semibold">Simulação em tempo real</div><div className="text-muted-foreground">novos pedidos a cada ~20s</div></div><Switch checked={live} onChange={setLive} /></Card>} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-900">
        <span><CheckCircle2 className="mr-1 inline h-4 w-4" /><b>Contas reais:</b> Mercado Livre, Shopee, Nuvemshop, Shopify e WooCommerce conectam com a sua conta em Contas e credenciais — os pedidos entram sozinhos e estoque/preço são enviados a cada alteração. {realCount ? `${realCount} canal(is) com conta real.` : ''}</span>
        <Button asChild size="sm" variant="outline"><Link href="/integracoes/contas"><KeyRound /> Contas e credenciais</Link></Button>
      </div>
      <SimBanner>canais sem conta real usam OAuth fictício; nenhum dado é enviado aos marketplaces. Pedidos, compradores e IDs são gerados de forma realista para demonstrar os fluxos.</SimBanner>
      <Filters><Chips value={cat} onChange={setCat} options={Object.entries(CATS).map(([value, label]) => ({ value, label }))} /></Filters>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {list.map((c: any) => (
          <Card key={c.provider} className="flex flex-col p-4">
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-black" style={{ background: c.color, color: ['#ffe600', '#ffcc00', '#ff9900'].includes(c.color) ? '#111' : '#fff' }}>{c.name.slice(0, 2).toUpperCase()}</div>
              <div className="flex-1"><div className="font-semibold">{c.name}</div><div className="text-[11px] text-muted-foreground">{CATS[c.category]}</div></div>
              {c.channel && <StatusBadge status={c.channel.status} />}
            </div>
            {c.channel?.status === 'CONECTADO' && <div className="mb-2">{c.channel.real ? <Badge tone="green">Conta real conectada{c.account?.accountName ? ` · ${c.account.accountName}` : ''}</Badge> : <Badge tone="yellow">Simulado</Badge>}</div>}
            {c.supportsReal && c.account?.status === 'ERRO' && <div className="mb-2 text-[11px] text-red-600">Conta real com erro: {c.account.lastError || 'reconecte'}</div>}
            <p className="mb-3 flex-1 text-xs text-muted-foreground">{c.description}</p>
            {c.channel?.status === 'CONECTADO' ? (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-1 text-center text-[11px]"><div className="rounded bg-muted p-1"><b>{c.channel._count.listings}</b><br />anúncios</div><div className="rounded bg-muted p-1"><b>{c.channel.orders}</b><br />pedidos</div><div className="rounded bg-muted p-1"><b>{money(c.channel.revenue).replace('R$', '')}</b><br />vendas</div></div>
                <div className="text-[10px] text-muted-foreground">Sync: {fmtDateTime(c.channel.lastSyncAt)}</div>
                <Button asChild size="sm" variant="outline" className="w-full"><Link href={`/integracoes/${c.channel.id}`}>Gerenciar</Link></Button>
              </div>
            ) : c.supportsReal ? (
              <div className="space-y-1">
                <Button asChild size="sm" className="w-full"><Link href="/integracoes/contas"><KeyRound /> Conectar conta real</Link></Button>
                <Button size="sm" variant="ghost" className="w-full" onClick={() => setConnect({ ...c, storeName: '' })}><Plug /> Simular conexão</Button>
              </div>
            ) : <Button size="sm" className="w-full" onClick={() => setConnect({ ...c, storeName: '' })}><Plug /> Conectar</Button>}
          </Card>
        ))}
      </div>
      <Dialog open={!!connect} onOpenChange={(o) => !o && setConnect(null)} title={`Conectar ${connect?.name}`} description="Fluxo de autorização OAuth simulado" size="sm" footer={<Button disabled={step > 0} onClick={doConnect}>{step ? 'Autorizando…' : 'Autorizar acesso'}</Button>}>
        {connect && <div className="space-y-3 text-sm">
          <p>O GestãoPro solicitará permissão para: ler pedidos, atualizar estoque e preços, publicar anúncios e consultar envios.</p>
          <Field label="Nome da loja / conta no canal"><Input value={connect.storeName} onChange={(e) => setConnect({ ...connect, storeName: e.target.value })} placeholder={`Minha loja no ${connect.name}`} /></Field>
          <p className="text-xs text-muted-foreground">Tarifa padrão do canal: {connect.feePercent}% (editável depois, usada no cálculo de lucratividade).</p>
        </div>}
      </Dialog>
    </div>
  );
}
