'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, ShieldAlert, Upload, Sparkles, Trash2, Send, WifiOff, Info } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, Field, KV } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Switch } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtDate, fmtDoc } from '@/lib/utils';

const MODES: Record<string, [string, string, string]> = {
  SIMULADO: ['SIMULADO', 'gray', 'Sem certificado: o XML é gerado sem assinatura e a autorização é simulada.'],
  ASSINADO: ['ASSINADO', 'green', 'XML assinado com XMLDSig RSA-SHA1 (C14N, enveloped) usando o certificado instalado.'],
  CONTINGENCIA: ['CONTINGÊNCIA', 'orange', 'NFC-e emitidas offline (tpEmis 9) — transmita-as em até 24 h.'],
};

export default function Certificate() {
  const { data: c } = useApi<any>('/api/company');
  const { data: pend } = useApi<any>('/api/invoices?model=NFCE&status=CONTINGENCIA');
  const act = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const installed = !!c?.certValidUntil;
  const valid = installed && new Date(c.certValidUntil) > new Date();
  const days = installed ? Math.ceil((new Date(c.certValidUntil).getTime() - Date.now()) / 86400000) : 0;
  const mode = MODES[c?.sefazMode] || MODES.SIMULADO;
  const contingency = c?.sefazMode === 'CONTINGENCIA';
  const pending: number = pend?.total ?? 0;

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

  return (
    <div>
      <PageHeader title="Certificado digital A1" description="Usado para assinar o XML de NF-e e NFC-e" badge={<Badge tone={mode[1]}>{mode[0]}</Badge>} />
      <div className="mb-4 flex gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <b>Como funciona aqui:</b> o arquivo .pfx/.p12 é aberto de verdade (senha, titular, CNPJ, série e validade) e, com ele instalado, o XML das notas é <b>realmente assinado</b> (XMLDSig RSA-SHA1) e validado.
          A <b>autorização</b>, porém, é simulada: a transmissão real à SEFAZ exige integração com os webservices de cada UF usando um certificado ICP-Brasil válido, o que não é feito nesta demonstração. Nenhum documento tem valor fiscal.
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
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
            <KV label="Ambiente" value="2 - Homologação (simulado)" />
            <KV label="Arquivo .pfx armazenado" value={c?.hasPfx ? 'Sim' : 'Não'} />
            <p className="col-span-2 text-xs text-muted-foreground">{mode[2]}</p>
            {installed && <Button variant="outline" className="col-span-2" disabled={busy} onClick={() => confirm('Remover o certificado? As notas voltarão a ser geradas sem assinatura (modo SIMULADO).') && act('DELETE', '/api/company/certificate', undefined, 'Certificado removido')}><Trash2 /> Remover certificado</Button>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Instalar / renovar certificado</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Field label="Arquivo do certificado (.pfx / .p12)"><input type="file" accept=".pfx,.p12" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" /></Field>
            <Field label="Senha do certificado"><Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" /></Field>
            <Button disabled={!file || busy} onClick={upload}><Upload /> Instalar certificado</Button>
            <div className="border-t pt-3">
              <p className="mb-2 text-xs text-muted-foreground">Não tem um certificado A1 à mão? Gere um certificado <b>autoassinado de demonstração</b> com o nome e CNPJ da empresa (senha <span className="font-mono">demo1234</span>). Ele assina o XML normalmente, mas não é emitido por uma AC ICP-Brasil.</p>
              <Button variant="outline" disabled={busy} onClick={demo}><Sparkles /> Gerar certificado de demonstração</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-2"><WifiOff className="h-4 w-4" /> Contingência offline da NFC-e</CardTitle>{contingency && <Badge tone="orange">Contingência ativa</Badge>}</CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-3">
                <Switch checked={contingency} disabled={busy} onChange={(v) => act('PUT', '/api/company/certificate', { contingency: v }, v ? 'Contingência ativada — NFC-e serão emitidas offline' : 'Contingência desativada')} />
                <span className="font-medium">Emitir NFC-e em contingência (tpEmis 9)</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Use quando a SEFAZ ou a internet estiver indisponível. A NFC-e é emitida <b>offline</b> com tpEmis = 9, o DANFE NFC-e é impresso com a mensagem de contingência e a venda segue normalmente.
                As notas ficam com situação <b>Contingência</b> e devem ser transmitidas à SEFAZ em até <b>24 horas</b> após a emissão. Desative a contingência antes de transmitir.
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
