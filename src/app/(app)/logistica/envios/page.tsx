'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Printer, ChevronsRight, MapPin, Package, ShoppingCart, RefreshCw, Send, CheckCircle2, Hash } from 'lucide-react';
import { useApi, useAction, qs, openFile } from '@/lib/api';
import { PageHeader, Filters, SearchBox, DataTable, Chips, SimBanner, useDemoMode } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/common/page';
import { StatusBadge } from '@/components/ui/badge';
import { money, fmtDate, fmtDateTime, num } from '@/lib/utils';
import { toast } from 'sonner';

export default function Shipments() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [track, setTrack] = useState<any>(null);
  const [vol, setVol] = useState<{ id: string; code: string; volumes: string; weight: string } | null>(null);
  const { data, isLoading } = useApi<any>(`/api/logistics/shipments${qs({ q, status })}`);
  const act = useAction();
  const demo = useDemoMode();
  // Frete próprio / retirada: código de rastreio digitado pelo usuário (opcional)
  const [code, setCode] = useState<{ id: string; trackingCode: string } | null>(null);
  const saveCode = async () => {
    if (!code) return;
    const r = await act('POST', `/api/logistics/shipments/${code.id}`, { action: 'mark', trackingCode: code.trackingCode }, 'Código de rastreio salvo');
    if (r !== undefined) setCode(null);
  };
  const mark = (r: any, status: string) => act('POST', `/api/logistics/shipments/${r.id}`, { action: 'mark', status }, status === 'POSTADO' ? 'Envio marcado como postado' : 'Envio marcado como entregue');
  const saveVolumes = async () => {
    if (!vol) return;
    const volumes = Math.floor(Number(vol.volumes));
    if (!(volumes >= 1 && volumes <= 99)) return toast.error('Informe de 1 a 99 volumes');
    const weight = vol.weight === '' ? undefined : Number(String(vol.weight).replace(',', '.'));
    if (weight !== undefined && !(weight > 0)) return toast.error('Peso total inválido');
    const r = await act('POST', `/api/logistics/shipments/${vol.id}`, { action: 'volumes', volumes, weight }, 'Volumes atualizados');
    if (r !== undefined) setVol(null);
  };
  return (
    <div>
      <PageHeader title="Envios e rastreamento" description={demo ? "Etiquetas geradas no faturamento (GestãoPro Envios, Correios e Melhor Envio), códigos de rastreio e eventos da transportadora" : "Etiquetas compradas no Melhor Envio/Correios (rastreio automático) e envios de frete próprio/retirada (postagem e entrega marcadas por você)"} actions={<Button disabled={!sel.length} onClick={() => openFile(`/api/logistics/labels?ids=${sel.join(',')}`)}><Printer /> Imprimir {sel.length || ''} etiqueta(s) 10x15</Button>} />
      {!demo && <p className="mb-3 text-xs text-muted-foreground">Etiquetas compradas no provedor são rastreadas automaticamente a cada 30 minutos ("Atualizar" consulta na hora). Envios de <b>frete próprio / retirada</b> imprimem uma etiqueta de endereçamento; marque a postagem e a entrega e, se houver, informe o código de rastreio da sua transportadora.</p>}
      <SimBanner>envios sem conta do Melhor Envio/Correios conectada usam código de rastreio no padrão UPU e eventos simulados — use "Avançar" para simular a transportadora. Etiquetas compradas no provedor real são rastreadas automaticamente a cada 30 minutos ("Atualizar" consulta na hora) e impressas com o PDF oficial.</SimBanner>
      <Filters><SearchBox value={q} onChange={setQ} placeholder="Rastreio ou cliente" /><Chips value={status} onChange={setStatus} options={[{ value: '', label: 'Todos' }, { value: 'ETIQUETA_GERADA', label: 'Aguardando postagem' }, { value: 'POSTADO,EM_TRANSITO,SAIU_PARA_ENTREGA', label: 'Em trânsito' }, { value: 'ENTREGUE', label: 'Entregues' }]} /></Filters>
      <DataTable loading={isLoading} rows={data?.rows} selectable selected={sel} onSelect={setSel} onRowClick={setTrack} columns={[
        { key: 'order', header: 'Pedido', cell: (r: any) => <Link onClick={(e) => e.stopPropagation()} className="text-primary" href={`/vendas/${r.salesOrder.id}`}>#{r.salesOrder.number}</Link> },
        { key: 'customer', header: 'Destinatário', cell: (r: any) => <div><div>{r.salesOrder.customer.name}</div><div className="text-xs text-muted-foreground">{r.salesOrder.shipTo?.city}/{r.salesOrder.shipTo?.uf}</div></div> },
        { key: 'carrier', header: 'Transportadora', cell: (r: any) => <div><div>{r.carrier}</div><div className="text-xs text-muted-foreground">{r.service}</div></div> },
        { key: 'trackingCode', header: 'Rastreio', cell: (r: any) => <div><span className="font-mono text-xs">{r.trackingCode || '—'}</span>{r.labelUrl && <div className="text-[10px] text-emerald-700">etiqueta oficial</div>}</div> },
        { key: 'volumes', header: 'Volumes', align: 'center', cell: (r: any) => <Button size="sm" variant="ghost" title="Editar volumes" disabled={['ENTREGUE', 'CANCELADO'].includes(r.status)} onClick={(e) => { e.stopPropagation(); setVol({ id: r.id, code: r.trackingCode, volumes: String(r.volumes ?? 1), weight: String(r.weight ?? '') }); }}><Package /> {r.volumes ?? 1}</Button> },
        { key: 'weight', header: 'Peso', align: 'right', cell: (r: any) => `${num(r.weight, 3)} kg` }, { key: 'price', header: 'Frete', align: 'right', cell: (r: any) => money(r.price) },
        { key: 'eta', header: 'Previsão', cell: (r: any) => fmtDate(r.eta) }, { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> },
        { key: 'a', header: '', cell: (r: any) => r.provider === 'PROPRIO' ? (!['ENTREGUE', 'CANCELADO'].includes(r.status) && <span className="flex gap-1">
            <Button size="sm" variant="ghost" title="Código de rastreio" onClick={(e) => { e.stopPropagation(); setCode({ id: r.id, trackingCode: r.trackingCode || '' }); }}><Hash /></Button>
            {r.status === 'ETIQUETA_GERADA' && <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); mark(r, 'POSTADO'); }}><Send /> Postado</Button>}
            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); mark(r, 'ENTREGUE'); }}><CheckCircle2 /> Entregue</Button>
          </span>)
          : r.status === 'PENDENTE' ? <Button size="sm" onClick={(e) => { e.stopPropagation(); act('POST', `/api/logistics/shipments/${r.id}`, { action: 'buy' }, 'Etiqueta comprada'); }}><ShoppingCart /> Comprar etiqueta</Button>
          : !['ENTREGUE', 'CANCELADO'].includes(r.status) && (r.providerRef || demo) && <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); act('POST', `/api/logistics/shipments/${r.id}`, { action: 'advance' }, 'Rastreio atualizado'); }}>{r.providerRef ? <><RefreshCw /> Atualizar</> : <><ChevronsRight /> Avançar</>}</Button> },
      ]} />
      <p className="mt-2 text-xs text-muted-foreground">Dica: a impressão de etiquetas gera uma etiqueta por volume (ex.: “Volume 1/3”, “Volume 2/3”…). Clique no número de volumes para ajustar antes de imprimir.</p>
      <Dialog open={!!vol} onOpenChange={(o) => !o && setVol(null)} title="Volumes do envio" description={vol?.code ? `Rastreio ${vol.code}` : undefined} size="sm" footer={<><Button variant="outline" onClick={() => setVol(null)}>Cancelar</Button><Button onClick={saveVolumes}>Salvar</Button></>}>
        {vol && <div className="grid grid-cols-2 gap-3">
          <Field label="Quantidade de volumes" hint="De 1 a 99"><Input type="number" min={1} max={99} step={1} value={vol.volumes} onChange={(e) => setVol({ ...vol, volumes: e.target.value })} /></Field>
          <Field label="Peso total (kg)" hint="Soma de todos os volumes"><Input type="number" min={0} step="0.001" value={vol.weight} onChange={(e) => setVol({ ...vol, weight: e.target.value })} /></Field>
          <p className="col-span-2 text-xs text-muted-foreground">Ao imprimir, será gerada uma etiqueta 10x15 para cada volume, numerada “Volume 1/{Math.max(1, Math.floor(Number(vol.volumes) || 1))}”.</p>
        </div>}
      </Dialog>
      <Dialog open={!!code} onOpenChange={(o) => !o && setCode(null)} title="Código de rastreio" description="Frete próprio / transportadora própria" size="sm" footer={<><Button variant="outline" onClick={() => setCode(null)}>Cancelar</Button><Button onClick={saveCode}>Salvar</Button></>}>
        {code && <Field label="Código informado pela transportadora" hint="Deixe em branco se não houver"><Input value={code.trackingCode} onChange={(e) => setCode({ ...code, trackingCode: e.target.value })} /></Field>}
      </Dialog>
      <Dialog open={!!track} onOpenChange={(o) => !o && setTrack(null)} title={`Rastreamento ${track?.trackingCode || ''}`} description={`${track?.carrier} ${track?.service}`} size="sm">
        {track && <ol className="relative ml-3 border-l">{[...(track.events || [])].reverse().map((e: any, i: number) => <li key={i} className="mb-4 ml-4"><span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-white bg-primary" /><div className="text-sm font-medium">{e.description}</div><div className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{e.location ? `${e.location} · ` : ''}{fmtDateTime(e.date)}</div></li>)}</ol>}
      </Dialog>
    </div>
  );
}
