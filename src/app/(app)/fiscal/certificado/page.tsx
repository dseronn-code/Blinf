'use client';
import { useState } from 'react';
import { ShieldCheck, ShieldAlert, Upload } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, Field, KV, SimBanner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtDate, fmtDoc } from '@/lib/utils';

export default function Certificate() {
  const { data: c } = useApi<any>('/api/company');
  const act = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [pwd, setPwd] = useState('');
  const valid = c?.certValidUntil && new Date(c.certValidUntil) > new Date();
  const days = c?.certValidUntil ? Math.ceil((new Date(c.certValidUntil).getTime() - Date.now()) / 86400000) : 0;
  return (
    <div>
      <PageHeader title="Certificado digital A1" description="Necessário para assinar e transmitir NF-e, NFC-e e NFS-e" />
      <SimBanner>o certificado é apenas validado quanto ao formato (.pfx/.p12) e senha; a assinatura do XML é simulada. Remova o certificado para ver a rejeição 280 da SEFAZ.</SimBanner>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle className="flex items-center gap-2">{valid ? <ShieldCheck className="h-5 w-5 text-green-600" /> : <ShieldAlert className="h-5 w-5 text-red-600" />} Certificado instalado</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <KV label="Empresa" value={c?.name} /><KV label="CNPJ" value={fmtDoc(c?.cnpj)} />
            <KV label="Titular" value={c?.certName || 'Nenhum certificado'} /><KV label="Emissor" value={c?.certIssuer} />
            <KV label="Instalado em" value={fmtDate(c?.certUploadedAt)} /><KV label="Validade" value={c?.certValidUntil ? `${fmtDate(c.certValidUntil)} (${days} dias)` : '—'} />
            <KV label="Ambiente" value="2 - Homologação (simulado)" /><KV label="Série NF-e / NFC-e" value={`${c?.nfeSeries} / ${c?.nfceSeries}`} />
            {c?.certValidUntil && <Button variant="outline" className="col-span-2" onClick={() => confirm('Remover certificado?') && act('DELETE', '/api/company/certificate', undefined, 'Certificado removido')}>Remover certificado</Button>}
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle>Instalar / renovar certificado</CardTitle></CardHeader><CardContent className="space-y-3">
          <Field label="Arquivo do certificado (.pfx / .p12)"><input type="file" accept=".pfx,.p12" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" /></Field>
          <Field label="Senha do certificado"><Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} /></Field>
          <Button disabled={!file} onClick={async () => { const fd = new FormData(); fd.append('file', file!); fd.append('password', pwd); await act('POST', '/api/company/certificate', fd, 'Certificado instalado'); }}><Upload /> Instalar certificado</Button>
          <p className="text-xs text-muted-foreground">Dica: qualquer arquivo com extensão .pfx funciona na demonstração (ex.: renomeie um arquivo de texto).</p>
        </CardContent></Card>
      </div>
    </div>
  );
}
