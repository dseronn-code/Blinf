'use client';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeftRight, Download, Plus, ClipboardCheck } from 'lucide-react';
import { useApi, useAction, qs, openFile } from '@/lib/api';
import { PageHeader, SearchBox, Filters, DataTable, Chips, StatCard, Field } from '@/components/common/page';
import { EntityPicker, productOption } from '@/components/common/picker';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/ui/badge';
import { money, num } from '@/lib/utils';
import { useMe } from '@/components/layout/me';

export default function StockPage() {
  const sp = useSearchParams();
  const me = useMe();
  const [q, setQ] = useState('');
  const [wh, setWh] = useState('');
  const [situation, setSituation] = useState(sp.get('situation') || '');
  const { data, isLoading } = useApi<any>(`/api/stock${qs({ q, warehouseId: wh, situation })}`);
  const [mov, setMov] = useState<any>(null);
  const act = useAction();
  const submit = async () => {
    const r = await act('POST', '/api/stock/movements', mov, 'Estoque atualizado — canais sincronizados');
    if (r) setMov(null);
  };
  return (
    <div>
      <PageHeader title="Controle de estoque" description={`Saldos por depósito com reservas automáticas · modo ${me.stockMode === 'UNIFICADO' ? 'UNIFICADO (todas as empresas)' : 'SEPARADO por empresa'}`}
        actions={<>
          <Button variant="outline" onClick={() => openFile('/api/reports/estoque-posicao?format=xlsx')}><Download /> Excel</Button>
          <Button variant="outline" onClick={() => setMov({ type: 'AJUSTE', warehouseId: data?.warehouses.find((w: any) => w.isDefault)?.id })}><ClipboardCheck /> Balanço/inventário</Button>
          <Button variant="outline" onClick={() => setMov({ type: 'TRANSFERENCIA', warehouseId: data?.warehouses.find((w: any) => w.isDefault)?.id })}><ArrowLeftRight /> Transferir</Button>
          <Button onClick={() => setMov({ type: 'ENTRADA', warehouseId: data?.warehouses.find((w: any) => w.isDefault)?.id })}><Plus /> Lançar movimentação</Button>
        </>} />
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Itens em estoque" value={num(data?.totals.items)} />
        <StatCard label="Valor do estoque (custo)" value={money(data?.totals.value)} tone="blue" />
        <StatCard label="Em ruptura" value={data?.totals.ruptura ?? 0} tone="red" />
        <StatCard label="Abaixo do mínimo" value={data?.totals.baixo ?? 0} tone="amber" />
      </div>
      <Filters>
        <SearchBox value={q} onChange={setQ} placeholder="Produto, SKU ou EAN" />
        <Select className="w-56" value={wh} onChange={(e) => setWh(e.target.value)}><option value="">Todos os depósitos</option>{data?.warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
        <Chips value={situation} onChange={setSituation} options={[{ value: '', label: 'Todas' }, { value: 'RUPTURA', label: 'Ruptura' }, { value: 'BAIXO', label: 'Abaixo do mínimo' }, { value: 'EXCESSO', label: 'Excesso' }, { value: 'OK', label: 'OK' }]} />
      </Filters>
      <DataTable loading={isLoading} rows={data?.rows} onRowClick={(r: any) => setMov({ type: 'ENTRADA', productId: r.id, label: `${r.sku} — ${r.name}`, warehouseId: wh || data?.warehouses.find((w: any) => w.isDefault)?.id })} columns={[
        { key: 'sku', header: 'SKU', cell: (r: any) => <span className="whitespace-nowrap font-mono text-xs">{r.sku}</span> },
        { key: 'name', header: 'Produto', cell: (r: any) => <div className="min-w-[220px]"><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.category}{r.location ? ` · ${r.location}` : ''}{r.controlsLot ? ' · lote' : ''}</div></div> },
        ...(!wh ? (data?.warehouses || []).map((w: any) => ({ key: w.id, header: w.name, align: 'right' as const, cell: (r: any) => num(r.byWarehouse[w.id]?.quantity ?? 0) })) : []),
        { key: 'quantity', header: 'Físico', align: 'right', cell: (r: any) => num(r.quantity) },
        { key: 'reserved', header: 'Reservado', align: 'right', cell: (r: any) => (r.reserved ? <span className="text-blue-700">{num(r.reserved)}</span> : '0') },
        { key: 'available', header: 'Disponível', align: 'right', cell: (r: any) => <b>{num(r.available)}</b> },
        { key: 'minStock', header: 'Mín.', align: 'right', cell: (r: any) => num(r.minStock) },
        { key: 'value', header: 'Valor', align: 'right', cell: (r: any) => money(r.value) },
        { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> },
      ]} />
      <Dialog open={!!mov} onOpenChange={(o) => !o && setMov(null)} title="Lançamento de estoque" description="Entradas, saídas, balanço (ajusta para o saldo informado) e transferências entre depósitos" footer={<><Button variant="outline" onClick={() => setMov(null)}>Cancelar</Button><Button onClick={submit}>Lançar</Button></>}>
        {mov && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo" className="col-span-2"><Chips value={mov.type} onChange={(v) => setMov({ ...mov, type: v })} options={[{ value: 'ENTRADA', label: 'Entrada' }, { value: 'SAIDA', label: 'Saída' }, { value: 'AJUSTE', label: 'Balanço' }, { value: 'TRANSFERENCIA', label: 'Transferência' }]} /></Field>
            <Field label="Produto" className="col-span-2"><EntityPicker endpoint="/api/products?sellable=1" value={mov.productId} label={mov.label} map={productOption} onChange={(v, raw) => setMov({ ...mov, productId: v, label: raw && `${raw.sku} — ${raw.name}`, controlsLot: raw?.controlsLot })} /></Field>
            <Field label={mov.type === 'TRANSFERENCIA' ? 'Depósito de origem' : 'Depósito'}><Select value={mov.warehouseId || ''} onChange={(e) => setMov({ ...mov, warehouseId: e.target.value })}>{data?.warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
            {mov.type === 'TRANSFERENCIA' ? <Field label="Depósito de destino"><Select value={mov.toWarehouseId || ''} onChange={(e) => setMov({ ...mov, toWarehouseId: e.target.value })}><option value="">—</option>{data?.warehouses.filter((w: any) => w.id !== mov.warehouseId).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field> : <div />}
            <Field label={mov.type === 'AJUSTE' ? 'Saldo contado (novo saldo)' : 'Quantidade'}><Input type="number" step="any" value={mov.quantity || ''} onChange={(e) => setMov({ ...mov, quantity: e.target.value })} /></Field>
            {mov.type === 'ENTRADA' && <Field label="Custo unitário (opcional)"><Input type="number" step="0.01" value={mov.unitCost || ''} onChange={(e) => setMov({ ...mov, unitCost: e.target.value })} /></Field>}
            {(mov.type === 'ENTRADA' || mov.type === 'SAIDA') && <Field label="Lote"><Input value={mov.lotNumber || ''} onChange={(e) => setMov({ ...mov, lotNumber: e.target.value })} placeholder={mov.type === 'SAIDA' ? 'vazio = FEFO automático' : 'opcional'} /></Field>}
            {mov.type === 'ENTRADA' && <Field label="Validade do lote"><Input type="date" value={mov.expiresAt || ''} onChange={(e) => setMov({ ...mov, expiresAt: e.target.value })} /></Field>}
            <Field label="Observação" className="col-span-2"><Textarea value={mov.notes || ''} onChange={(e) => setMov({ ...mov, notes: e.target.value })} /></Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
