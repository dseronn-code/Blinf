'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Plus, Upload, FileText, Download } from 'lucide-react';
import { useApi, useAction, qs, openFile } from '@/lib/api';
import { PageHeader, SearchBox, Filters, DataTable, Pagination, Chips } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { money, fmtDate } from '@/lib/utils';
import { ORIGIN_LABEL } from '@/lib/labels';

export default function SalesOrders() {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || '');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string[]>([]);
  const act = useAction();
  const { data, isLoading } = useApi<any>(`/api/sales-orders${qs({ q, status, from, to, page })}`);
  const invoiceSelected = async () => {
    for (const id of sel) await act('POST', `/api/sales-orders/${id}/invoice`, {}, false);
    setSel([]);
    (await import('sonner')).toast.success(`${sel.length} pedido(s) processado(s). Veja as notas em Notas fiscais.`);
  };
  return (
    <div>
      <PageHeader title="Pedidos de venda" description="Ciclo: em aberto → faturado → separado → enviado → entregue. Faturamento em 1 clique emite a NF-e e dispara as automações."
        actions={<>
          <Button variant="outline" onClick={() => openFile(`/api/reports/vendas-periodo${qs({ from, to, format: 'xlsx' })}`)}><Download /> Excel</Button>
          <Button variant="outline" asChild><Link href="/cadastros/importacao"><Upload /> Importar</Link></Button>
          <Button asChild><Link href="/vendas/novo"><Plus /> Novo pedido</Link></Button>
        </>} />
      <Filters>
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Cliente, nº ou nº do marketplace" />
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        <Chips value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: '', label: 'Todos' }, { value: 'ABERTO', label: 'Em aberto' }, { value: 'FATURADO', label: 'Faturados' }, { value: 'SEPARADO', label: 'Separados' }, { value: 'ENVIADO', label: 'Enviados' }, { value: 'ENTREGUE', label: 'Entregues' }, { value: 'CANCELADO', label: 'Cancelados' }]} />
        {sel.length > 0 && <Button size="sm" onClick={invoiceSelected}><FileText /> Faturar {sel.length} selecionado(s)</Button>}
      </Filters>
      <DataTable loading={isLoading} rows={data?.rows} selectable selected={sel} onSelect={setSel} onRowClick={(r: any) => router.push(`/vendas/${r.id}`)}
        footer={data && <tr><td colSpan={7} className="px-3 py-2 text-right text-xs">Total filtrado</td><td className="num px-3">{money(data.sum)}</td><td colSpan={2} /></tr>}
        columns={[
          { key: 'number', header: 'Nº', cell: (r: any) => <b>{r.number}</b> },
          { key: 'date', header: 'Data', cell: (r: any) => fmtDate(r.date) },
          { key: 'customer', header: 'Cliente', cell: (r: any) => <div className="max-w-[220px] truncate">{r.customer.name}</div> },
          { key: 'channel', header: 'Canal', cell: (r: any) => <div className="text-xs">{r.channel?.name || ORIGIN_LABEL[r.origin]}{r.externalId && <div className="text-muted-foreground">{r.externalId}</div>}</div> },
          { key: 'seller', header: 'Vendedor', cell: (r: any) => <span className="text-xs">{r.seller?.name || '—'}</span> },
          { key: 'items', header: 'Itens', align: 'right', cell: (r: any) => r._count.items },
          { key: 'flags', header: 'Integrações', cell: (r: any) => <div className="flex gap-1">{r.stockReserved && <Badge tone="blue">reservado</Badge>}{r.stockPosted && <Badge tone="gray">estoque</Badge>}{r.financialPosted && <Badge tone="green">financeiro</Badge>}{r.shipments[0]?.trackingCode && <Badge tone="purple">{r.shipments[0].trackingCode}</Badge>}</div> },
          { key: 'total', header: 'Total', align: 'right', cell: (r: any) => <b>{money(r.total)}</b> },
          { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> },
        ]} />
      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}
