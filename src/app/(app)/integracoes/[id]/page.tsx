'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Download, RefreshCw, Upload, Unplug, Save } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, Field } from '@/components/common/page';
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
  return (
    <div>
      <PageHeader title={ch.name} badge={<StatusBadge status={ch.status} />} description={ch.storeName}
        actions={<>
          <Button variant="outline" onClick={() => router.push('/integracoes')}><ArrowLeft /> Voltar</Button>
          <div className="flex items-center gap-1"><Input type="number" className="w-16" value={count} onChange={(e) => setCount(Number(e.target.value))} /><Button onClick={() => run('import', { count }, 'Pedidos importados (estoque reservado automaticamente)')}><Download /> Importar pedidos</Button></div>
          <Button variant="outline" onClick={() => run('sync-stock', {}, 'Estoque sincronizado')}><RefreshCw /> Estoque</Button>
          <Button variant="outline" onClick={() => run('sync-price', {}, 'Preços sincronizados')}><RefreshCw /> Preços</Button>
          <Button variant="outline" onClick={() => run('publish', {}, 'Produtos publicados')}><Upload /> Publicar</Button>
          <Button variant="outline" onClick={() => confirm('Desconectar?') && run('disconnect', {}, 'Canal desconectado')}><Unplug /></Button>
        </>} />
      <Tabs defaultValue="config">
        <TabsList><TabsTrigger value="config">Configurações</TabsTrigger><TabsTrigger value="anuncios">Anúncios ({ch.listings.length})</TabsTrigger><TabsTrigger value="pedidos">Pedidos</TabsTrigger><TabsTrigger value="logs">Logs</TabsTrigger></TabsList>
        <TabsContent value="config">
          <Card><CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[['syncStock', 'Sincronizar estoque em tempo real', 'Toda movimentação atualiza o saldo dos anúncios'], ['syncPrice', 'Sincronizar preços', 'Usa a lista de preço do canal'], ['autoImport', 'Importar pedidos automaticamente', 'Usado pelo simulador em tempo real']].map(([k, l, h]) => (
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
          <DataTable rows={ch.listings} columns={[{ key: 'externalId', header: 'ID', cell: (r: any) => <span className="font-mono text-xs">{r.externalId}</span> }, { key: 'title', header: 'Título' }, { key: 'listingType', header: 'Tipo' }, { key: 'price', header: 'Preço', align: 'right', cell: (r: any) => money(r.price) }, { key: 'stock', header: 'Estoque', align: 'right', cell: (r: any) => num(r.stock) }, { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> }, { key: 'lastSyncAt', header: 'Sync', cell: (r: any) => <span className="text-xs">{fmtDateTime(r.lastSyncAt)}</span> }]} />
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
