'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useApi, qs } from '@/lib/api';
import { PageHeader, SearchBox, Filters, DataTable, Chips } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { money, fmtDate } from '@/lib/utils';

export default function Quotes() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const { data, isLoading } = useApi<any>(`/api/quotes${qs({ q, status })}`);
  return (
    <div>
      <PageHeader title="Propostas comerciais / orçamentos" description="Envie propostas em PDF e converta em pedido de venda com 1 clique (ou automaticamente ao aprovar)" actions={<Button asChild><Link href="/vendas/propostas/novo"><Plus /> Nova proposta</Link></Button>} />
      <Filters><SearchBox value={q} onChange={setQ} /><Chips value={status} onChange={setStatus} options={['', 'RASCUNHO', 'ENVIADA', 'APROVADA', 'CONVERTIDA', 'RECUSADA'].map((v) => ({ value: v, label: v ? v.charAt(0) + v.slice(1).toLowerCase() : 'Todas' }))} /></Filters>
      <DataTable loading={isLoading} rows={data?.rows} onRowClick={(r: any) => router.push(`/vendas/propostas/${r.id}`)} columns={[
        { key: 'number', header: 'Nº', cell: (r: any) => <b>{r.number}</b> }, { key: 'date', header: 'Data', cell: (r: any) => fmtDate(r.date) },
        { key: 'customer', header: 'Cliente', cell: (r: any) => r.customer.name }, { key: 'validUntil', header: 'Validade', cell: (r: any) => fmtDate(r.validUntil) },
        { key: 'items', header: 'Itens', align: 'right', cell: (r: any) => r._count.items }, { key: 'total', header: 'Total', align: 'right', cell: (r: any) => money(r.total) },
        { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> },
      ]} />
    </div>
  );
}
