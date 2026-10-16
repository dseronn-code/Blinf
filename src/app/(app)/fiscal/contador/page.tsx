'use client';
import { useState } from 'react';
import { FileText, FileArchive, Download, Mail } from 'lucide-react';
import { openFile, qs } from '@/lib/api';
import { PageHeader, Field, Chips } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function monthRange(offset: number) {
  const now = new Date();
  return { from: ymd(new Date(now.getFullYear(), now.getMonth() + offset, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)) };
}

const FILES = [
  {
    type: 'sped', icon: FileText, title: 'SPED Fiscal — EFD ICMS/IPI', file: 'SPED-EFD-AAAA-MM.txt',
    text: 'Escrituração Fiscal Digital em leiaute pipe (|) com as notas de entrada e saída do período e a apuração do ICMS.',
    regs: [['0000', 'Abertura e identificação da empresa'], ['0150', 'Participantes (clientes e fornecedores)'], ['0200', 'Itens (produtos)'], ['C100', 'Documentos fiscais (NF-e/NFC-e)'], ['C170', 'Itens dos documentos'], ['C190', 'Registro analítico por CST/CFOP/alíquota'], ['E110', 'Apuração do ICMS'], ['9999', 'Encerramento do arquivo']],
  },
  {
    type: 'sintegra', icon: FileText, title: 'Sintegra', file: 'SINTEGRA-AAAA-MM.txt',
    text: 'Arquivo magnético (Convênio ICMS 57/95) em registros de tamanho fixo, ainda exigido por algumas UFs.',
    regs: [['10', 'Mestre do estabelecimento'], ['11', 'Dados complementares'], ['50', 'Notas fiscais (totais por documento)'], ['54', 'Itens das notas'], ['75', 'Códigos de produtos'], ['90', 'Totalização do arquivo']],
  },
];

export default function Contador() {
  const [range, setRange] = useState(monthRange(-1));
  const [preset, setPreset] = useState('prev');
  const valid = !!range.from && !!range.to && range.from <= range.to;
  const dl = (type: string) => openFile(`/api/fiscal/files${qs({ type, from: range.from, to: range.to })}`);
  const choose = (p: string) => { setPreset(p); if (p === 'prev') setRange(monthRange(-1)); if (p === 'cur') setRange(monthRange(0)); };

  return (
    <div>
      <PageHeader title="Arquivos para o contador" description="Gere os arquivos fiscais do período para envio à contabilidade" />
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3">
          <Field label="Período rápido"><Chips value={preset} onChange={choose} options={[{ value: 'prev', label: 'Mês anterior' }, { value: 'cur', label: 'Mês atual' }, { value: 'custom', label: 'Personalizado' }]} /></Field>
          <Field label="De"><Input type="date" value={range.from} onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, from: e.target.value })); }} /></Field>
          <Field label="Até"><Input type="date" value={range.to} onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, to: e.target.value })); }} /></Field>
          {!valid && <span className="text-xs text-red-600">Período inválido</span>}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {FILES.map((f) => (
          <Card key={f.type} className="flex flex-col">
            <CardHeader><CardTitle className="flex items-center gap-2"><f.icon className="h-4 w-4" /> {f.title}</CardTitle></CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3 text-sm">
              <p className="text-muted-foreground">{f.text}</p>
              <div className="space-y-1">
                {f.regs.map(([code, label]) => <div key={code} className="flex items-center gap-2 text-xs"><Badge tone="gray" className="w-12 justify-center font-mono">{code}</Badge><span>{label}</span></div>)}
              </div>
              <div className="mt-auto pt-2"><Button className="w-full" variant="outline" disabled={!valid} onClick={() => dl(f.type)}><Download /> Baixar {f.file.replace('AAAA-MM', range.from.slice(0, 7))}</Button></div>
            </CardContent>
          </Card>
        ))}
        <Card className="flex flex-col border-primary/40">
          <CardHeader><CardTitle className="flex items-center gap-2"><FileArchive className="h-4 w-4" /> Pacote completo (ZIP)</CardTitle></CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3 text-sm">
            <p className="text-muted-foreground">Tudo o que o contador precisa em um único arquivo:</p>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              <li>XMLs das notas emitidas (NF-e, NFC-e e NFS-e) autorizadas e canceladas do período</li>
              <li>XMLs das NF-e de entrada (compras)</li>
              <li>Arquivo SPED Fiscal (EFD ICMS/IPI)</li>
              <li>Arquivo Sintegra</li>
              <li>Resumo com totais de notas e impostos (ICMS, ST, DIFAL, IPI, PIS, COFINS, ISS, IBS/CBS)</li>
            </ul>
            <div className="mt-auto pt-2"><Button className="w-full" disabled={!valid} onClick={() => dl('zip')}><Download /> Baixar pacote ZIP</Button></div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 flex gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Mail className="mt-0.5 h-4 w-4 shrink-0" />
        <div>Envio automático: a automação <b className="font-mono">ENVIAR_DANFE_CLIENTE</b> também envia o XML de cada nota autorizada por e-mail ao contador quando a variável de ambiente <b className="font-mono">ACCOUNTANT_EMAIL</b> está configurada. Confira os arquivos gerados com o validador oficial (PVA da EFD) antes da entrega.</div>
      </div>
    </div>
  );
}
