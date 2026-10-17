'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Pause, Play, RefreshCw, Link2, ExternalLink } from 'lucide-react';
import { useApi, useAction, qs } from '@/lib/api';
import { PageHeader, DataTable, Filters, SearchBox, SimBanner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { money, num, fmtDateTime } from '@/lib/utils';
import { CreateListingButton } from './create-listing';

export default function Listings() {
  const [q, setQ] = useState('');
  const [channelId, setChannelId] = useState('');
  const [status, setStatus] = useState('');
  const { data, isLoading } = useApi<any>(`/api/listings${qs({ q, channelId, status })}`);
  const { data: integ } = useApi<any>('/api/integrations');
  const channels = (integ?.connectors || []).filter((c: any) => c.channel?.status === 'CONECTADO');
  const act = useAction();
  // Canais ligados a contas reais (Integrações → Contas)
  const realIds = new Set(channels.filter((c: any) => c.channel.real).map((c: any) => c.channel.id));
  const selReal = channelId && realIds.has(channelId);
  // Canais onde se cria anúncio a partir do produto (marketplaces e lojas)
  const createChannels = channels.filter((c: any) => ['MARKETPLACE', 'ECOMMERCE'].includes(c.category)).map((c: any) => ({ id: c.channel.id, name: c.name, provider: c.provider, real: c.channel.real }));
  const setPrice = async (r: any, el: HTMLInputElement) => {
    const v = Number(el.value);
    if (!(v > 0) || v === r.price) { el.value = String(r.price); return; }
    // Canal real: a API do canal confirma; se recusar, o preço anterior volta
    if (!(await act('PUT', `/api/listings/${r.id}`, { price: v }, realIds.has(r.channelId) ? 'Preço atualizado no canal' : 'Preço do anúncio atualizado'))) el.value = String(r.price);
  };
  return (
    <div>
      <PageHeader title="Gestão de anúncios" description="Anúncios publicados nos marketplaces e lojas, com estoque e preço sincronizados em tempo real" actions={<>{channelId && (selReal ? <>
        <Button variant="outline" onClick={() => act('POST', `/api/integrations/${channelId}/push`, {}, 'Estoque e preço enviados ao canal')}><RefreshCw /> Enviar estoque/preço agora</Button>
        <Button variant="outline" onClick={() => act('POST', `/api/integrations/${channelId}/link`, {}, 'Anúncios vinculados por SKU')}><Link2 /> Vincular anúncios por SKU</Button>
      </> : <><Button variant="outline" onClick={() => act('POST', `/api/integrations/${channelId}/sync-stock`, {}, 'Estoque sincronizado')}><RefreshCw /> Sincronizar estoque</Button><Button variant="outline" onClick={() => act('POST', `/api/integrations/${channelId}/publish`, {}, 'Novos produtos publicados')}>Publicar produtos não anunciados</Button></>)}<CreateListingButton channels={createChannels} defaultChannelId={channelId || undefined} /></>} />
      {realIds.size > 0
        ? <p className="mb-3 text-xs text-muted-foreground">Anúncios de canais com <b>conta real</b> são criados (botão Criar anúncio) ou vinculados pelo SKU e atualizados na API oficial — pausar/ativar e preço refletem no canal; os demais canais são simulados. <Link href="/integracoes/contas" className="text-primary">Contas e credenciais</Link></p>
        : <SimBanner>os anúncios e IDs (MLB…, ASIN…) são gerados localmente; nenhuma chamada é feita às APIs oficiais dos marketplaces. Conecte uma conta real em <Link href="/integracoes/contas" className="underline">Integrações → Contas e credenciais</Link>.</SimBanner>}
      <Filters>
        <SearchBox value={q} onChange={setQ} placeholder="Título ou ID do anúncio" />
        <Select className="w-56" value={channelId} onChange={(e) => setChannelId(e.target.value)}><option value="">Todos os canais</option>{channels.map((c: any) => <option key={c.channel.id} value={c.channel.id}>{c.name}</option>)}</Select>
        <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas as situações</option><option value="ATIVO">Ativos</option><option value="PAUSADO">Pausados</option><option value="SEM_ESTOQUE">Sem estoque</option></Select>
      </Filters>
      <DataTable loading={isLoading} rows={data?.rows} columns={[
        { key: 'channel', header: 'Canal', cell: (r: any) => <div><div>{r.channel.name}</div>{realIds.has(r.channelId) ? <Badge tone="green">Vínculo real</Badge> : <Badge tone="yellow">Simulado</Badge>}</div> },
        { key: 'externalId', header: 'ID', cell: (r: any) => <div><span className="font-mono text-xs">{r.externalId}</span>{r.permalink && !r.permalink.startsWith('https://simulado.') && <div><a href={r.permalink} target="_blank" rel="noreferrer" className="text-xs text-primary">ver anúncio <ExternalLink className="inline h-3 w-3" /></a></div>}</div> },
        { key: 'title', header: 'Título', cell: (r: any) => <div><div>{r.title}</div><div className="text-xs text-muted-foreground">{r.product.sku} · {r.listingType}</div></div> },
        { key: 'price', header: 'Preço anúncio', align: 'right', cell: (r: any) => <Input key={`${r.id}-${r.price}`} type="number" step="0.01" defaultValue={r.price} disabled={r.status === 'ENCERRADO'} className="ml-auto h-8 w-24 text-right" onBlur={(e) => setPrice(r, e.target)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /> },
        { key: 'base', header: 'Preço ERP', align: 'right', cell: (r: any) => money(r.product.price) },
        { key: 'stock', header: 'Estoque', align: 'right', cell: (r: any) => num(r.stock) }, { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> },
        { key: 'lastSyncAt', header: 'Última sincronização', cell: (r: any) => <span className="text-xs">{fmtDateTime(r.lastSyncAt)}</span> },
        { key: 'a', header: '', cell: (r: any) => r.status === 'ENCERRADO' ? null : r.status === 'PAUSADO' ? <Button size="icon" variant="ghost" title="Ativar" onClick={() => act('PUT', `/api/listings/${r.id}`, { status: 'ATIVO' }, realIds.has(r.channelId) ? 'Anúncio ativado no canal' : 'Anúncio reativado')}><Play /></Button> : <Button size="icon" variant="ghost" title="Pausar" onClick={() => act('PUT', `/api/listings/${r.id}`, { status: 'PAUSADO' }, realIds.has(r.channelId) ? 'Anúncio pausado no canal' : 'Anúncio pausado')}><Pause /></Button> },
      ]} />
    </div>
  );
}
