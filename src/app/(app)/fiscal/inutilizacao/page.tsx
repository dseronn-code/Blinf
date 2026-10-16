'use client';
import { useState } from 'react';
import { Ban, Info } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, Field, SimBanner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtDateTime } from '@/lib/utils';

type Void = { id: string; model: string; series: number; fromNumber: number; toNumber: number; reason: string; protocol: string; createdAt: string };

const empty = { model: 'NFE', series: '1', fromNumber: '', toNumber: '', reason: '' };

export default function Inutilizacao() {
  const act = useAction();
  const { data, isLoading } = useApi<Void[]>('/api/fiscal/voids');
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const from = Number(f.fromNumber);
  const to = Number(f.toNumber || f.fromNumber);
  const valid = from > 0 && to >= from && f.reason.trim().length >= 15 && Number(f.series) >= 0;

  const submit = async () => {
    setBusy(true);
    const r = await act('POST', '/api/fiscal/voids', { model: f.model, series: Number(f.series), fromNumber: from, toNumber: to, reason: f.reason.trim() }, 'Numeração inutilizada — protocolo registrado');
    setBusy(false);
    if (r) setF(empty);
  };

  return (
    <div>
      <PageHeader title="Inutilização de numeração" description="Informe à SEFAZ faixas de números de NF-e/NFC-e que foram pulados e não serão utilizados" />
      <SimBanner>o pedido de inutilização é validado com as regras da SEFAZ (faixa, justificativa, números já usados) e recebe um protocolo simulado.</SimBanner>
      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader><CardTitle>Nova inutilização</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Modelo"><Select value={f.model} onChange={set('model')}><option value="NFE">NF-e (55)</option><option value="NFCE">NFC-e (65)</option></Select></Field>
              <Field label="Série"><Input type="number" min={0} value={f.series} onChange={set('series')} /></Field>
              <Field label="Número inicial"><Input type="number" min={1} value={f.fromNumber} onChange={set('fromNumber')} /></Field>
              <Field label="Número final" hint="Vazio = apenas o número inicial"><Input type="number" min={1} value={f.toNumber} onChange={set('toNumber')} /></Field>
            </div>
            <Field label="Justificativa" hint={`${f.reason.trim().length}/15 caracteres mínimos`}>
              <Textarea rows={3} value={f.reason} onChange={set('reason')} placeholder="Ex.: Falha no sistema emissor pulou a sequência de numeração" />
            </Field>
            {from > 0 && to >= from && <p className="text-xs text-muted-foreground">Serão inutilizados <b>{to - from + 1}</b> número(s): {from}{to > from ? ` a ${to}` : ''}, série {f.series}.</p>}
            <Button className="w-full" variant="destructive" disabled={!valid || busy} onClick={submit}><Ban /> Inutilizar numeração</Button>
            <div className="flex gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <div>Os números inutilizados são <b>pulados automaticamente</b> nas próximas emissões: o sistema nunca atribuirá a uma nota um número que esteja numa faixa inutilizada. Não é possível inutilizar números já usados em notas autorizadas, canceladas ou em contingência.</div>
            </div>
          </CardContent>
        </Card>
        <div className="min-w-0">
          <DataTable loading={isLoading} rows={data} empty="Nenhuma faixa inutilizada" columns={[
            { key: 'createdAt', header: 'Data', cell: (r: Void) => fmtDateTime(r.createdAt) },
            { key: 'model', header: 'Modelo', cell: (r: Void) => <Badge tone={r.model === 'NFE' ? 'blue' : 'teal'}>{r.model === 'NFE' ? 'NF-e' : 'NFC-e'}</Badge> },
            { key: 'series', header: 'Série', align: 'center' },
            { key: 'range', header: 'Faixa', cell: (r: Void) => <b className="tabular-nums">{r.fromNumber}{r.toNumber !== r.fromNumber ? ` a ${r.toNumber}` : ''}</b> },
            { key: 'qty', header: 'Qtd', align: 'right', cell: (r: Void) => r.toNumber - r.fromNumber + 1 },
            { key: 'reason', header: 'Justificativa', cell: (r: Void) => <span className="block max-w-[280px] truncate text-xs" title={r.reason}>{r.reason}</span> },
            { key: 'protocol', header: 'Protocolo', cell: (r: Void) => <span className="font-mono text-xs">{r.protocol}</span> },
          ]} />
        </div>
      </div>
    </div>
  );
}
