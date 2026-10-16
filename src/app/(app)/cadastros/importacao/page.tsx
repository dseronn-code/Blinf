'use client';
import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { useAction } from '@/lib/api';
import { PageHeader, DataTable } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const ENTITIES = [
  { key: 'produtos', label: 'Produtos', desc: 'Cria ou atualiza produtos pelo SKU (com estoque inicial opcional)', url: '/api/import/produtos' },
  { key: 'clientes', label: 'Clientes', desc: 'Valida CPF/CNPJ e atualiza contatos existentes', url: '/api/import/clientes' },
  { key: 'fornecedores', label: 'Fornecedores', desc: 'Cadastro de fornecedores', url: '/api/import/fornecedores' },
  { key: 'estoque', label: 'Saldos de estoque', desc: 'Entrada de saldo por SKU e depósito', url: '/api/import/estoque' },
  { key: 'pedidos', label: 'Pedidos de venda', desc: 'Linhas com o mesmo pedido_externo viram um pedido', url: '/api/sales-orders/import' },
];

export default function ImportPage() {
  const [entity, setEntity] = useState(ENTITIES[0]);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any>(null);
  const act = useAction();
  const run = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const r = await act('POST', entity.url, fd, 'Importação processada');
    if (r) setResult(r);
  };
  return (
    <div>
      <PageHeader title="Importação via planilha" description="Importe cadastros, saldos e pedidos a partir de arquivos CSV (separador ; ou ,) ou Excel (.xlsx)" />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit p-2">
          {ENTITIES.map((e) => (
            <button key={e.key} onClick={() => { setEntity(e); setResult(null); }} className={cn('block w-full rounded px-3 py-2 text-left hover:bg-muted', entity.key === e.key && 'bg-accent')}>
              <div className="text-sm font-medium">{e.label}</div>
              <div className="text-xs text-muted-foreground">{e.desc}</div>
            </button>
          ))}
        </Card>
        <div className="space-y-4">
          <Card><CardContent className="space-y-3">
            <div className="text-sm">1. Baixe o modelo e preencha as colunas.</div>
            <Button variant="outline" onClick={() => window.open(`/api/import/${entity.key}`, '_blank')}><Download /> Modelo de {entity.label.toLowerCase()} (.csv)</Button>
            <div className="text-sm">2. Envie o arquivo preenchido (.csv ou .xlsx).</div>
            <div className="flex items-center gap-2"><input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" /><Button onClick={run} disabled={!file}><Upload /> Importar</Button></div>
          </CardContent></Card>
          {result && (
            <div>
              <div className="mb-2 flex gap-2 text-sm"><Badge tone="green">{result.imported} importado(s)</Badge>{!!result.errors && <Badge tone="red">{result.errors} erro(s)</Badge>}</div>
              <DataTable rows={result.results.map((r: any, i: number) => ({ ...r, id: String(i) }))} columns={[{ key: 'line', header: 'Linha / pedido', cell: (r: any) => r.line ?? r.externalId }, { key: 'ok', header: 'Resultado', cell: (r: any) => (r.ok ? <Badge tone="green">OK</Badge> : <Badge tone="red">Erro</Badge>) }, { key: 'message', header: 'Mensagem' }]} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
