'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, StatCard, Filters, Chips, Field } from '@/components/common/page';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { fmtDateTime } from '@/lib/utils';

const STATUS: Record<string, [string, string]> = { ABERTO: ['Em contagem', 'yellow'], CONCLUIDO: ['Concluído', 'green'], CANCELADO: ['Cancelado', 'gray'] };

export default function InventoryCounts() {
  const router = useRouter();
  const act = useAction();
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ warehouseId: string; categoryId: string; notes: string }>({ warehouseId: '', categoryId: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useApi<any[]>('/api/inventory');
  const { data: whs } = useApi<any>(open ? '/api/r/warehouses?pageSize=200' : null);
  const { data: cats } = useApi<any>(open ? '/api/r/categories?pageSize=500' : null);
  const all = data || [];
  const rows = status ? all.filter((r) => r.status === status) : all;
  const create = async () => {
    setBusy(true);
    const r: any = await act('POST', '/api/inventory', { warehouseId: f.warehouseId, categoryId: f.categoryId || undefined, notes: f.notes || undefined }, 'Inventário aberto — produtos carregados para contagem');
    setBusy(false);
    if (r?.id) router.push(`/estoque/inventario/${r.id}`);
  };
  const openNew = () => {
    setF({ warehouseId: '', categoryId: '', notes: '' });
    setOpen(true);
  };
  return (
    <div>
      <PageHeader title="Inventário" description="Contagem física de estoque por depósito com leitor de código de barras; ao concluir, as diferenças são ajustadas automaticamente no estoque" actions={<Button onClick={openNew}><Plus /> Novo inventário</Button>} />
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Inventários" value={all.length} icon={ClipboardList} />
        <StatCard label="Em contagem" value={all.filter((r) => r.status === 'ABERTO').length} tone="amber" />
        <StatCard label="Concluídos" value={all.filter((r) => r.status === 'CONCLUIDO').length} tone="green" />
      </div>
      <Filters><Chips value={status} onChange={setStatus} options={[{ value: '', label: 'Todos' }, { value: 'ABERTO', label: 'Em contagem' }, { value: 'CONCLUIDO', label: 'Concluídos' }, { value: 'CANCELADO', label: 'Cancelados' }]} /></Filters>
      <DataTable loading={isLoading} rows={rows} onRowClick={(r: any) => router.push(`/estoque/inventario/${r.id}`)} empty="Nenhum inventário. Clique em “Novo inventário” para iniciar uma contagem." columns={[
        { key: 'number', header: 'Nº', cell: (r: any) => <b>{r.number}</b> },
        { key: 'createdAt', header: 'Aberto em', cell: (r: any) => fmtDateTime(r.createdAt) },
        { key: 'warehouse', header: 'Depósito', cell: (r: any) => r.warehouse || '—' },
        { key: 'notes', header: 'Observações', cell: (r: any) => <span className="line-clamp-1 max-w-xs text-muted-foreground">{r.notes || ''}</span> },
        { key: 'userName', header: 'Responsável', cell: (r: any) => r.userName || '—' },
        { key: 'items', header: 'Itens', align: 'right', cell: (r: any) => r._count?.items ?? 0 },
        { key: 'counted', header: 'Contados', align: 'right', cell: (r: any) => <span>{r.counted} <span className="text-[11px] text-muted-foreground">({r._count?.items ? Math.round((r.counted / r._count.items) * 100) : 0}%)</span></span> },
        { key: 'divergent', header: 'Divergentes', align: 'right', cell: (r: any) => r.divergent ? <span className="font-semibold text-red-600">{r.divergent}</span> : 0 },
        { key: 'finishedAt', header: 'Encerrado em', cell: (r: any) => fmtDateTime(r.finishedAt) },
        { key: 'status', header: 'Situação', cell: (r: any) => <Badge tone={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0] || r.status}</Badge> },
      ]} />

      <Dialog open={open} onOpenChange={setOpen} size="sm" title="Novo inventário" description="Os produtos com controle de estoque do depósito (e categoria, se informada) são carregados com o saldo atual do sistema." footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>Voltar</Button>
          <Button disabled={busy || !f.warehouseId} onClick={create}>Iniciar contagem</Button>
        </>
      }>
        <div className="space-y-3">
          <Field label="Depósito *"><Select value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}><option value="">Selecione…</option>{whs?.rows?.map((w: any) => <option key={w.id} value={w.id}>{w.name}{w.isDefault ? ' (padrão)' : ''}</option>)}</Select></Field>
          <Field label="Categoria" hint="Opcional — limite a contagem a uma categoria (inventário rotativo)"><Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">Todas as categorias</option>{cats?.rows?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Observações"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} /></Field>
        </div>
      </Dialog>
    </div>
  );
}
