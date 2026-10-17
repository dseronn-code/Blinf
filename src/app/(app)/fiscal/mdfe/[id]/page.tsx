'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, Send, XCircle, FileText, FileCode, Flag } from 'lucide-react';
import { useApi, useAction, openFile } from '@/lib/api';
import { PageHeader, DataTable, KV } from '@/components/common/page';
import { PromptDialog } from '@/components/common/prompt';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { money, num, fmtDateTime, fmtDoc } from '@/lib/utils';
import { formatAccessKey } from '@/lib/br';

const STATUS_LABEL: Record<string, [string, string]> = { RASCUNHO: ['Rascunho', 'gray'], AUTORIZADO: ['Autorizado', 'green'], REJEITADO: ['Rejeitado', 'red'], ENCERRADO: ['Encerrado', 'blue'], CANCELADO: ['Cancelado', 'gray'], PROCESSANDO: ['Processando', 'blue'] };
const TP_ROD: Record<string, string> = { '01': 'Truck', '02': 'Toco', '03': 'Cavalo mecânico', '04': 'VAN', '05': 'Utilitário', '06': 'Outros' };
const TP_CAR: Record<string, string> = { '00': 'Não aplicável', '01': 'Aberta', '02': 'Fechada/Baú', '03': 'Granelera', '04': 'Porta contêiner', '05': 'Sider' };
const EVENT_TONE: Record<string, string> = { AUTORIZACAO: 'green', REJEICAO: 'red', CANCELAMENTO: 'gray', ENCERRAMENTO: 'blue' };

export default function MdfeDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const act = useAction();
  const { data: m } = useApi<any>(`/api/mdfe/${id}`);
  const [cancel, setCancel] = useState(false);
  if (!m) return null;
  const [label, tone] = STATUS_LABEL[m.status] || [m.status, 'gray'];
  const d = m.dados || { loads: [], unloads: [], trailers: [] };
  const lastUnload = d.unloads.at(-1)?.city || m.unloadCity;
  const events: { type: string; code?: string; protocol?: string; description: string; at: string }[] = Array.isArray(m.events) ? [...m.events].reverse() : [];
  return (
    <div>
      <PageHeader title={`MDF-e nº ${m.number} série ${m.series}`} badge={<span className="flex gap-1"><Badge tone={tone}>{label}</Badge>{m.environment === 2 && <Badge tone="yellow">Homologação</Badge>}</span>} description={`${m.ufStart} → ${m.ufEnd} · ${m.invoiceKeys.length} NF-e`}
        actions={<>
          <Button variant="outline" onClick={() => router.push('/fiscal/mdfe')}><ArrowLeft /> Voltar</Button>
          {['RASCUNHO', 'REJEITADO', 'PROCESSANDO'].includes(m.status) && <Button onClick={() => act('POST', `/api/mdfe/${id}/transmit`, {}, 'Manifesto transmitido — veja o retorno')}><Send /> {m.status === 'PROCESSANDO' ? 'Consultar retorno' : 'Transmitir'}</Button>}
          <Button variant="outline" onClick={() => openFile(`/api/mdfe/${id}/damdfe`)}><FileText /> DAMDFE</Button>
          {m.hasXml && <Button variant="outline" onClick={() => openFile(`/api/mdfe/${id}/xml`)}><FileCode /> XML</Button>}
          {m.status === 'AUTORIZADO' && <Button variant="outline" onClick={() => confirm(`Encerrar o MDF-e em ${lastUnload}/${m.ufEnd}? Faça isso ao concluir a viagem.`) && act('POST', `/api/mdfe/${id}/close`, {}, 'MDF-e encerrado')}><Flag /> Encerrar</Button>}
          {!['CANCELADO', 'ENCERRADO'].includes(m.status) && <Button variant="outline" onClick={() => setCancel(true)}><XCircle /> Cancelar</Button>}
        </>} />
      {m.rejection && m.status === 'REJEITADO' && <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{m.rejection}</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Dados do manifesto</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="col-span-2 md:col-span-4"><KV label="Chave de acesso" value={m.accessKey ? <span className="font-mono text-xs">{formatAccessKey(m.accessKey)}</span> : 'Gerada na transmissão'} /></div>
            <KV label="Protocolo" value={m.protocol || '—'} />
            <KV label="Emissão" value={fmtDateTime(m.issueDate)} />
            <KV label="Encerrado em" value={m.closedAt ? fmtDateTime(m.closedAt) : '—'} />
            <KV label="Percurso" value={[m.ufStart, ...m.route, m.ufEnd].filter((u: string, i: number, a: string[]) => a.indexOf(u) === i).join(' → ')} />
            <KV label="Carregamento" value={d.loads.map((l: any) => `${l.city} (${l.code})`).join('; ')} />
            <KV label="Descarregamento" value={d.unloads.map((u: any) => `${u.city} (${u.code}) · ${u.keys.length} NF-e`).join('; ')} />
            <KV label="Peso bruto" value={`${num(m.totalWeight, 3)} kg`} />
            <KV label="Valor da carga" value={money(m.totalValue)} />
            <KV label="Veículo" value={<span className="font-mono">{m.vehiclePlate}</span>} />
            <KV label="UF / Tara" value={`${m.vehicleUf} / ${m.vehicleTara} kg`} />
            <KV label="RNTRC" value={m.rntrc || '—'} />
            <KV label="Condutor" value={`${m.driverName} (${fmtDoc(m.driverCpf)})`} />
            <KV label="Rodado / Carroceria" value={`${TP_ROD[d.tpRod] || d.tpRod} / ${TP_CAR[d.tpCar] || d.tpCar}`} />
            <KV label="Capacidade" value={[d.capKG ? `${num(d.capKG, 0)} kg` : '', d.capM3 ? `${num(d.capM3, 0)} m³` : ''].filter(Boolean).join(' / ') || '—'} />
            {d.trailers.length > 0 && <div className="col-span-2"><KV label="Reboques" value={d.trailers.map((t: any) => `${t.plate} (${t.uf}, tara ${t.tara} kg, ${num(t.capKG, 0)} kg, ${TP_CAR[t.tpCar] || t.tpCar})`).join('; ')} /></div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Eventos</CardTitle></CardHeader>
          <div className="divide-y">
            {events.map((e, i) => <div key={i} className="px-4 py-2 text-xs"><div className="flex justify-between"><Badge tone={EVENT_TONE[e.type] || 'blue'}>{e.type}</Badge><span className="text-muted-foreground">{fmtDateTime(e.at)}</span></div><div className="mt-1">{e.description}</div>{e.protocol && <div className="text-muted-foreground">Protocolo {e.protocol}</div>}</div>)}
          </div>
        </Card>
        <div className="lg:col-span-3">
          <DataTable rows={m.invoices} empty="Nenhuma NF-e" columns={[
            { key: 'number', header: 'NF-e', cell: (r: any) => <Link className="text-primary hover:underline" href={`/fiscal/notas/${r.id}`}>{r.number}/{r.series}</Link> },
            { key: 'accessKey', header: 'Chave', cell: (r: any) => <span className="font-mono text-[11px]">{formatAccessKey(r.accessKey)}</span> },
            { key: 'customerName', header: 'Destinatário' },
            { key: 'customerUf', header: 'UF' },
            { key: 'unloadCity', header: 'Descarregamento' },
            { key: 'total', header: 'Total', align: 'right', cell: (r: any) => money(r.total) },
            { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> },
          ]} />
        </div>
      </div>
      <PromptDialog open={cancel} onOpenChange={setCancel} title="Cancelar MDF-e" destructive minLength={['RASCUNHO', 'REJEITADO'].includes(m.status) ? 0 : 15}
        description={m.status === 'AUTORIZADO' ? 'O cancelamento só é aceito antes do início da viagem (até 24 h). Depois disso, encerre o manifesto.' : 'O rascunho será descartado.'}
        label="Justificativa" confirmText="Cancelar manifesto" onConfirm={(t) => act('POST', `/api/mdfe/${id}/cancel`, { reason: t }, 'MDF-e cancelado')} />
    </div>
  );
}
