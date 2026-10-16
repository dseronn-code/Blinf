'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowRightLeft, Plus, Trash2, Building2 } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, StatCard, Field } from '@/components/common/page';
import { EntityPicker, productOption } from '@/components/common/picker';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select, Checkbox } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { money, fmtDateTime, fmtDoc, num } from '@/lib/utils';

type Line = { productId: string | null; label: string | null; quantity: string; available?: number | null; unit?: string };
const newLine = (): Line => ({ productId: null, label: null, quantity: '1' });

export default function CompanyTransfers() {
  const act = useAction();
  const { data, isLoading } = useApi<any[]>('/api/company-transfers');
  const { data: me } = useApi<any>('/api/me');
  const [open, setOpen] = useState(false);
  const { data: rc } = useApi<any>(open ? '/api/r/companies?pageSize=100' : null);
  const [toCompanyId, setTo] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [emitInvoice, setEmit] = useState(true);
  const [busy, setBusy] = useState(false);
  const all = data || [];
  const companies: any[] = (rc?.rows || me?.companies || []).filter((c: any) => c.id !== me?.companyId);
  const current = me?.companies?.find((c: any) => c.id === me?.companyId);
  const valid = lines.filter((l) => l.productId && Number(l.quantity) > 0);
  const openNew = () => {
    setTo('');
    setLines([newLine()]);
    setEmit(true);
    setOpen(true);
  };
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const submit = async () => {
    setBusy(true);
    const r = await act('POST', '/api/company-transfers', { toCompanyId, items: valid.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })), emitInvoice }, emitInvoice ? 'Transferência realizada — NF-e de transferência autorizada' : 'Transferência realizada');
    setBusy(false);
    if (r) setOpen(false);
  };
  const sent = all.filter((r) => r.fromCompanyId === me?.companyId);
  return (
    <div>
      <PageHeader title="Transferências entre empresas" description="Movimente estoque entre os CNPJs do grupo: o estoque sai da empresa de origem e entra no depósito padrão da empresa de destino pelo custo médio, com NF-e de transferência (CFOP 5152/6152) transmitida automaticamente." actions={<Button onClick={openNew}><Plus /> Nova transferência</Button>} />
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Transferências" value={all.length} icon={ArrowRightLeft} />
        <StatCard label="Enviadas por esta empresa" value={money(sent.reduce((a, r) => a + (Number(r.total) || 0), 0))} hint={`${sent.length} transferência(s)`} tone="blue" />
        <StatCard label="Recebidas" value={money(all.filter((r) => r.toCompanyId === me?.companyId).reduce((a, r) => a + (Number(r.total) || 0), 0))} tone="green" />
      </div>
      <DataTable loading={isLoading} rows={all} empty="Nenhuma transferência entre empresas" columns={[
        { key: 'number', header: 'Nº', cell: (r: any) => <b>{r.number}</b> },
        { key: 'createdAt', header: 'Data', cell: (r: any) => fmtDateTime(r.createdAt) },
        { key: 'from', header: 'Origem', cell: (r: any) => <span className={r.fromCompanyId === me?.companyId ? 'font-semibold' : ''}>{r.from || '—'}</span> },
        { key: 'to', header: 'Destino', cell: (r: any) => <span className={r.toCompanyId === me?.companyId ? 'font-semibold' : ''}>{r.to || '—'}</span> },
        { key: 'items', header: 'Itens', cell: (r: any) => { const its = Array.isArray(r.items) ? r.items : []; return <span className="text-xs" title={its.map((i: any) => `${num(i.quantity, 3)} × ${i.name || i.productId}`).join('\n')}>{its.length} item(ns) · {num(its.reduce((a: number, i: any) => a + (Number(i.quantity) || 0), 0), 3)} un</span>; } },
        { key: 'invoice', header: 'NF-e', cell: (r: any) => r.invoice ? <Link onClick={(e) => e.stopPropagation()} href={`/fiscal/notas/${r.invoice.id}`} className="flex items-center gap-1 text-primary hover:underline">nº {r.invoice.number} <StatusBadge status={r.invoice.status} /></Link> : <span className="text-muted-foreground">Sem nota</span> },
        { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status || 'CONCLUIDA'} /> },
        { key: 'total', header: 'Total (custo)', align: 'right', cell: (r: any) => <b>{money(r.total)}</b> },
      ]} />

      <Dialog open={open} onOpenChange={setOpen} size="lg" title="Nova transferência entre empresas" description="Saída do depósito padrão desta empresa e entrada no depósito padrão da empresa de destino, valorizada pelo custo médio." footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>Voltar</Button>
          <Button disabled={busy || !toCompanyId || !valid.length} onClick={submit}><ArrowRightLeft /> Transferir</Button>
        </>
      }>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Origem"><div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-2.5 text-sm"><Building2 className="h-4 w-4 text-muted-foreground" />{current ? (current.tradeName || current.name) : '—'}</div></Field>
            <Field label="Empresa de destino *"><Select value={toCompanyId} onChange={(e) => setTo(e.target.value)}><option value="">Selecione…</option>{companies.map((c: any) => <option key={c.id} value={c.id}>{c.tradeName || c.name}{c.cnpj ? ` — ${fmtDoc(c.cnpj)}` : ''}{c.uf ? ` (${c.uf})` : ''}</option>)}</Select></Field>
          </div>
          {!companies.length && me && <p className="text-xs text-amber-700">Nenhuma outra empresa no grupo. Cadastre empresas em Configurações para transferir estoque entre CNPJs.</p>}
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Itens</div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1"><EntityPicker endpoint="/api/products?sellable=1" value={l.productId} label={l.label} map={productOption} placeholder="Selecione o produto…" onChange={(v, raw) => setLine(i, { productId: v, label: raw ? `${raw.sku} — ${raw.name}` : null, available: raw?.stock?.available ?? null, unit: raw?.unit })} /></div>
                  <Input type="number" min={0} step="any" className="w-28 text-right" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                  <span className="w-24 text-[11px] text-muted-foreground">{l.available != null ? `disp. ${num(l.available, 3)} ${l.unit || ''}` : ''}</span>
                  <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 /></Button>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setLines([...lines, newLine()])}><Plus /> Adicionar item</Button>
          </div>
          <Checkbox label="Emitir NF-e de transferência (CFOP 5152/6152)" checked={emitInvoice} onChange={(e) => setEmit(e.target.checked)} />
        </div>
      </Dialog>
    </div>
  );
}
