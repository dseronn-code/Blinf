'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, AlertTriangle, Link2, KeyRound, ExternalLink, Copy, History } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, api } from '@/lib/api';
import { PageHeader, Chips, Filters, Field, DataTable } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea, Switch } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { fmtDateTime } from '@/lib/utils';

const CATS: Record<string, string> = { '': 'Todas', FISCAL: 'Fiscal', PAGAMENTO: 'Pagamentos e bancos', MARKETPLACE: 'Marketplaces', ECOMMERCE: 'Plataformas de e-commerce', LOGISTICA: 'Frete e logística', MENSAGENS: 'E-mail e WhatsApp' };

/**
 * Contas e credenciais (como no Bling): cada empresa conecta as próprias contas.
 * Sem conta conectada, o módulo correspondente continua funcionando em modo simulado.
 */
export default function Page() {
  return <Suspense><IntegrationAccounts /></Suspense>;
}

function IntegrationAccounts() {
  const { data, refetch } = useApi<any[]>('/api/integration-accounts');
  const params = useSearchParams();
  const [cat, setCat] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const [logs, setLogs] = useState<string | null>(null);
  useEffect(() => {
    if (params.get('conectado')) toast.success(`Conta ${params.get('conectado')} conectada`);
    if (params.get('erro')) toast.error(params.get('erro')!);
  }, [params]);
  const list = (data || []).filter((p) => !cat || p.category === cat);
  const connected = (data || []).filter((p) => p.account?.status === 'CONECTADO').length;
  return (
    <div>
      <PageHeader title="Contas e credenciais" description={`Conecte as contas da sua empresa para emitir, cobrar, vender e enviar de verdade. ${connected} conectada(s). Sem conta conectada, o módulo funciona em modo simulado.`} />
      <Filters><Chips value={cat} onChange={setCat} options={Object.entries(CATS).map(([value, label]) => ({ value, label }))} /></Filters>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((p) => {
          const st = p.account?.status || 'DESCONECTADO';
          return (
            <Card key={p.key} className="flex flex-col p-4">
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg text-xs font-black text-white" style={{ background: p.color || '#334155' }}>{p.name.slice(0, 2).toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{p.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{p.account?.accountName || CATS[p.category]}</div>
                </div>
                {st === 'CONECTADO' ? <Badge tone="green"><CheckCircle2 className="mr-1 inline h-3 w-3" />Conectado</Badge> : st === 'ERRO' ? <Badge tone="red"><AlertTriangle className="mr-1 inline h-3 w-3" />Erro</Badge> : <Badge tone="gray">Simulado</Badge>}
              </div>
              <p className="mb-2 text-xs text-muted-foreground">{p.description}</p>
              <ul className="mb-3 flex flex-wrap gap-1">{p.capabilities.map((c: string) => <li key={c} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{c}</li>)}</ul>
              {p.account?.lastError && <p className="mb-2 rounded bg-red-50 p-2 text-[11px] text-red-700">{p.account.lastError}</p>}
              <div className="mt-auto flex gap-2">
                <Button size="sm" className="flex-1" variant={st === 'CONECTADO' ? 'outline' : 'default'} onClick={() => setEdit(p)}>{p.auth === 'OAUTH' ? <Link2 className="mr-1 h-3.5 w-3.5" /> : <KeyRound className="mr-1 h-3.5 w-3.5" />}{st === 'CONECTADO' ? 'Configurar' : 'Conectar'}</Button>
                <Button size="sm" variant="ghost" title="Chamadas e notificações" onClick={() => setLogs(p.key)}><History className="h-4 w-4" /></Button>
              </div>
            </Card>
          );
        })}
      </div>
      {edit && <ConfigDialog p={edit} onClose={() => setEdit(null)} onSaved={() => { refetch(); }} />}
      {logs && <LogsDialog provider={logs} onClose={() => setLogs(null)} />}
    </div>
  );
}

function ConfigDialog({ p, onClose, onSaved }: { p: any; onClose: () => void; onSaved: () => void }) {
  const acc = p.account;
  const [env, setEnv] = useState<string>(acc?.environment || 'SANDBOX');
  const [values, setValues] = useState<Record<string, any>>(() => Object.fromEntries(p.fields.filter((f: any) => !f.secret).map((f: any) => [f.key, acc?.settings?.[f.key] ?? ''])));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r: any = await api(`/api/integration-accounts/${p.key.toLowerCase()}`, { method: 'PUT', json: { environment: env, values, test: p.auth !== 'OAUTH' } });
      if (r.ok === false) toast.error(`Credenciais salvas, mas o teste falhou: ${r.error}`);
      else toast.success(p.auth === 'OAUTH' ? 'Configuração salva' : `Conectado${r.test?.accountName ? `: ${r.test.accountName}` : ''}`);
      onSaved();
      if (r.ok !== false && p.auth !== 'OAUTH') onClose();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };
  const action = async (a: string) => {
    setBusy(true);
    try {
      const r: any = await api(`/api/integration-accounts/${p.key.toLowerCase()}`, { method: 'POST', json: { action: a } });
      toast.success(a === 'test' ? `Conexão OK${r.accountName ? ` — ${r.accountName}` : ''}` : 'Conta desconectada (volta ao modo simulado)');
      onSaved();
      if (a === 'disconnect') onClose();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };
  const copy = (t: string) => { navigator.clipboard.writeText(t); toast.success('Copiado'); };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${p.name} — ${acc?.status === 'CONECTADO' ? 'configuração' : 'conectar conta'}`} description={p.description} size="lg"
      footer={<>
        {acc?.status && acc.status !== 'DESCONECTADO' && <Button variant="ghost" disabled={busy} onClick={() => action('disconnect')}>Desconectar</Button>}
        {acc?.hasToken || acc?.status === 'CONECTADO' ? <Button variant="outline" disabled={busy} onClick={() => action('test')}>Testar conexão</Button> : null}
        {p.auth === 'OAUTH' && <Button variant="outline" disabled={busy} onClick={async () => { await save(); window.location.href = `/api/integration-accounts/${p.key.toLowerCase()}/connect`; }}><Link2 className="mr-1 h-4 w-4" />{acc?.hasToken ? 'Reconectar' : `Conectar com ${p.name}`}</Button>}
        <Button disabled={busy} onClick={save}>{busy ? 'Aguarde…' : p.auth === 'OAUTH' ? 'Salvar' : 'Salvar e testar'}</Button>
      </>}>
      <div className="space-y-4">
        {p.sandbox && (
          <Field label="Ambiente" hint="Use o ambiente de testes (sandbox/homologação) até validar; depois mude para produção.">
            <Select value={env} onChange={(e) => setEnv(e.target.value)}><option value="SANDBOX">Testes (sandbox / homologação)</option><option value="PRODUCAO">Produção</option></Select>
          </Field>
        )}
        {p.auth === 'OAUTH' && (
          <div className="rounded-md border bg-muted/40 p-3 text-xs">
            {p.oauthReady ? <>Clique em <b>Conectar com {p.name}</b>: você será levado à página de autorização e voltará conectado, como no Bling.</> : <><b>Aplicativo da plataforma não configurado.</b> O administrador do GestãoPro precisa cadastrar o app no portal de desenvolvedores do {p.name} e definir as variáveis de ambiente (veja o README). Também é possível informar um app próprio nos campos abaixo.</>}
            {p.redirectUri && <div className="mt-2 flex items-center gap-2">URL de retorno (redirect URI): <code className="rounded bg-background px-1">{p.redirectUri}</code><button onClick={() => copy(p.redirectUri)}><Copy className="h-3 w-3" /></button></div>}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {p.fields.map((f: any) => (
            <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.help} className={f.type === 'textarea' ? 'md:col-span-2' : ''}>
              {f.type === 'select' ? (
                <Select value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>{f.options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
              ) : f.type === 'switch' ? (
                <Switch checked={!!values[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} />
              ) : f.type === 'textarea' ? (
                <Textarea rows={4} placeholder={f.secret && acc?.secrets?.[f.key] ? `${acc.secrets[f.key]} (mantido se vazio)` : f.placeholder} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              ) : (
                <Input type={f.secret ? 'password' : f.type === 'number' ? 'number' : 'text'} autoComplete="off" placeholder={f.secret && acc?.secrets?.[f.key] ? `${acc.secrets[f.key]} (mantido se vazio)` : f.placeholder} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              )}
            </Field>
          ))}
        </div>
        {p.webhookUrl && (
          <div className="rounded-md border p-3 text-xs">
            <div className="mb-1 font-semibold">URL de notificações (webhook)</div>
            <div className="flex items-center gap-2"><code className="break-all rounded bg-muted px-1">{p.webhookUrl}</code><button onClick={() => copy(p.webhookUrl)}><Copy className="h-3 w-3" /></button></div>
            <div className="mt-1 text-muted-foreground">Cadastre esta URL no painel do {p.name} para receber pagamentos, pedidos e atualizações em tempo real. O servidor precisa estar acessível pela internet (HTTPS).</div>
          </div>
        )}
        {acc?.lastCheckAt && <p className="text-xs text-muted-foreground">Última verificação: {fmtDateTime(acc.lastCheckAt)} {acc.lastError ? `— ${acc.lastError}` : ''}</p>}
        {p.docsUrl && <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={p.docsUrl} target="_blank" rel="noreferrer">Documentação oficial do {p.name} <ExternalLink className="h-3 w-3" /></a>}
      </div>
    </Dialog>
  );
}

function LogsDialog({ provider, onClose }: { provider: string; onClose: () => void }) {
  const { data } = useApi<any>(`/api/integration-accounts/calls?provider=${provider}`);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Chamadas e notificações — ${provider}`} size="xl">
      <h4 className="mb-2 text-sm font-semibold">Chamadas à API</h4>
      <DataTable rows={data?.calls || []} empty="Nenhuma chamada registrada" columns={[
        { key: 'createdAt', header: 'Data', cell: (r: any) => fmtDateTime(r.createdAt) },
        { key: 'method', header: 'Método' },
        { key: 'url', header: 'URL', cell: (r: any) => <span className="break-all font-mono text-[11px]">{r.url}</span> },
        { key: 'status', header: 'HTTP', cell: (r: any) => r.error ? <Badge tone="red">{r.error.slice(0, 40)}</Badge> : <Badge tone={r.status < 400 ? 'green' : 'red'}>{r.status}</Badge> },
        { key: 'durationMs', header: 'ms', align: 'right' },
      ]} />
      <h4 className="mb-2 mt-4 text-sm font-semibold">Notificações recebidas</h4>
      <DataTable rows={data?.events || []} empty="Nenhuma notificação recebida" columns={[
        { key: 'createdAt', header: 'Data', cell: (r: any) => fmtDateTime(r.createdAt) },
        { key: 'topic', header: 'Tópico' },
        { key: 'externalId', header: 'Referência' },
        { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> },
        { key: 'error', header: 'Resultado', cell: (r: any) => <span className="text-xs">{r.error}</span> },
      ]} />
    </Dialog>
  );
}
