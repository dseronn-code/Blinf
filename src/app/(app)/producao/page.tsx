'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus, CalendarDays } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, Chips, Filters, Field } from '@/components/common/page';
import { EntityPicker, productOption } from '@/components/common/picker';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/ui/badge';
import { fmtDate, num, money, toInputDate, addDays } from '@/lib/utils';

export default function Production() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const { data, isLoading } = useApi<any>(`/api/production${status ? `?status=${status}` : ''}`);
  const act = useAction();
  const [n, setN] = useState<any>(null);
  return (
    <div>
      <PageHeader title="Ordens de produção" description="Planejamento pela ficha técnica: ao finalizar, baixa as matérias-primas e dá entrada no produto acabado com custo real" actions={<><Button variant="outline" asChild><Link href="/producao/calendario"><CalendarDays /> Calendário</Link></Button><Button onClick={() => setN({ quantity: 10, startDate: toInputDate(new Date()), dueDate: toInputDate(addDays(new Date(), 5)) })}><Plus /> Nova OP</Button></>} />
      <Filters><Chips value={status} onChange={setStatus} options={[{ value: '', label: 'Todas' }, { value: 'PLANEJADA', label: 'Planejadas' }, { value: 'EM_PRODUCAO', label: 'Em produção' }, { value: 'FINALIZADA', label: 'Finalizadas' }, { value: 'CANCELADA', label: 'Canceladas' }]} /></Filters>
      <DataTable loading={isLoading} rows={data?.rows} onRowClick={(r: any) => router.push(`/producao/${r.id}`)} columns={[
        { key: 'number', header: 'OP', cell: (r: any) => <b>{r.number}</b> }, { key: 'p', header: 'Produto', cell: (r: any) => `${r.product?.sku} — ${r.product?.name}` },
        { key: 'quantity', header: 'Qtd', align: 'right', cell: (r: any) => `${num(r.quantity)} ${r.product?.unit}` }, { key: 'producedQty', header: 'Produzido', align: 'right', cell: (r: any) => num(r.producedQty) },
        { key: 'startDate', header: 'Início', cell: (r: any) => fmtDate(r.startDate) }, { key: 'dueDate', header: 'Prazo', cell: (r: any) => fmtDate(r.dueDate) },
        { key: 'responsible', header: 'Responsável' }, { key: 'totalCost', header: 'Custo', align: 'right', cell: (r: any) => money(r.totalCost) },
        { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> },
      ]} />
      <Dialog open={!!n} onOpenChange={(o) => !o && setN(null)} title="Nova ordem de produção" footer={<Button onClick={async () => { const r: any = await act('POST', '/api/production', n, 'OP criada'); if (r) { setN(null); router.push(`/producao/${r.id}`); } }}>Criar OP</Button>}>
        {n && <div className="grid grid-cols-2 gap-3">
          <Field label="Produto a produzir (com ficha técnica)" className="col-span-2"><EntityPicker endpoint="/api/products?kind=FABRICADO" value={n.productId} label={n.label} map={productOption} onChange={(v, raw) => setN({ ...n, productId: v, label: raw && `${raw.sku} — ${raw.name}` })} /></Field>
          <Field label="Quantidade"><Input type="number" value={n.quantity} onChange={(e) => setN({ ...n, quantity: e.target.value })} /></Field>
          <Field label="Lote do produto acabado"><Input value={n.lotNumber || ''} onChange={(e) => setN({ ...n, lotNumber: e.target.value })} placeholder="automático" /></Field>
          <Field label="Início"><Input type="date" value={n.startDate} onChange={(e) => setN({ ...n, startDate: e.target.value })} /></Field>
          <Field label="Prazo"><Input type="date" value={n.dueDate} onChange={(e) => setN({ ...n, dueDate: e.target.value })} /></Field>
          <Field label="Responsável" className="col-span-2"><Input value={n.responsible || ''} onChange={(e) => setN({ ...n, responsible: e.target.value })} /></Field>
          <Field label="Observações" className="col-span-2"><Textarea value={n.notes || ''} onChange={(e) => setN({ ...n, notes: e.target.value })} /></Field>
        </div>}
      </Dialog>
    </div>
  );
}
