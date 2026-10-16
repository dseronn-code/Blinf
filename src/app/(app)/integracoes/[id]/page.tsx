'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Download, RefreshCw, Upload, Unplug, Save, Link2, Send, KeyRound, ExternalLink } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, Field, SimBanner } from '@/components/common/page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input, Select, Switch } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { money, num, fmtDateTime, fmtDate } from '@/lib/utils';

export default function ChannelPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: ch } = useApi<any>(`/api/integrations/${id}`);
  const { data: lists } = useApi<any>('/api/r/price-lists');
  const { data: whs } = useApi<any>('/api/r/warehouses');
  const act = useAction();
  const [cfg, setCfg] = useState<any>(null);
  const [count, setCount] = useState(3);
  useEffect(() => { if (ch) setCfg({ syncStock: ch.syncStock, syncPrice: ch.syncPrice, autoImport: ch.autoImport, priceListId: ch.priceListId || '', warehouseId: ch.warehouseId || '', feePercent: ch.feePercent, storeName: ch.storeName }); }, [ch]);
  if (!ch || !cfg) return null;
  const run = (a: string, body: object, msg: string) => act('POST', `/api/integrations/${id}/${a}`, body, msg);
  const real = ch.real?.real;
  return (
    <div>
      <PageHeader title={ch.name} badge={<span className="flex gap-1"><StatusBadge status={ch.status} />{ch.status === 'CONECTADO' && (real ? <Badge tone="green">Conta real conectada</Badge> : <Badge tone="yellow">Simulado</Badge>)}</span>} description={ch.storeName}
        actions={<>
          <Button variant="outline" onClick={() => router.push('/integracoes')}><ArrowLeft /> Voltar</Button>
          {real ? <>
            <Button onClick={() => run('import', {}, 'Pedidos consultados no canal')}><Download /> Importar pedidos agora</Button>
            <Button variant="outline" onClick={() => run('link', {}, 'Anúncios vinculados por SKU')}><Link2 /> Vincular anúncios por SKU</Button>
            <Button variant="outline" onClick={() => run('push', {}, 'Estoque e preço enviados ao canal')}><Send /> Enviar estoque/preço agora</Button>
          </> : <>
            <div className="flex items-center gap-1"><Input type="number" className="w-16" value={count} onChange={(e) => setCount(Number(e.target.value))} /><Button onClick={() => run('import', { count }, 'Pedidos importados (estoque reservado automaticamente)')}><Download /> Importar pedidos</Button></div>
            <Button variant="outline" onClick={() => run('sync-stock', {}, 'Estoque sincronizado')}><RefreshCw /> Estoque</Button>
            <Button variant="outline" onClick={() => run('sync-price', {}, 'Preços sincronizados')}><RefreshCw /> Preços</Button>
            <Button variant="outline" onClick={() => run('publish', {}, 'Produtos publicados')}><Upload /> Publicar</Button>
          </>}
          <Button variant="outline" onClick={() => confirm('Desconectar?') && run('disconnect', {}, 'Canal desconectado')}><Unplug /></Button>
        </>} />
      {real ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-900">
          <span><b>Conta real:</b> {ch.real.accountName || ch.storeName}. Pedidos pagos entram sozinhos (notificações + verificação a cada 10 min){ch.real.lastOrderSyncAt ? ` · última consulta ${fmtDateTime(ch.real.lastOrderSyncAt)}` : ''}; estoque e preço são enviados a cada alteração. Anúncios são criados no painel do canal e vinculados aqui pelo SKU{ch.real.lastListingLinkAt ? ` (último vínculo ${fmtDateTime(ch.real.lastListingLinkAt)})` : ''}.</span>
          <Button asChild size="sm" variant="outline"><Link href="/integracoes/contas"><KeyRound /> Contas e credenciais</Link></Button>
        </div>
      ) : ch.real?.supported ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span>🧪 <b>Simulado:</b> {ch.real.accountStatus === 'ERRO' ? `a conta real está com erro (${ch.real.accountError || 'reconecte'}).` : 'conecte a sua conta para receber pedidos reais e enviar estoque/preço ao canal.'}</span>
          <Button asChild size="sm"><Link href="/integracoes/contas"><KeyRound /> Conectar conta real</Link></Button>
        </div>
      ) : <SimBanner>este canal usa a simulação: pedidos e anúncios são gerados localmente.</SimBanner>}
      <Tabs defaultValue="config">
        <TabsList><TabsTrigger value="config">Configurações</TabsTrigger><TabsTrigger value="anuncios">Anúncios ({ch.listings.length})</TabsTrigger><TabsTrigger value="pedidos">Pedidos</TabsTrigger><TabsTrigger value="logs">Logs</TabsTrigger></TabsList>
        <TabsContent value="config">
          <Card><CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[['syncStock', 'Sincronizar estoque em tempo real', 'Toda movimentação atualiza o saldo dos anúncios'], ['syncPrice', 'Sincronizar preços', 'Usa a lista de preço do canal'], ['autoImport', 'Importar pedidos automaticamente', real ? 'Verificação periódica de pedidos na conta real' : 'Usado pelo simulador em tempo real']].map(([k, l, h]) => (
              <div key={k} className="flex items-start justify-between gap-3 rounded border p-3"><div><div className="text-sm font-medium">{l}</div><div className="text-xs text-muted-foreground">{h}</div></div><Switch checked={cfg[k]} onChange={(v) => setCfg({ ...cfg, [k]: v })} /></div>
            ))}
            <Field label="Lista de preço do canal"><Select value={cfg.priceListId} onChange={(e) => setCfg({ ...cfg, priceListId: e.target.value })}><option value="">Preço padrão do produto</option>{lists?.rows.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
            <Field label="Depósito para pedidos do canal"><Select value={cfg.warehouseId} onChange={(e) => setCfg({ ...cfg, warehouseId: e.target.value })}><option value="">Padrão</option>{whs?.rows.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
            <Field label="Tarifa / comissão do canal (%)"><Input type="number" step="0.1" value={cfg.feePercent} onChange={(e) => setCfg({ ...cfg, feePercent: e.target.value })} /></Field>
            <Field label="Nome da loja"><Input value={cfg.storeName || ''} onChange={(e) => setCfg({ ...cfg, storeName: e.target.value })} /></Field>
            <div className="md:col-span-3"><Button onClick={() => act('PUT', `/api/integrations/${id}`, cfg, 'Configurações salvas')}><Save /> Salvar configurações</Button></div>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="anuncios">
          <DataTable rows={ch.listings} columns={[{ key: 'externalId', header: 'ID', cell: (r: any) => <span className="font-mono text-xs">{r.externalId}</span> }, { key: 'title', header: 'Título', cell: (r: any) => <div><div>{r.title}</div><div className="text-xs text-muted-foreground">SKU {r.product.sku}{r.permalink && !r.permalink.startsWith('https://simulado.') && <> · <a href={r.permalink} target="_blank" rel="noreferrer" className="text-primary">ver no canal <ExternalLink className="inline h-3 w-3" /></a></>}</div></div> }, { key: 'listingType', header: 'Tipo' }, { key: 'price', header: 'Preço', align: 'right', cell: (r: any) => money(r.price) }, { key: 'stock', header: 'Estoque', align: 'right', cell: (r: any) => num(r.stock) }, { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> }, { key: 'lastSyncAt', header: 'Sync', cell: (r: any) => <span className="text-xs">{fmtDateTime(r.lastSyncAt)}</span> }]} />
        </TabsContent>
        <TabsContent value="pedidos">
          <DataTable rows={ch.orders} onRowClick={(r: any) => router.push(`/vendas/${r.id}`)} columns={[{ key: 'number', header: 'Nº' }, { key: 'externalId', header: 'Nº no canal' }, { key: 'date', header: 'Data', cell: (r: any) => fmtDate(r.date) }, { key: 'c', header: 'Comprador', cell: (r: any) => r.customer.name }, { key: 'total', header: 'Total', align: 'right', cell: (r: any) => money(r.total) }, { key: 'channelFee', header: 'Tarifa', align: 'right', cell: (r: any) => money(r.channelFee) }, { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> }]} />
        </TabsContent>
        <TabsContent value="logs">
          <DataTable rows={ch.logs} columns={[{ key: 'createdAt', header: 'Data', cell: (r: any) => fmtDateTime(r.createdAt) }, { key: 'type', header: 'Tipo', cell: (r: any) => <Badge tone={r.success ? 'blue' : 'red'}>{r.type}</Badge> }, { key: 'message', header: 'Mensagem', cell: (r: any) => <div className="text-sm">{r.message}{r.payload?.changes && <div className="text-[10px] text-muted-foreground">{r.payload.changes.slice(0, 5).join(' · ')}</div>}</div> }]} />
        </TabsContent>
      </Tabs>
      <p className="mt-3 text-xs text-muted-foreground"><Link href="/vendas/anuncios" className="text-primary">Gestão de anúncios</Link> · <Link href="/integracoes/logs" className="text-primary">Todos os logs</Link></p>
    </div>
  );
}
