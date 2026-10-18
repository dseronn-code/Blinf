'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, ShieldAlert, Upload, Sparkles, Trash2, Send, WifiOff, Info, Activity, Save, AlertTriangle, Loader2 } from 'lucide-react';
import { api, useApi, useAction } from '@/lib/api';
import { PageHeader, Field, KV, useDemoMode } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Select, Switch } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, fmtDate, fmtDoc } from '@/lib/utils';

const MODES: Record<string, [string, string, string]> = {
  SIMULADO: ['SIMULADO', 'gray', 'Sem certificado: o XML é gerado sem assinatura e a autorização é simulada.'],
  ASSINADO: ['ASSINADO', 'green', 'XML assinado com XMLDSig RSA-SHA1 (C14N, enveloped) usando o certificado instalado.'],
  CONTINGENCIA: ['CONTINGÊNCIA', 'orange', 'NFC-e emitidas offline (tpEmis 9) — transmita-as em até 24 h.'],
};

const PROVIDERS = [
  { value: 'SIMULADO', title: 'Simulação', text: 'Autorização simulada, sem envio a órgão nenhum. Ideal para testes e treinamento.' },
  { value: 'SEFAZ', title: 'SEFAZ direta', text: 'Transmissão aos webservices oficiais da sua UF com o certificado A1 instalado (NF-e, NFC-e, MDF-e, NFS-e Nacional, GNRE).' },
  { value: 'FOCUS_NFE', title: 'Focus NFe', text: 'Emissão pela API da Focus NFe (conecte a conta em Integrações → Contas e credenciais).' },
];

type Status = { provider: string; environment?: number; uf?: string; services?: { model: string; authorizer: string; ok: boolean; cStat: string; xMotivo: string; tMed?: number }[]; focus?: { connected: boolean; environment?: string } };

export default function Certificate() {
  const { data: c } = useApi<any>('/api/company');
  const { data: pend } = useApi<any>('/api/invoices?model=NFCE&status=CONTINGENCIA');
  const act = useAction();
  const demoMode = useDemoMode();
  // Em produção não existe autorização simulada: "SIMULADO" significa apenas "sem emissor configurado"
  const providers = demoMode ? PROVIDERS : PROVIDERS.map((p) => (p.value === 'SIMULADO' ? { ...p, title: 'Sem emissor', text: 'Nenhuma nota fiscal é emitida (pedidos podem ser faturados sem nota). Escolha SEFAZ direta ou Focus NFe para emitir.' } : p));
  const [file, setFile] = useState<File | null>(null);
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ fiscalProvider: 'SIMULADO', nfeEnvironment: '2', cscId: '', cscToken: '', ieSt: '' });
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (c) setF({ fiscalProvider: c.fiscalProvider || 'SIMULADO', nfeEnvironment: String(c.nfeEnvironment || 2), cscId: c.cscId || '', cscToken: '', ieSt: Object.entries(c.ieSt || {}).map(([uf, ie]) => `${uf}=${ie}`).join('\n') });
  }, [c]);
  const installed = !!c?.certValidUntil;
  const valid = installed && new Date(c.certValidUntil) > new Date();
  const days = installed ? Math.ceil((new Date(c.certValidUntil).getTime() - Date.now()) / 86400000) : 0;
  const mode = !demoMode && (!c?.sefazMode || c.sefazMode === 'SIMULADO') ? (['SEM CERTIFICADO', 'gray', 'Nenhum certificado instalado: notas não podem ser assinadas nem transmitidas à SEFAZ.'] as [string, string, string]) : MODES[c?.sefazMode] || MODES.SIMULADO;
  const contingency = c?.sefazMode === 'CONTINGENCIA';
  const pending: number = pend?.total ?? 0;
  const real = c?.fiscalProvider && c.fiscalProvider !== 'SIMULADO';
  const production = real && c?.nfeEnvironment === 1;
  const changedToProd = f.fiscalProvider !== 'SIMULADO' && f.nfeEnvironment === '1' && !(c?.nfeEnvironment === 1 && c?.fiscalProvider === f.fiscalProvider);

  const install = async (fd: FormData, msg: string) => {
    setBusy(true);
    const r = await act<{ certName: string; warning?: string | null }>('POST', '/api/company/certificate', fd, msg);
    setBusy(false);
    if (r?.warning) toast.warning(r.warning);
    if (r) { setFile(null); setPwd(''); }
  };
  const upload = () => { const fd = new FormData(); fd.append('file', file!); fd.append('password', pwd); install(fd, 'Certificado instalado — as próximas notas serão assinadas'); };
  const demo = () => { const fd = new FormData(); fd.append('demo', '1'); install(fd, 'Certificado de demonstração gerado (senha demo1234)'); };
  const regularize = async () => {
    setBusy(true);
    const r = await act<{ total: number; authorized: number }>('POST', '/api/fiscal/regularize', {}, false);
    setBusy(false);
    if (r) toast.success(r.total ? `${r.authorized} de ${r.total} NFC-e em contingência autorizada(s)` : 'Nenhuma nota em contingência pendente');
  };
  const saveFiscal = async () => {
    if (changedToProd && !confirm('ATENÇÃO: no ambiente de PRODUÇÃO os documentos emitidos têm VALOR FISCAL e geram obrigações tributárias reais. Cancelamentos só são possíveis dentro do prazo legal. Confirmar a mudança para produção?')) return;
    const ieSt = Object.fromEntries(f.ieSt.split(/\n|;/).map((l) => l.split('=').map((x) => x.trim())).filter(([uf, ie]) => uf && ie).map(([uf, ie]) => [uf.toUpperCase(), ie]));
    setBusy(true);
    await act('PUT', '/api/company/certificate', { fiscalProvider: f.fiscalProvider, nfeEnvironment: Number(f.nfeEnvironment), cscId: f.cscId, ...(f.cscToken ? { cscToken: f.cscToken } : {}), ieSt }, 'Configuração fiscal salva');
    setBusy(false);
    setF((p) => ({ ...p, cscToken: '' }));
  };
  const checkStatus = async () => {
    setChecking(true);
    try {
      setStatus(await api<Status>('/api/fiscal/status'));
    } catch (e) {
      toast.error((e as Error).message);
    }
    setChecking(false);
  };

  return (
    <div>
      <PageHeader title="Certificado digital e emissão" description="Certificado A1, modo de emissão (simulação, SEFAZ direta ou Focus NFe) e ambiente" badge={<Badge tone={production ? 'red' : real ? 'blue' : mode[1]}>{production ? 'PRODUÇÃO' : real ? 'HOMOLOGAÇÃO' : mode[0]}</Badge>} />
      {production ? (
        <div className="mb-4 flex gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><b>Ambiente de PRODUÇÃO ativo:</b> as notas emitidas são transmitidas de verdade e têm <b>valor fiscal</b>. Confira os dados antes de transmitir; erros exigem cancelamento (no prazo legal), carta de correção ou nota de devolução.</div>
        </div>
      ) : (
        <div className="mb-4 flex gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {real ? (
              <><b>Homologação:</b> os documentos são enviados de verdade ao ambiente de testes da SEFAZ{c?.fiscalProvider === 'FOCUS_NFE' ? ' (via Focus NFe)' : ''}, sem valor fiscal. Quando tudo estiver certo, mude para produção.</>
            ) : !demoMode ? (
              <><b>Nenhum emissor fiscal configurado:</b> notas fiscais (NF-e, NFC-e, NFS-e, MDF-e) não podem ser emitidas. Instale o certificado A1 e escolha <b>SEFAZ direta</b>, ou conecte a <b>Focus NFe</b> em Integrações → Contas e credenciais. Enquanto isso, os pedidos podem ser faturados sem nota.</>
            ) : (
              <><b>Simulação:</b> o arquivo .pfx/.p12 é aberto de verdade e, com ele instalado, o XML das notas é <b>realmente assinado</b> (XMLDSig RSA-SHA1); a <b>autorização</b> é simulada. Para emitir de verdade, escolha <b>SEFAZ direta</b> (com um certificado ICP-Brasil) ou <b>Focus NFe</b> abaixo.</>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="md:col-span-2">
          <CardHeader><CardTitle>Emissão de documentos fiscais</CardTitle>{real && <Badge tone={production ? 'red' : 'blue'}>{production ? '1 - Produção' : '2 - Homologação'}</Badge>}</CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 md:grid-cols-3">
              {providers.map((p) => (
                <button key={p.value} type="button" onClick={() => setF((x) => ({ ...x, fiscalProvider: p.value }))} className={cn('rounded-md border p-3 text-left text-xs transition', f.fiscalProvider === p.value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50')}>
                  <div className="mb-1 flex items-center justify-between text-sm font-semibold">{p.title}{c?.fiscalProvider === p.value && <Badge tone="green">atual</Badge>}</div>
                  <div className="text-muted-foreground">{p.text}</div>
                </button>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Ambiente" hint={f.fiscalProvider === 'SIMULADO' ? 'A simulação é sempre homologação' : undefined}>
                <Select value={f.fiscalProvider === 'SIMULADO' ? '2' : f.nfeEnvironment} disabled={f.fiscalProvider === 'SIMULADO'} onChange={(e) => setF((x) => ({ ...x, nfeEnvironment: e.target.value }))}>
                  <option value="2">2 - Homologação (testes, sem valor fiscal)</option>
                  <option value="1">1 - Produção (valor fiscal)</option>
                </Select>
              </Field>
              <Field label="ID do CSC (NFC-e)" hint="Ex.: 000001"><Input value={f.cscId} onChange={(e) => setF((x) => ({ ...x, cscId: e.target.value }))} /></Field>
              <Field label="CSC — código de segurança" hint={c?.hasCscToken ? 'Cadastrado (deixe em branco para manter)' : 'Obtido no portal da SEFAZ da UF'}><Input type="password" autoComplete="new-password" value={f.cscToken} onChange={(e) => setF((x) => ({ ...x, cscToken: e.target.value }))} placeholder={c?.hasCscToken ? '••••••••' : ''} /></Field>
              <Field label="IE de substituto por UF" hint="Uma por linha: RJ=123456. Sem IE na UF de destino, ST/DIFAL geram GNRE.">
                <textarea className="min-h-[38px] w-full rounded-md border bg-background px-2 py-1 text-sm" rows={2} value={f.ieSt} onChange={(e) => setF((x) => ({ ...x, ieSt: e.target.value }))} />
              </Field>
            </div>
            {f.fiscalProvider !== 'SIMULADO' && f.nfeEnvironment === '1' && (
              <div className="flex gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div><b>Produção gera documento com valor fiscal.</b> Cada nota autorizada é válida perante o Fisco, compõe a escrituração da empresa e só pode ser cancelada no prazo legal (24 h para NF-e, 30 min para NFC-e na maioria das UFs).</div>
              </div>
            )}
            {f.fiscalProvider === 'SEFAZ' && !installed && <p className="text-xs text-red-600">Instale o certificado A1 abaixo para usar a SEFAZ direta.</p>}
            {f.fiscalProvider === 'SEFAZ' && !c?.cityCode && <p className="text-xs text-amber-700">Cadastre o código IBGE do município da empresa em Configurações → Empresas (obrigatório no XML).</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={busy} onClick={saveFiscal}><Save /> Salvar configuração</Button>
              <Button variant="outline" disabled={checking || c?.fiscalProvider === 'SIMULADO'} onClick={checkStatus}>{checking ? <Loader2 className="animate-spin" /> : <Activity />} Consultar status da SEFAZ</Button>
              {c?.fiscalProvider === 'SIMULADO' && <span className="text-xs text-muted-foreground">Disponível nos modos SEFAZ direta e Focus NFe</span>}
            </div>
            {status && (
              <div className="rounded-md border p-3 text-xs">
                {status.services ? (
                  <div className="space-y-1">
                    <div className="text-muted-foreground">SEFAZ-{status.uf} · ambiente {status.environment === 1 ? '1 - Produção' : '2 - Homologação'}</div>
                    {status.services.map((s) => (
                      <div key={s.model} className="flex flex-wrap items-center gap-2">
                        <Badge tone={s.ok ? 'green' : 'red'}>{s.model}</Badge>
                        <span className="font-mono">{s.authorizer}</span>
                        <span>{s.cStat ? `${s.cStat} - ` : ''}{s.xMotivo}</span>
                        {!!s.tMed && <span className="text-muted-foreground">tempo médio {s.tMed}s</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>Focus NFe: {status.focus?.connected ? `conta conectada (${status.focus.environment === 'PRODUCAO' ? 'produção' : 'homologação'})` : 'conta não conectada — acesse Integrações → Contas e credenciais'}</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2">{valid ? <ShieldCheck className="h-5 w-5 text-green-600" /> : <ShieldAlert className="h-5 w-5 text-red-600" />} Certificado instalado</CardTitle><Badge tone={mode[1]}>{mode[0]}</Badge></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <KV label="Empresa" value={c?.name} /><KV label="CNPJ" value={fmtDoc(c?.cnpj)} />
            <div className="col-span-2"><KV label="Titular" value={c?.certName || 'Nenhum certificado instalado'} /></div>
            <div className="col-span-2"><KV label="Emissor" value={c?.certIssuer} /></div>
            <KV label="Número de série" value={c?.certSerial ? <span className="break-all font-mono text-xs">{c.certSerial}</span> : '—'} />
            <KV label="Instalado em" value={fmtDate(c?.certUploadedAt)} />
            <KV label="Validade" value={installed ? <span className={days <= 30 ? 'text-red-600' : ''}>{fmtDate(c.certValidUntil)} ({days} dias)</span> : '—'} />
            <KV label="Série NF-e / NFC-e" value={c ? `${c.nfeSeries} / ${c.nfceSeries}` : '—'} />
            <KV label="Ambiente" value={!real ? (demoMode ? '2 - Homologação (simulado)' : '— (sem emissor)') : production ? '1 - Produção' : '2 - Homologação'} />
            <KV label="Arquivo .pfx armazenado" value={c?.hasPfx ? 'Sim' : 'Não'} />
            <p className="col-span-2 text-xs text-muted-foreground">{mode[2]}</p>
            {installed && <Button variant="outline" className="col-span-2" disabled={busy} onClick={() => confirm(demoMode ? 'Remover o certificado? As notas voltarão a ser geradas sem assinatura (modo SIMULADO).' : 'Remover o certificado? Sem certificado não é possível emitir pela SEFAZ direta.') && act('DELETE', '/api/company/certificate', undefined, 'Certificado removido')}><Trash2 /> Remover certificado</Button>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Instalar / renovar certificado</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Field label="Arquivo do certificado (.pfx / .p12)"><input type="file" accept=".pfx,.p12" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" /></Field>
            <Field label="Senha do certificado"><Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" /></Field>
            <Button disabled={!file || busy} onClick={upload}><Upload /> Instalar certificado</Button>
            {demoMode && <div className="border-t pt-3">
              <p className="mb-2 text-xs text-muted-foreground">Não tem um certificado A1 à mão? Gere um certificado <b>autoassinado de demonstração</b> com o nome e CNPJ da empresa (senha <span className="font-mono">demo1234</span>). Ele assina o XML normalmente, mas não é emitido por uma AC ICP-Brasil e <b>não é aceito pela SEFAZ</b>.</p>
              <Button variant="outline" disabled={busy} onClick={demo}><Sparkles /> Gerar certificado de demonstração</Button>
            </div>}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-2"><WifiOff className="h-4 w-4" /> Contingência offline da NFC-e</CardTitle>{contingency && <Badge tone="orange">Contingência ativa</Badge>}</CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-3">
                <Switch checked={contingency} disabled={busy || (!demoMode && !contingency && !(c?.fiscalProvider === 'SEFAZ' && c?.hasPfx))} onChange={(v) => act('PUT', '/api/company/certificate', { contingency: v }, v ? 'Contingência ativada — NFC-e serão emitidas offline' : 'Contingência desativada')} />
                <span className="font-medium">Emitir NFC-e em contingência (tpEmis 9)</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Use quando a SEFAZ ou a internet estiver indisponível. A NFC-e é emitida <b>offline</b> com tpEmis = 9 (QR Code com o DigestValue), o DANFE NFC-e é impresso com a mensagem de contingência e a venda segue normalmente.
                As notas ficam com situação <b>Contingência</b> e devem ser transmitidas à SEFAZ em até <b>24 horas</b> após a emissão. Desative a contingência antes de transmitir.
                Para NF-e, quando a SEFAZ da UF responde fora do ar (108/109), a transmissão segue automaticamente pela SVC (tpEmis 6/7).
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 md:items-end">
              <div className="text-xs text-muted-foreground">NFC-e pendentes de transmissão: <b className="text-foreground">{pending}</b></div>
              <Button disabled={busy || contingency || !pending} onClick={regularize}><Send /> Transmitir notas em contingência</Button>
              {contingency && pending > 0 && <span className="text-[11px] text-orange-700">Desative a contingência para transmitir</span>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
