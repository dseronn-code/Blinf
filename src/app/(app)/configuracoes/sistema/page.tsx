'use client';
import { useState } from 'react';
import { Play, RotateCcw, RefreshCw, Send, Activity, Database, ListChecks, AlertTriangle, Clock, Server } from 'lucide-react';
import { useApi, useAction, qs } from '@/lib/api';
import { PageHeader, DataTable, StatCard, Filters, SearchBox, KV } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fmtDateTime } from '@/lib/utils';

const OUT_TONE: Record<string, [string, string]> = { PENDENTE: ['Pendente', 'yellow'], ENVIADO: ['Enviado', 'green'], SIMULADO: ['Simulado', 'blue'], ERRO: ['Erro', 'red'] };
const JOB_TONE: Record<string, [string, string]> = { PENDENTE: ['Pendente', 'yellow'], PROCESSANDO: ['Processando', 'blue'], CONCLUIDO: ['Concluído', 'green'], ERRO: ['Erro', 'red'] };
const tone = (map: Record<string, [string, string]>, s: string) => <Badge tone={map[s]?.[1] || 'gray'}>{map[s]?.[0] || s}</Badge>;

function fmtUptime(s?: number) {
  if (s == null) return '—';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}min`].filter(Boolean).join(' ');
}

function Audit() {
  const [q, setQ] = useState('');
  const { data, isLoading } = useApi<any[]>(`/api/system/audit${qs({ q, take: 300 })}`);
  const [sel, setSel] = useState<any>(null);
  return (
    <>
      <Filters><SearchBox value={q} onChange={setQ} placeholder="Ação, entidade ou detalhe…" /><span className="text-xs text-muted-foreground">Últimos 300 registros de alterações feitas por usuários e integrações.</span></Filters>
      <DataTable loading={isLoading} rows={data} onRowClick={setSel} empty="Nenhum registro de auditoria" columns={[
        { key: 'createdAt', header: 'Data/hora', className: 'whitespace-nowrap', cell: (r: any) => fmtDateTime(r.createdAt) },
        { key: 'user', header: 'Usuário' },
        { key: 'action', header: 'Ação', cell: (r: any) => <code className="text-xs">{r.action}</code> },
        { key: 'entity', header: 'Entidade', cell: (r: any) => (r.entity ? <Badge tone="gray">{r.entity}</Badge> : '—') },
        { key: 'details', header: 'Detalhes', cell: (r: any) => <span className="line-clamp-1 max-w-md text-xs text-muted-foreground">{r.details || ''}</span> },
      ]} />
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)} title="Registro de auditoria" size="lg">
        {sel && <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KV label="Data/hora" value={fmtDateTime(sel.createdAt)} /><KV label="Usuário" value={sel.user} /><KV label="Entidade" value={sel.entity} /><KV label="ID" value={sel.entityId} />
          </div>
          <KV label="Ação" value={<code className="text-xs">{sel.action}</code>} />
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{prettyJson(sel.details)}</pre>
        </div>}
      </Dialog>
    </>
  );
}

function prettyJson(s?: string | null) {
  if (!s) return '—';
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

function Outbox() {
  const [q, setQ] = useState('');
  const { data, isLoading } = useApi<any[]>(`/api/system/outbox${qs({ q })}`);
  const act = useAction();
  const [sel, setSel] = useState<any>(null);
  const resend = async (id: string) => {
    const r = await act('POST', '/api/system/outbox', { action: 'resend', id }, 'Mensagem reenviada para a fila');
    if (r) setSel(null);
  };
  return (
    <>
      <div className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Todas as mensagens enviadas pelo sistema (NF-e, boletos, cobranças, convites, redefinição de senha…) ficam registradas aqui.
        <b> E-mails</b> são enviados via SMTP quando a variável <code>SMTP_HOST</code> está configurada; caso contrário são registrados como <Badge tone="blue">Simulado</Badge>.
        Mensagens de <b>WhatsApp</b> são sempre simuladas.
      </div>
      <Filters><SearchBox value={q} onChange={setQ} placeholder="Destinatário ou assunto…" /></Filters>
      <DataTable loading={isLoading} rows={data} onRowClick={setSel} empty="Nenhuma mensagem na caixa de saída" columns={[
        { key: 'createdAt', header: 'Data/hora', className: 'whitespace-nowrap', cell: (r: any) => fmtDateTime(r.createdAt) },
        { key: 'channel', header: 'Canal', cell: (r: any) => <Badge tone={r.channel === 'EMAIL' ? 'purple' : 'teal'}>{r.channel === 'EMAIL' ? 'E-mail' : 'WhatsApp'}</Badge> },
        { key: 'to', header: 'Destinatário' },
        { key: 'subject', header: 'Assunto', cell: (r: any) => <span className="line-clamp-1">{r.subject || '—'}</span> },
        { key: 'status', header: 'Situação', cell: (r: any) => <span title={r.error || ''}>{tone(OUT_TONE, r.status)}</span> },
        { key: 'sentAt', header: 'Enviado em', className: 'whitespace-nowrap', cell: (r: any) => fmtDateTime(r.sentAt) },
        { key: 'a', header: '', align: 'right', cell: (r: any) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); resend(r.id); }}><Send /> Reenviar</Button> },
      ]} />
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)} title={sel?.subject || 'Mensagem'} size="lg" footer={sel && <Button onClick={() => resend(sel.id)}><Send /> Reenviar</Button>}>
        {sel && <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KV label="Canal" value={sel.channel === 'EMAIL' ? 'E-mail' : 'WhatsApp'} /><KV label="Para" value={sel.to} /><KV label="Situação" value={tone(OUT_TONE, sel.status)} /><KV label="Enviado em" value={fmtDateTime(sel.sentAt)} />
          </div>
          {sel.related && <KV label="Relacionado a" value={sel.related} />}
          {sel.error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{sel.error}</div>}
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded border bg-muted/40 p-3 font-sans text-sm">{sel.body}</pre>
        </div>}
      </Dialog>
    </>
  );
}

function Jobs() {
  const { data, isLoading } = useApi<any>('/api/system/jobs');
  const act = useAction();
  const [sel, setSel] = useState<any>(null);
  const s = data?.stats || {};
  const run = async (action: 'run' | 'retry', id?: string) => {
    const r = await act<any>('POST', '/api/system/jobs', { action, ...(id ? { id } : {}) }, false);
    if (r) (await import('sonner')).toast.success(`${r.processed ?? 0} tarefa(s) processada(s)`);
  };
  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Pendentes" value={s.PENDENTE || 0} tone="amber" icon={Clock} />
        <StatCard label="Processando" value={s.PROCESSANDO || 0} tone="blue" icon={Activity} />
        <StatCard label="Concluídas" value={s.CONCLUIDO || 0} tone="green" icon={ListChecks} />
        <StatCard label="Com erro" value={s.ERRO || 0} tone="red" icon={AlertTriangle} />
      </div>
      <Filters>
        <Button onClick={() => run('run')}><Play /> Processar agora</Button>
        <Button variant="outline" disabled={!s.ERRO} onClick={() => run('retry')}><RotateCcw /> Reprocessar com erro</Button>
        <span className="text-xs text-muted-foreground">Tarefas em segundo plano (envio de mensagens, sincronizações, webhooks) executadas pelo worker com novas tentativas automáticas.</span>
      </Filters>
      <DataTable loading={isLoading} rows={data?.rows} onRowClick={setSel} empty="Fila vazia" columns={[
        { key: 'createdAt', header: 'Criada em', className: 'whitespace-nowrap', cell: (r: any) => fmtDateTime(r.createdAt) },
        { key: 'type', header: 'Tipo', cell: (r: any) => <code className="text-xs">{r.type}</code> },
        { key: 'status', header: 'Situação', cell: (r: any) => tone(JOB_TONE, r.status) },
        { key: 'attempts', header: 'Tentativas', align: 'right', cell: (r: any) => `${r.attempts}/${r.maxAttempts}` },
        { key: 'runAt', header: 'Executar em', className: 'whitespace-nowrap', cell: (r: any) => fmtDateTime(r.runAt) },
        { key: 'doneAt', header: 'Concluída em', className: 'whitespace-nowrap', cell: (r: any) => fmtDateTime(r.doneAt) },
        { key: 'lastError', header: 'Último erro', cell: (r: any) => <span className="line-clamp-1 max-w-xs text-xs text-red-700">{r.lastError || ''}</span> },
        { key: 'a', header: '', align: 'right', cell: (r: any) => r.status === 'ERRO' && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); run('retry', r.id); }}><RotateCcw /> Reprocessar</Button> },
      ]} />
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)} title={`Tarefa ${sel?.type || ''}`} size="lg" footer={sel?.status === 'ERRO' && <Button onClick={async () => { await run('retry', sel.id); setSel(null); }}><RotateCcw /> Reprocessar</Button>}>
        {sel && <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KV label="Situação" value={tone(JOB_TONE, sel.status)} /><KV label="Tentativas" value={`${sel.attempts}/${sel.maxAttempts}`} /><KV label="Executar em" value={fmtDateTime(sel.runAt)} /><KV label="Concluída em" value={fmtDateTime(sel.doneAt)} />
          </div>
          {sel.lastError && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{sel.lastError}</div>}
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{typeof sel.payload === 'string' ? prettyJson(sel.payload) : JSON.stringify(sel.payload, null, 2)}</pre>
        </div>}
      </Dialog>
    </>
  );
}

function Health() {
  const { data, isLoading, refetch, isFetching, dataUpdatedAt, error } = useApi<any>('/api/health', { refetchInterval: 10_000 });
  const ok = data?.status === 'ok';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {isLoading ? <Badge tone="gray">Verificando…</Badge> : ok ? <Badge tone="green">Sistema operacional</Badge> : <Badge tone="red">Problema detectado</Badge>}
        <span className="text-xs text-muted-foreground">Atualiza automaticamente a cada 10 s{dataUpdatedAt ? ` · última verificação ${new Date(dataUpdatedAt).toLocaleTimeString('pt-BR')}` : ''}</span>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={isFetching ? 'animate-spin' : ''} /> Verificar agora</Button>
      </div>
      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">Falha na verificação: {(error as Error).message}</div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Banco de dados" value={data?.database === 'ok' ? 'OK' : data?.database || '—'} tone={data?.database === 'ok' ? 'green' : 'red'} icon={Database} hint={data?.latencyMs != null ? `latência ${data.latencyMs} ms` : undefined} />
        <StatCard label="Worker (tarefas)" value={data?.worker || '—'} tone={data?.worker === 'ativo' ? 'green' : 'amber'} icon={Server} />
        <StatCard label="Fila: pendentes / com erro" value={data?.jobs ? `${data.jobs.pending} / ${data.jobs.failed}` : '—'} tone={data?.jobs?.failed ? 'red' : 'default'} icon={ListChecks} />
        <StatCard label="Tempo no ar" value={fmtUptime(data?.uptime)} icon={Clock} hint={data?.version ? `versão ${data.version}` : undefined} />
      </div>
      <Card><CardHeader><CardTitle>Endpoint de monitoramento</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">Use <code className="rounded bg-muted px-1">GET /api/health</code> (público, sem autenticação) em Docker, Kubernetes ou ferramentas de uptime. Retorna HTTP 200 quando tudo está OK e 503 quando o banco de dados está indisponível.</p>
        <pre className="max-h-64 overflow-auto rounded bg-muted p-3 text-xs">{data ? JSON.stringify(data, null, 2) : '—'}</pre>
      </CardContent></Card>
    </div>
  );
}

export default function SystemPage() {
  return (
    <div>
      <PageHeader title="Sistema" description="Auditoria, mensagens enviadas, fila de tarefas e saúde da aplicação" />
      <Tabs defaultValue="auditoria">
        <TabsList>
          <TabsTrigger value="auditoria">Auditoria</TabsTrigger>
          <TabsTrigger value="outbox">Caixa de saída</TabsTrigger>
          <TabsTrigger value="jobs">Fila de tarefas</TabsTrigger>
          <TabsTrigger value="saude">Saúde</TabsTrigger>
        </TabsList>
        <TabsContent value="auditoria"><Audit /></TabsContent>
        <TabsContent value="outbox"><Outbox /></TabsContent>
        <TabsContent value="jobs"><Jobs /></TabsContent>
        <TabsContent value="saude"><Health /></TabsContent>
      </Tabs>
    </div>
  );
}
