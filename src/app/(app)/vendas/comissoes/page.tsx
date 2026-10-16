'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, Chips, Filters } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { money, fmtDate } from '@/lib/utils';

export default function Commissions() {
  const [status, setStatus] = useState('');
  const { data, isLoading } = useApi<any>(`/api/commissions${status ? `?status=${status}` : ''}`);
  const act = useAction();
  return (
    <div>
      <PageHeader title="Comissões de vendedores" description="Calculadas automaticamente no faturamento; liberadas no faturamento ou no recebimento conforme o cadastro do vendedor" />
      <DataTable rows={data?.summary.map((s: any) => ({ ...s, id: s.sellerId }))} columns={[
        { key: 'seller', header: 'Vendedor' }, { key: 'rate', header: '% / base', cell: (r: any) => `${r.rate}% · ${r.base === 'RECEBIMENTO' ? 'recebimento' : 'faturamento'}` },
        { key: 'pending', header: 'Pendente', align: 'right', cell: (r: any) => money(r.pending) }, { key: 'released', header: 'Liberada (a pagar)', align: 'right', cell: (r: any) => <b className="text-blue-700">{money(r.released)}</b> }, { key: 'paid', header: 'Paga', align: 'right', cell: (r: any) => money(r.paid) },
        { key: 'a', header: '', align: 'right', cell: (r: any) => r.released > 0 && <Button size="sm" onClick={() => act('POST', '/api/commissions', { sellerId: r.sellerId }, 'Comissões fechadas — conta a pagar gerada')}>Fechar e gerar conta a pagar</Button> },
      ]} />
      <div className="mt-4"><Filters><Chips value={status} onChange={setStatus} options={[{ value: '', label: 'Todas' }, { value: 'PENDENTE', label: 'Pendentes' }, { value: 'LIBERADA', label: 'Liberadas' }, { value: 'PAGA', label: 'Pagas' }, { value: 'CANCELADA', label: 'Canceladas' }]} /></Filters></div>
      <DataTable loading={isLoading} rows={data?.rows} columns={[
        { key: 'createdAt', header: 'Data', cell: (r: any) => fmtDate(r.createdAt) }, { key: 'seller', header: 'Vendedor' },
        { key: 'orderNumber', header: 'Pedido', cell: (r: any) => <Link className="text-primary" href={`/vendas/${r.salesOrderId}`}>#{r.orderNumber}</Link> },
        { key: 'baseAmount', header: 'Base', align: 'right', cell: (r: any) => money(r.baseAmount) }, { key: 'rate', header: '%', align: 'right', cell: (r: any) => `${r.rate}%` },
        { key: 'amount', header: 'Comissão', align: 'right', cell: (r: any) => <b>{money(r.amount)}</b> }, { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> },
      ]} />
    </div>
  );
}
