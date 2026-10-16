'use client';
import { useState } from 'react';
import { Pause, Play, RefreshCw } from 'lucide-react';
import { useApi, useAction, qs } from '@/lib/api';
import { PageHeader, DataTable, Filters, SearchBox, SimBanner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { money, num, fmtDateTime } from '@/lib/utils';

export default function Listings() {
  const [q, setQ] = useState('');
  const [channelId, setChannelId] = useState('');
  const [status, setStatus] = useState('');
  const { data, isLoading } = useApi<any>(`/api/listings${qs({ q, channelId, status })}`);
  const { data: integ } = useApi<any>('/api/integrations');
  const channels = (integ?.connectors || []).filter((c: any) => c.channel?.status === 'CONECTADO');
  const act = useAction();
  return (
    <div>
      <PageHeader title="Gestão de anúncios" description="Anúncios publicados nos marketplaces e lojas, com estoque e preço sincronizados em tempo real" actions={channelId && <><Button variant="outline" onClick={() => act('POST', `/api/integrations/${channels.find((c: any) => c.channel.id === channelId)?.channel.id}/sync-stock`, {}, 'Estoque sincronizado')}><RefreshCw /> Sincronizar estoque</Button><Button onClick={() => act('POST', `/api/integrations/${channelId}/publish`, {}, 'Novos produtos publicados')}>Publicar produtos não anunciados</Button></>} />
      <SimBanner>os anúncios e IDs (MLB…, ASIN…) são gerados localmente; nenhuma chamada é feita às APIs oficiais dos marketplaces.</SimBanner>
      <Filters>
        <SearchBox value={q} onChange={setQ} placeholder="Título ou ID do anúncio" />
        <Select className="w-56" value={channelId} onChange={(e) => setChannelId(e.target.value)}><option value="">Todos os canais</option>{channels.map((c: any) => <option key={c.channel.id} value={c.channel.id}>{c.name}</option>)}</Select>
        <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas as situações</option><option value="ATIVO">Ativos</option><option value="PAUSADO">Pausados</option><option value="SEM_ESTOQUE">Sem estoque</option></Select>
      </Filters>
      <DataTable loading={isLoading} rows={data?.rows} columns={[
        { key: 'channel', header: 'Canal', cell: (r: any) => r.channel.name }, { key: 'externalId', header: 'ID', cell: (r: any) => <span className="font-mono text-xs">{r.externalId}</span> },
        { key: 'title', header: 'Título', cell: (r: any) => <div><div>{r.title}</div><div className="text-xs text-muted-foreground">{r.product.sku} · {r.listingType}</div></div> },
        { key: 'price', header: 'Preço anúncio', align: 'right', cell: (r: any) => <Input type="number" step="0.01" defaultValue={r.price} className="ml-auto h-8 w-24 text-right" onBlur={(e) => Number(e.target.value) !== r.price && act('PUT', `/api/listings/${r.id}`, { price: Number(e.target.value) }, 'Preço do anúncio atualizado')} /> },
        { key: 'base', header: 'Preço ERP', align: 'right', cell: (r: any) => money(r.product.price) },
        { key: 'stock', header: 'Estoque', align: 'right', cell: (r: any) => num(r.stock) }, { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> },
        { key: 'lastSyncAt', header: 'Última sincronização', cell: (r: any) => <span className="text-xs">{fmtDateTime(r.lastSyncAt)}</span> },
        { key: 'a', header: '', cell: (r: any) => r.status === 'PAUSADO' ? <Button size="icon" variant="ghost" onClick={() => act('PUT', `/api/listings/${r.id}`, { status: 'ATIVO' }, 'Anúncio reativado')}><Play /></Button> : <Button size="icon" variant="ghost" onClick={() => act('PUT', `/api/listings/${r.id}`, { status: 'PAUSADO' }, 'Anúncio pausado')}><Pause /></Button> },
      ]} />
    </div>
  );
}
