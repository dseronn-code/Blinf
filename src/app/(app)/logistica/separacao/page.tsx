'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { ScanBarcode, Printer, RotateCcw, ClipboardList, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, useAction, api, openFile } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader, DataTable } from '@/components/common/page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { CameraScanButton } from '@/components/common/camera-scanner';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fmtDate, num, cn } from '@/lib/utils';

export default function Picking() {
  const { data, isLoading } = useApi<any>('/api/logistics/picking');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const act = useAction();
  const order = data?.orders.find((o: any) => o.id === orderId);
  const scan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r: any = await api('/api/logistics/picking', { method: 'POST', json: { orderId, code } });
      if (r.done) { toast.success('Conferência concluída! Pedido separado — etiqueta pronta para impressão.'); setOrderId(null); }
      else toast.success('Item conferido');
      await qc.invalidateQueries();
    } catch (err) { toast.error((err as Error).message); }
    setCode('');
    ref.current?.focus();
  };
  const printPickList = () => {
    const w = window.open('', '_blank')!;
    w.document.write(`<html><head><title>Lista de separação</title><style>body{font-family:sans-serif;font-size:12px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px}</style></head><body><h2>Lista de separação (picking) — ${new Date().toLocaleString('pt-BR')}</h2><table><tr><th>☐</th><th>Localização</th><th>SKU</th><th>Produto</th><th>Qtd</th><th>Pedidos</th></tr>${data.pickList.map((p: any) => `<tr><td>☐</td><td>${p.location || '-'}</td><td>${p.sku}</td><td>${p.name}</td><td><b>${p.quantity}</b></td><td>${p.orders.join(', ')}</td></tr>`).join('')}</table><script>print()</script></body></html>`);
  };
  return (
    <div>
      <PageHeader title="Separação e embalagem" description="Picking consolidado por localização e packing com conferência por código de barras. Ao concluir, o pedido vai para 'Separado'." actions={<><Button variant="outline" onClick={printPickList} disabled={!data?.pickList.length}><ClipboardList /> Imprimir lista de separação</Button><Button variant="outline" onClick={() => openFile(`/api/logistics/labels?ids=${(data?.orders || []).flatMap((o: any) => o.shipments.map((s: any) => s.id)).join(',')}`)}><Printer /> Etiquetas</Button></>} />
      <Tabs defaultValue="packing">
        <TabsList><TabsTrigger value="packing">Conferência (packing)</TabsTrigger><TabsTrigger value="picking">Lista de separação ({data?.pickList.length ?? 0})</TabsTrigger></TabsList>
        <TabsContent value="packing">
          <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
            <Card className="h-fit"><CardHeader><CardTitle>Pedidos aguardando ({data?.orders.length ?? 0})</CardTitle></CardHeader>
              <div className="max-h-[560px] divide-y overflow-y-auto">
                {isLoading ? <div className="p-4 text-sm">Carregando…</div> : !data?.orders.length ? <div className="p-4 text-sm text-muted-foreground">Nenhum pedido faturado aguardando separação. <Link className="text-primary" href="/vendas?status=ABERTO">Faturar pedidos</Link></div> : data.orders.map((o: any) => {
                  const done = o.items.filter((i: any) => i.productId).reduce((a: number, i: any) => a + i.packedQty, 0);
                  const tot = o.items.filter((i: any) => i.productId).reduce((a: number, i: any) => a + i.quantity, 0);
                  return <button key={o.id} onClick={() => { setOrderId(o.id); setTimeout(() => ref.current?.focus(), 50); }} className={cn('block w-full px-4 py-2 text-left text-sm hover:bg-muted', orderId === o.id && 'bg-accent')}><div className="flex justify-between"><b>#{o.number}</b><span className="text-xs">{num(done)}/{num(tot)} itens</span></div><div className="text-xs text-muted-foreground">{o.customer.name} · {fmtDate(o.date)}</div>{o.shipments[0] && <div className="text-[10px] text-muted-foreground">{o.shipments[0].carrier} {o.shipments[0].service} · {o.shipments[0].trackingCode}</div>}</button>;
                })}
              </div>
            </Card>
            {order ? (
              <Card><CardHeader><CardTitle>Conferindo pedido #{order.number} — {order.customer.name}</CardTitle><div className="flex gap-2">{order.shipments[0] && <Button size="sm" variant="outline" onClick={() => openFile(`/api/logistics/labels?ids=${order.shipments[0].id}`)}><Printer /> Etiqueta</Button>}<Button size="sm" variant="outline" onClick={() => act('POST', '/api/logistics/picking', { orderId, reset: true }, 'Conferência reiniciada')}><RotateCcw /> Reiniciar</Button></div></CardHeader>
                <CardContent className="space-y-3">
                  <form onSubmit={scan} className="flex gap-2"><div className="relative flex-1"><ScanBarcode className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" /><Input ref={ref} autoFocus value={code} onChange={(e) => setCode(e.target.value)} className="h-10 pl-10" placeholder="Bipe o código de barras (EAN) ou digite o SKU" /></div><CameraScanButton continuous className="h-10 px-3" onCode={(c) => { setCode(c); setTimeout(() => ref.current?.form?.requestSubmit(), 80); }} /><Button className="h-10">Conferir</Button></form>
                  <DataTable rows={order.items.filter((i: any) => i.productId)} rowClassName={(i: any) => (i.packedQty >= i.quantity ? 'bg-green-50' : '')} columns={[
                    { key: 'sku', header: 'SKU', cell: (i: any) => <button className="font-mono text-xs hover:text-primary" title="Clique para conferir" onClick={() => { setCode(i.sku); }}>{i.sku}</button> },
                    { key: 'gtin', header: 'EAN', cell: (i: any) => <span className="font-mono text-[10px]">{i.gtin}</span> },
                    { key: 'description', header: 'Produto' }, { key: 'quantity', header: 'Pedido', align: 'right', cell: (i: any) => num(i.quantity) },
                    { key: 'packedQty', header: 'Conferido', align: 'right', cell: (i: any) => <b>{num(i.packedQty)}</b> },
                    { key: 's', header: '', cell: (i: any) => (i.packedQty >= i.quantity ? <Badge tone="green"><PackageCheck className="mr-1 h-3 w-3" /> OK</Badge> : <Badge tone="orange">faltam {num(i.quantity - i.packedQty)}</Badge>) },
                  ]} />
                  <p className="text-xs text-muted-foreground">Dica: clique no SKU para preenchê-lo no campo (equivale à leitura do código de barras).</p>
                </CardContent>
              </Card>
            ) : <Card className="flex items-center justify-center p-10 text-sm text-muted-foreground">Selecione um pedido para conferir</Card>}
          </div>
        </TabsContent>
        <TabsContent value="picking">
          <DataTable rows={data?.pickList.map((p: any) => ({ ...p, id: p.productId }))} columns={[{ key: 'location', header: 'Localização', cell: (r: any) => r.location || '—' }, { key: 'sku', header: 'SKU' }, { key: 'name', header: 'Produto' }, { key: 'quantity', header: 'Quantidade total', align: 'right', cell: (r: any) => <b>{num(r.quantity)}</b> }, { key: 'orders', header: 'Pedidos', cell: (r: any) => r.orders.map((n: number) => `#${n}`).join(', ') }]} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
