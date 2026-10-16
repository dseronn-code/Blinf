'use client';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { useApi, qs, openFile } from '@/lib/api';
import { PageHeader, Filters, DataTable, Pagination } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { fmtDateTime, num, money, toInputDate, addDays } from '@/lib/utils';

const TYPES: Record<string, string> = { ENTRADA: 'green', SAIDA: 'red', AJUSTE: 'purple', TRANSFERENCIA_ENTRADA: 'blue', TRANSFERENCIA_SAIDA: 'blue' };
export default function Movements() {
  const sp = useSearchParams();
  const [type, setType] = useState('');
  const [origin, setOrigin] = useState('');
  const [from, setFrom] = useState(toInputDate(addDays(new Date(), -30)));
  const [to, setTo] = useState(toInputDate(new Date()));
  const [page, setPage] = useState(1);
  const { data, isLoading } = useApi<any>(`/api/stock/movements${qs({ type, origin, from, to, page, productId: sp.get('productId') })}`);
  return (
    <div>
      <PageHeader title="Movimentações de estoque" description="Histórico completo de entradas, saídas, ajustes e transferências (rastreável até o documento de origem)" actions={<Button variant="outline" onClick={() => openFile(`/api/reports/estoque-movimentacao${qs({ from, to, format: 'pdf' })}`)}><Download /> PDF</Button>} />
      <Filters>
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        <Select className="w-48" value={type} onChange={(e) => setType(e.target.value)}><option value="">Todos os tipos</option>{Object.keys(TYPES).map((t) => <option key={t}>{t}</option>)}</Select>
        <Select className="w-48" value={origin} onChange={(e) => setOrigin(e.target.value)}><option value="">Todas as origens</option>{['MANUAL', 'PEDIDO_VENDA', 'PDV', 'LOJA', 'INTEGRACAO', 'COMPRA', 'NFE_ENTRADA', 'PRODUCAO', 'INVENTARIO', 'TRANSFERENCIA', 'ESTORNO', 'OS'].map((t) => <option key={t}>{t}</option>)}</Select>
      </Filters>
      <DataTable loading={isLoading} rows={data?.rows} columns={[
        { key: 'createdAt', header: 'Data/hora', cell: (r: any) => fmtDateTime(r.createdAt) },
        { key: 'p', header: 'Produto', cell: (r: any) => <div><span className="font-mono text-xs">{r.product?.sku}</span> {r.product?.name}</div> },
        { key: 'warehouse', header: 'Depósito' },
        { key: 'type', header: 'Tipo', cell: (r: any) => <Badge tone={TYPES[r.type]}>{r.type}</Badge> },
        { key: 'origin', header: 'Origem', cell: (r: any) => <div className="text-xs">{r.originLabel || r.origin}{r.notes && <div className="text-muted-foreground">{r.notes}</div>}</div> },
        { key: 'lotNumber', header: 'Lote', cell: (r: any) => r.lotNumber || '' },
        { key: 'quantity', header: 'Qtd', align: 'right', cell: (r: any) => <b className={r.quantity < 0 ? 'text-red-600' : 'text-green-700'}>{r.quantity > 0 ? '+' : ''}{num(r.quantity, 3)}</b> },
        { key: 'balanceAfter', header: 'Saldo', align: 'right', cell: (r: any) => num(r.balanceAfter, 3) },
        { key: 'unitCost', header: 'Custo', align: 'right', cell: (r: any) => money(r.unitCost) },
        { key: 'userName', header: 'Usuário', cell: (r: any) => <span className="text-xs">{r.userName}</span> },
      ]} />
      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}
