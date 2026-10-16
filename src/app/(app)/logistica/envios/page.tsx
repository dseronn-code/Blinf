'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Printer, ChevronsRight, MapPin } from 'lucide-react';
import { useApi, useAction, qs, openFile } from '@/lib/api';
import { PageHeader, Filters, SearchBox, DataTable, Chips, SimBanner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/ui/badge';
import { money, fmtDate, fmtDateTime, num } from '@/lib/utils';

export default function Shipments() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [track, setTrack] = useState<any>(null);
  const { data, isLoading } = useApi<any>(`/api/logistics/shipments${qs({ q, status })}`);
  const act = useAction();
  return (
    <div>
      <PageHeader title="Envios e rastreamento" description="Etiquetas geradas no faturamento (GestãoPro Envios, Correios e Melhor Envio), códigos de rastreio e eventos da transportadora" actions={<Button disabled={!sel.length} onClick={() => openFile(`/api/logistics/labels?ids=${sel.join(',')}`)}><Printer /> Imprimir {sel.length || ''} etiqueta(s) 10x15</Button>} />
      <SimBanner>códigos de rastreio seguem o padrão UPU (com dígito verificador), mas os eventos de rastreio são simulados — use "Avançar" para simular a atualização da transportadora (postagem → trânsito → entrega).</SimBanner>
      <Filters><SearchBox value={q} onChange={setQ} placeholder="Rastreio ou cliente" /><Chips value={status} onChange={setStatus} options={[{ value: '', label: 'Todos' }, { value: 'ETIQUETA_GERADA', label: 'Aguardando postagem' }, { value: 'POSTADO,EM_TRANSITO,SAIU_PARA_ENTREGA', label: 'Em trânsito' }, { value: 'ENTREGUE', label: 'Entregues' }]} /></Filters>
      <DataTable loading={isLoading} rows={data?.rows} selectable selected={sel} onSelect={setSel} onRowClick={setTrack} columns={[
        { key: 'order', header: 'Pedido', cell: (r: any) => <Link onClick={(e) => e.stopPropagation()} className="text-primary" href={`/vendas/${r.salesOrder.id}`}>#{r.salesOrder.number}</Link> },
        { key: 'customer', header: 'Destinatário', cell: (r: any) => <div><div>{r.salesOrder.customer.name}</div><div className="text-xs text-muted-foreground">{r.salesOrder.shipTo?.city}/{r.salesOrder.shipTo?.uf}</div></div> },
        { key: 'carrier', header: 'Transportadora', cell: (r: any) => <div><div>{r.carrier}</div><div className="text-xs text-muted-foreground">{r.service}</div></div> },
        { key: 'trackingCode', header: 'Rastreio', cell: (r: any) => <span className="font-mono text-xs">{r.trackingCode}</span> },
        { key: 'weight', header: 'Peso', align: 'right', cell: (r: any) => `${num(r.weight, 3)} kg` }, { key: 'price', header: 'Frete', align: 'right', cell: (r: any) => money(r.price) },
        { key: 'eta', header: 'Previsão', cell: (r: any) => fmtDate(r.eta) }, { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> },
        { key: 'a', header: '', cell: (r: any) => !['ENTREGUE', 'CANCELADO'].includes(r.status) && <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); act('POST', `/api/logistics/shipments/${r.id}`, { action: 'advance' }, 'Rastreio atualizado'); }}><ChevronsRight /> Avançar</Button> },
      ]} />
      <Dialog open={!!track} onOpenChange={(o) => !o && setTrack(null)} title={`Rastreamento ${track?.trackingCode}`} description={`${track?.carrier} ${track?.service}`} size="sm">
        {track && <ol className="relative ml-3 border-l">{[...(track.events || [])].reverse().map((e: any, i: number) => <li key={i} className="mb-4 ml-4"><span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-white bg-primary" /><div className="text-sm font-medium">{e.description}</div><div className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{e.location} · {fmtDateTime(e.date)}</div></li>)}</ol>}
      </Dialog>
    </div>
  );
}
