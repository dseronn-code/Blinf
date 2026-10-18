'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CloudDownload, MoreHorizontal, Eye, CheckCircle2, HelpCircle, Ban, FileCode, PackagePlus, ExternalLink, Loader2 } from 'lucide-react';
import { useApi, useAction, openFile } from '@/lib/api';
import { PageHeader, DataTable, StatCard, Filters, Chips, SimBanner, useDemoMode } from '@/components/common/page';
import { PromptDialog } from '@/components/common/prompt';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown';
import { money, fmtDate, fmtDoc } from '@/lib/utils';
import { formatAccessKey } from '@/lib/br';

type Status = 'SEM_MANIFESTACAO' | 'CIENCIA' | 'CONFIRMADA' | 'DESCONHECIDA' | 'NAO_REALIZADA';
type Doc = { id: string; accessKey: string; number: string; issuerName: string; issuerCnpj: string; issueDate: string; total: number; status: Status; inboundId: string | null; createdAt: string };

const STATUS: Record<Status, [string, string]> = {
  SEM_MANIFESTACAO: ['Sem manifestação', 'yellow'],
  CIENCIA: ['Ciência', 'blue'],
  CONFIRMADA: ['Confirmada', 'green'],
  DESCONHECIDA: ['Desconhecida', 'red'],
  NAO_REALIZADA: ['Não realizada', 'gray'],
};

const EVENTS = [
  { code: '210210', label: 'Ciência da Operação', text: 'Reconhece que a nota existe, sem confirmar a operação. Libera o download do XML completo.' },
  { code: '210200', label: 'Confirmação da Operação', text: 'Confirma que a operação ocorreu e a mercadoria foi recebida. Conclusiva.' },
  { code: '210220', label: 'Desconhecimento da Operação', text: 'Declara que a empresa não reconhece a operação (possível uso indevido do CNPJ). Conclusiva.' },
  { code: '210240', label: 'Operação não Realizada', text: 'A operação foi reconhecida, mas não aconteceu (ex.: mercadoria recusada). Exige justificativa. Conclusiva.' },
];

const EVENT_CODE: Partial<Record<Status, string>> = { CIENCIA: '210210', CONFIRMADA: '210200', DESCONHECIDA: '210220', NAO_REALIZADA: '210240' };

const conclusive = (s: Status) => ['CONFIRMADA', 'DESCONHECIDA', 'NAO_REALIZADA'].includes(s);
const canDownload = (s: Status) => s === 'CIENCIA' || s === 'CONFIRMADA';

export default function Manifestacao() {
  const act = useAction();
  const { data, isLoading } = useApi<Doc[]>('/api/fiscal/distribution');
  const { data: company } = useApi<{ fiscalProvider?: string }>('/api/company');
  const demo = useDemoMode();
  // Em produção a consulta só existe pela SEFAZ (certificado A1) ou pela Focus NFe
  const canConsult = demo || (!!company && ['SEFAZ', 'FOCUS_NFE'].includes(company.fiscalProvider || ''));
  const [status, setStatus] = useState<'' | Status>('');
  const [busy, setBusy] = useState(false);
  const [notDone, setNotDone] = useState<Doc | null>(null);

  const rows = useMemo(() => (data || []).filter((d) => !status || d.status === status), [data, status]);
  const pending = (data || []).filter((d) => d.status === 'SEM_MANIFESTACAO');
  const count = (s: Status) => (data || []).filter((d) => d.status === s).length;

  const consult = async () => {
    setBusy(true);
    const r = await act<{ found: number }>('POST', '/api/fiscal/distribution', { count: 3 }, false);
    setBusy(false);
    if (r) {
      toast.success(r.found ? `${r.found} nova(s) NF-e encontrada(s) contra o seu CNPJ` : 'Nenhum documento novo na SEFAZ');
    }
  };
  const doManifest = (d: Doc, s: Status, justification?: string) =>
    act('POST', `/api/fiscal/distribution/${d.id}/manifest`, { status: s, justification }, `Evento ${EVENT_CODE[s]} registrado: ${STATUS[s][0]}`);

  return (
    <div>
      <PageHeader title="Manifestação do destinatário" description="NF-e emitidas por fornecedores contra o CNPJ da empresa (Distribuição DF-e)"
        actions={canConsult ? <Button onClick={consult} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <CloudDownload />} Consultar SEFAZ</Button> : <Link href="/fiscal/certificado"><Button variant="outline">Configurar emissor fiscal</Button></Link>} />
      {!canConsult && company && <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">A consulta das NF-e emitidas contra o seu CNPJ é feita na SEFAZ (Distribuição DF-e) com o certificado A1 ou pela Focus NFe. Configure em Notas fiscais → Certificado (SEFAZ direta) ou em Integrações → Contas e credenciais (Focus NFe).</div>}
      <SimBanner>a consulta à Distribuição DF-e do Ambiente Nacional é simulada: cada consulta gera NF-e fictícias de fornecedores emitidas contra o seu CNPJ. Os eventos de manifestação são registrados localmente, sem envio à SEFAZ.</SimBanner>

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Pendentes de manifestação" value={pending.length} tone={pending.length ? 'amber' : 'default'} hint={money(pending.reduce((s, d) => s + d.total, 0))} />
        <StatCard label="Valor total dos documentos" value={money((data || []).reduce((s, d) => s + d.total, 0))} hint={`${data?.length || 0} documento(s)`} />
        <StatCard label="Confirmadas" value={count('CONFIRMADA')} tone="green" />
        <StatCard label="Importadas para compras" value={(data || []).filter((d) => d.inboundId).length} tone="blue" />
      </div>

      <Filters>
        <Chips value={status} onChange={setStatus} options={[
          { value: '', label: `Todas (${data?.length || 0})` },
          ...(Object.keys(STATUS) as Status[]).map((s) => ({ value: s, label: `${STATUS[s][0]} (${count(s)})` })),
        ]} />
      </Filters>

      <DataTable loading={isLoading} rows={rows} empty="Nenhum documento. Clique em “Consultar SEFAZ” para buscar NF-e emitidas contra o seu CNPJ." columns={[
        { key: 'number', header: 'Número', cell: (r: Doc) => <b>{r.number}</b> },
        { key: 'issueDate', header: 'Emissão', cell: (r: Doc) => fmtDate(r.issueDate) },
        { key: 'issuer', header: 'Emitente', cell: (r: Doc) => <div><div className="max-w-[240px] truncate">{r.issuerName}</div><div className="text-xs text-muted-foreground">{fmtDoc(r.issuerCnpj)}</div></div> },
        { key: 'accessKey', header: 'Chave de acesso', cell: (r: Doc) => <span className="font-mono text-[10px]">{formatAccessKey(r.accessKey)}</span> },
        { key: 'total', header: 'Valor', align: 'right', cell: (r: Doc) => money(r.total) },
        { key: 'status', header: 'Situação', cell: (r: Doc) => <Badge tone={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0] || r.status}</Badge> },
        { key: 'inbound', header: 'Compras', cell: (r: Doc) => r.inboundId ? <Link href="/compras/xml" className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><ExternalLink className="h-3 w-3" /> Importada</Link> : <span className="text-xs text-muted-foreground">—</span> },
        { key: 'actions', header: '', align: 'right', cell: (r: Doc) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Manifestar</DropdownMenuLabel>
              <DropdownMenuItem disabled={r.status !== 'SEM_MANIFESTACAO'} onSelect={() => doManifest(r, 'CIENCIA')}><Eye /> Ciência da operação</DropdownMenuItem>
              <DropdownMenuItem disabled={conclusive(r.status)} onSelect={() => doManifest(r, 'CONFIRMADA')}><CheckCircle2 /> Confirmar operação</DropdownMenuItem>
              <DropdownMenuItem disabled={conclusive(r.status)} onSelect={() => confirm('Desconhecer esta operação? O evento é conclusivo.') && doManifest(r, 'DESCONHECIDA')}><HelpCircle /> Desconhecer</DropdownMenuItem>
              <DropdownMenuItem disabled={conclusive(r.status)} onSelect={() => setNotDone(r)}><Ban /> Operação não realizada</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!canDownload(r.status)} onSelect={() => openFile(`/api/fiscal/distribution/${r.id}/xml`)}><FileCode /> Baixar XML</DropdownMenuItem>
              <DropdownMenuItem disabled={!canDownload(r.status) || !!r.inboundId} onSelect={async () => { await act('POST', `/api/fiscal/distribution/${r.id}/import`, {}, 'XML importado — confira em Compras › Importar XML'); }}><PackagePlus /> Importar para compras</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) },
      ]} />

      <Card className="mt-4">
        <CardHeader><CardTitle>Eventos de manifestação</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
          {EVENTS.map((e) => (
            <div key={e.code}>
              <div className="flex items-center gap-2"><Badge tone="purple">{e.code}</Badge><b>{e.label}</b></div>
              <p className="mt-1 text-xs text-muted-foreground">{e.text}</p>
            </div>
          ))}
          <p className="text-xs text-muted-foreground md:col-span-2 xl:col-span-4">O XML completo só pode ser baixado após Ciência ou Confirmação. Depois de um evento conclusivo (Confirmação, Desconhecimento ou Não realizada) não é possível registrar outra manifestação.</p>
        </CardContent>
      </Card>

      <PromptDialog open={!!notDone} onOpenChange={(o) => !o && setNotDone(null)} destructive title="Operação não realizada (210240)" description={notDone ? `NF-e ${notDone.number} — ${notDone.issuerName}` : undefined}
        label="Justificativa (mínimo 15 caracteres)" minLength={15} confirmText="Registrar evento" onConfirm={async (text) => { if (notDone) await doManifest(notDone, 'NAO_REALIZADA', text.trim()); }} />
    </div>
  );
}
