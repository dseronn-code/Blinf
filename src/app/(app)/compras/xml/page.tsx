'use client';
import { useState } from 'react';
import { Download, Upload, FileCheck2 } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, SimBanner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { money, fmtDate, fmtDoc, num } from '@/lib/utils';
import { formatAccessKey } from '@/lib/br';

export default function XmlImport() {
  const { data, isLoading } = useApi<any>('/api/inbound');
  const { data: whs } = useApi<any>('/api/r/warehouses');
  const act = useAction();
  const [sel, setSel] = useState<any>(null);
  const [wh, setWh] = useState('');
  const upload = async (f: File | undefined) => {
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    await act('POST', '/api/inbound', fd, 'XML importado — revise e lance a nota');
  };
  return (
    <div>
      <PageHeader title="Importar XML de NF-e de entrada" description="Lê o XML do fornecedor (layout 4.00), cadastra fornecedor/produtos quando necessário e gera o recebimento com estoque e contas a pagar (duplicatas)"
        actions={<><Button variant="outline" onClick={() => window.open('/api/inbound/sample', '_blank')}><Download /> Baixar XML de exemplo</Button><label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-white"><Upload className="h-4 w-4" /> Enviar XML<input type="file" accept=".xml" className="hidden" onChange={(e) => upload(e.target.files?.[0])} /></label></>} />
      <SimBanner>o XML de exemplo é gerado com chave de acesso válida (mod 11) a partir dos seus produtos e de um fornecedor cadastrado, simulando o download da SEFAZ/Manifesto do destinatário.</SimBanner>
      <DataTable loading={isLoading} rows={data?.rows} onRowClick={setSel} columns={[
        { key: 'number', header: 'NF-e', cell: (r: any) => <b>{r.number}/{r.series}</b> },
        { key: 'issueDate', header: 'Emissão', cell: (r: any) => fmtDate(r.issueDate) },
        { key: 'supplierName', header: 'Fornecedor', cell: (r: any) => <div>{r.supplierName}<div className="text-xs text-muted-foreground">{fmtDoc(r.supplierCnpj)}</div></div> },
        { key: 'items', header: 'Itens', align: 'right', cell: (r: any) => r.items.length },
        { key: 'match', header: 'Vinculados', cell: (r: any) => { const n = r.items.filter((i: any) => i.productId).length; return <Badge tone={n === r.items.length ? 'green' : 'orange'}>{n}/{r.items.length}</Badge>; } },
        { key: 'total', header: 'Total', align: 'right', cell: (r: any) => money(r.total) },
        { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> },
      ]} />
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)} size="xl" title={`NF-e ${sel?.number} — ${sel?.supplierName}`} description={sel && formatAccessKey(sel.accessKey)} footer={sel?.status === 'PENDENTE' && <>
        <Button variant="outline" onClick={async () => { await act('DELETE', `/api/inbound/${sel.id}`, undefined, 'Nota ignorada'); setSel(null); }}>Ignorar</Button>
        <Select className="w-56" value={wh} onChange={(e) => setWh(e.target.value)}><option value="">Depósito padrão</option>{whs?.rows.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
        <Button onClick={async () => { const r = await act('POST', `/api/inbound/${sel.id}`, { warehouseId: wh || null }, 'NF-e lançada: estoque, contas a pagar e custos atualizados'); if (r) setSel(null); }}><FileCheck2 /> Lançar nota</Button>
      </>}>
        {sel && (
          <div className="space-y-3">
            <DataTable rows={sel.items.map((i: any, k: number) => ({ ...i, id: String(k) }))} columns={[
              { key: 'code', header: 'Cód. forn.' }, { key: 'description', header: 'Descrição' }, { key: 'ncm', header: 'NCM' }, { key: 'cfop', header: 'CFOP' },
              { key: 'quantity', header: 'Qtd', align: 'right', cell: (i: any) => num(i.quantity) }, { key: 'unitPrice', header: 'Unitário', align: 'right', cell: (i: any) => money(i.unitPrice) }, { key: 'total', header: 'Total', align: 'right', cell: (i: any) => money(i.total) },
              { key: 'productId', header: 'Produto no ERP', cell: (i: any) => (i.productId ? <Badge tone="green">vinculado</Badge> : <Badge tone="orange">será cadastrado</Badge>) },
            ]} />
            <Card><CardContent className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              <div>Produtos: <b>{money(sel.productsTotal ?? 0)}</b></div><div>Total da nota: <b>{money(sel.total)}</b></div>
              <div className="md:col-span-2">Duplicatas: {(sel.duplicates || []).map((d: any) => `${d.number} venc. ${fmtDate(d.dueDate)} ${money(d.amount)}`).join(' · ') || 'à vista'}</div>
            </CardContent></Card>
          </div>
        )}
      </Dialog>
    </div>
  );
}
