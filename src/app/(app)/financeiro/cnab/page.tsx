'use client';
import { useRef, useState } from 'react';
import { Download, FileUp, Send, FlaskConical, PlayCircle, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, SimBanner, StatCard } from '@/components/common/page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { money, fmtDate } from '@/lib/utils';

type CnabFile = { filename: string; content: string; count?: number };
type RetornoResult = { processed: number; liquidated: number; results: { ourNumber: string; code: string; description: string; contact: string; amount: number; message: string }[] };

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Step({ n, title, children, done }: { n: number; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? 'bg-green-600 text-white' : 'bg-primary text-white'}`}>{n}</span>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">{children}</CardContent>
    </Card>
  );
}

export default function Cnab() {
  const act = useAction();
  const { data, isLoading } = useApi<any>('/api/finance/entries?type=RECEBER&status=EM_ABERTO&pageSize=500');
  const boletos = (data?.rows || []).filter((r: any) => r.paymentMethod === 'BOLETO');
  const [selected, setSelected] = useState<string[]>([]);
  const [remessa, setRemessa] = useState<CnabFile | null>(null);
  const [retorno, setRetorno] = useState<CnabFile | null>(null);
  const [result, setResult] = useState<RetornoResult | null>(null);
  const [busy, setBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const gerarRemessa = async () => {
    setBusy('remessa');
    const r = await act<CnabFile>('POST', '/api/finance/cnab/remessa', selected.length ? { entryIds: selected } : {}, false);
    setBusy('');
    if (!r) return;
    setRemessa(r);
    setRetorno(null);
    setResult(null);
    download(r.filename, r.content);
    toast.success(`Remessa ${r.filename} gerada com ${r.count} boleto(s)`);
  };
  const simularRetorno = async () => {
    if (!remessa) return;
    setBusy('sample');
    const r = await act<CnabFile>('POST', '/api/finance/cnab/sample', { remessa: remessa.content }, false);
    setBusy('');
    if (!r) return;
    setRetorno(r);
    download(r.filename, r.content);
    toast.success('Retorno simulado gerado pelo banco');
  };
  const processar = async (content: string) => {
    setBusy('retorno');
    const r = await act<RetornoResult>('POST', '/api/finance/cnab/retorno', { content }, false);
    setBusy('');
    if (!r) return;
    setResult(r);
    toast.success(`Retorno processado: ${r.processed} ocorrência(s), ${r.liquidated} título(s) baixado(s)`);
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const text = await f.text();
    setRetorno({ filename: f.name, content: text });
    await processar(text);
  };

  return (
    <div>
      <PageHeader title="Remessa e retorno CNAB" description="Cobrança bancária registrada: envie os boletos ao banco pelo arquivo de remessa e baixe os pagos automaticamente com o arquivo de retorno" />
      <SimBanner>o banco é simulado (GestãoPro Bank, código 999). O layout segue o padrão FEBRABAN CNAB 400 e funciona com arquivos de bancos reais mapeados para este layout.</SimBanner>

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Boletos em aberto" value={boletos.length} />
        <StatCard label="Valor em aberto" value={money(boletos.reduce((a: number, r: any) => a + r.amount - r.paidAmount, 0))} tone="blue" />
        <StatCard label="Na última remessa" value={remessa?.count ?? '—'} hint={remessa?.filename} />
        <StatCard label="Baixados no retorno" value={result?.liquidated ?? '—'} tone="green" hint={result ? `${result.processed} ocorrência(s)` : undefined} />
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <Step n={1} title="Gerar remessa" done={!!remessa}>
          <p className="text-muted-foreground">Selecione os boletos abaixo ou deixe sem seleção para enviar <b>todos os boletos em aberto</b>. Títulos sem nosso número recebem um na geração.</p>
          <Button className="w-full" onClick={gerarRemessa} disabled={busy === 'remessa'}><Send /> {selected.length ? `Gerar remessa (${selected.length} selecionado(s))` : 'Gerar remessa (todos)'}</Button>
          {remessa && <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-xs"><span><FileText className="mr-1 inline h-3.5 w-3.5" /><b>{remessa.filename}</b> · {remessa.count} boleto(s)</span><Button size="sm" variant="ghost" onClick={() => download(remessa.filename, remessa.content)}><Download /></Button></div>}
        </Step>
        <Step n={2} title="Simular retorno do banco" done={!!retorno}>
          <p className="text-muted-foreground">O banco simulado devolve um arquivo de retorno com a liquidação de parte dos boletos da remessa (os demais ficam como &quot;entrada confirmada&quot;).</p>
          <Button className="w-full" variant="outline" onClick={simularRetorno} disabled={!remessa || busy === 'sample'}><FlaskConical /> Simular retorno</Button>
          {retorno && <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-xs"><span><FileText className="mr-1 inline h-3.5 w-3.5" /><b>{retorno.filename}</b></span><Button size="sm" variant="ghost" onClick={() => download(retorno.filename, retorno.content)}><Download /></Button></div>}
        </Step>
        <Step n={3} title="Processar retorno" done={!!result}>
          <p className="text-muted-foreground">Importe o arquivo de retorno (.ret/.txt) do banco. Liquidações baixam os títulos na conta bancária automaticamente.</p>
          <input ref={fileRef} type="file" accept=".ret,.txt,.RET,.TXT" className="hidden" onChange={onFile} />
          <div className="flex gap-2">
            <Button className="flex-1" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy === 'retorno'}><FileUp /> Importar arquivo</Button>
            <Button className="flex-1" onClick={() => retorno && processar(retorno.content)} disabled={!retorno || busy === 'retorno'}><PlayCircle /> Processar simulado</Button>
          </div>
        </Step>
      </div>

      {result && (
        <div className="mb-4">
          <h2 className="mb-2 text-sm font-semibold">Resultado do processamento · {result.processed} ocorrência(s), {result.liquidated} baixada(s)</h2>
          <DataTable rows={result.results.map((r, i) => ({ ...r, id: `${r.ourNumber}-${i}` }))} columns={[
            { key: 'ourNumber', header: 'Nosso número', cell: (r: any) => <span className="font-mono text-xs">{r.ourNumber}</span> },
            { key: 'code', header: 'Ocorrência', cell: (r: any) => <Badge tone={['06', '17'].includes(r.code) ? 'green' : r.code === '03' ? 'red' : 'blue'}>{r.code}</Badge> },
            { key: 'description', header: 'Título', cell: (r: any) => r.description || '—' },
            { key: 'contact', header: 'Cliente', cell: (r: any) => r.contact || '—' },
            { key: 'amount', header: 'Valor pago', align: 'right', cell: (r: any) => money(r.amount) },
            { key: 'message', header: 'Mensagem', cell: (r: any) => <span className={r.message.includes('baixado R$') ? 'font-medium text-green-700' : r.message.includes('não encontrado') ? 'text-red-600' : ''}>{r.message}</span> },
          ]} />
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold">Boletos em aberto {selected.length > 0 && <span className="font-normal text-muted-foreground">· {selected.length} selecionado(s) <button className="text-primary underline" onClick={() => setSelected([])}>limpar</button></span>}</h2>
      <DataTable loading={isLoading} rows={boletos} selectable selected={selected} onSelect={setSelected} empty="Nenhum boleto em aberto" columns={[
        { key: 'dueDate', header: 'Vencimento', cell: (r: any) => <span className={r.effectiveStatus === 'VENCIDO' ? 'font-semibold text-red-600' : ''}>{fmtDate(r.dueDate)}</span> },
        { key: 'description', header: 'Descrição', cell: (r: any) => <div className="font-medium">{r.description}</div> },
        { key: 'contactName', header: 'Cliente', cell: (r: any) => r.contactName || '—' },
        { key: 'boletoNumber', header: 'Nosso número', cell: (r: any) => r.boletoNumber ? <span className="font-mono text-xs">{r.boletoNumber}</span> : <span className="text-xs text-muted-foreground">gerado na remessa</span> },
        { key: 'open', header: 'Em aberto', align: 'right', cell: (r: any) => <b>{money(r.amount - r.paidAmount)}</b> },
      ]} />
    </div>
  );
}
