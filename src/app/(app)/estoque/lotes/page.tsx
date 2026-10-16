'use client';
import { useState } from 'react';
import { Tag } from 'lucide-react';
import { useApi, openFile } from '@/lib/api';
import { PageHeader, DataTable, Chips, Filters } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fmtDate, num } from '@/lib/utils';

export default function Lots() {
  const [days, setDays] = useState('');
  const { data, isLoading } = useApi<any>(`/api/stock/lots${days ? `?expiringDays=${days}` : ''}`);
  return (
    <div>
      <PageHeader title="Lotes e validades" description="Controle de lote com saída FEFO (primeiro que vence, primeiro que sai)" actions={<Button variant="outline" onClick={() => openFile(`/api/stock/labels?type=stock&items=${[...new Set((data?.rows || []).map((r: any) => r.productId))].join(',')}`)}><Tag /> Etiquetas de lote</Button>} />
      <Filters><Chips value={days} onChange={setDays} options={[{ value: '', label: 'Todos' }, { value: '30', label: 'Vencem em 30 dias' }, { value: '90', label: 'Vencem em 90 dias' }]} /></Filters>
      <DataTable loading={isLoading} rows={data?.rows} columns={[
        { key: 'p', header: 'Produto', cell: (r: any) => <div><span className="font-mono text-xs">{r.product.sku}</span> {r.product.name}</div> },
        { key: 'lotNumber', header: 'Lote', cell: (r: any) => <b>{r.lotNumber}</b> },
        { key: 'warehouse', header: 'Depósito' },
        { key: 'manufacturedAt', header: 'Fabricação', cell: (r: any) => fmtDate(r.manufacturedAt) },
        { key: 'expiresAt', header: 'Validade', cell: (r: any) => fmtDate(r.expiresAt) },
        { key: 'days', header: 'Situação', cell: (r: any) => r.daysToExpire == null ? '—' : r.daysToExpire < 0 ? <Badge tone="red">Vencido</Badge> : r.daysToExpire <= 30 ? <Badge tone="orange">Vence em {r.daysToExpire}d</Badge> : <Badge tone="green">{r.daysToExpire} dias</Badge> },
        { key: 'quantity', header: 'Saldo', align: 'right', cell: (r: any) => num(r.quantity) },
      ]} />
    </div>
  );
}
