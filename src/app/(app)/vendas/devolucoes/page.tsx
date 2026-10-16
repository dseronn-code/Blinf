'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Undo2, Repeat, Wallet } from 'lucide-react';
import { useApi } from '@/lib/api';
import { PageHeader, DataTable, StatCard, Filters, Chips, KV } from '@/components/common/page';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { money, fmtDate, fmtDateTime, num } from '@/lib/utils';

const KIND: Record<string, [string, string]> = { DEVOLUCAO: ['Devolução', 'orange'], TROCA: ['Troca', 'blue'] };
const REFUND: Record<string, string> = { ESTORNO: 'Estorno ao cliente', CREDITO: 'Crédito/abatimento em títulos', NENHUM: 'Nenhum' };

export default function SalesReturns() {
  const [kind, setKind] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const { data, isLoading } = useApi<any[]>('/api/returns');
  const { data: det } = useApi<any>(sel ? `/api/returns/${sel}` : null);
  const all = data || [];
  const rows = kind ? all.filter((r) => r.kind === kind) : all;
  const total = all.filter((r) => r.kind === 'DEVOLUCAO').reduce((a, r) => a + (Number(r.total) || 0), 0);
  return (
    <div>
      <PageHeader title="Devoluções e trocas" description="Ao registrar uma devolução no pedido, a NF-e de devolução (CFOP 1202/2202, finalidade 4) referenciando a nota original é emitida automaticamente, o estoque retorna e o estorno/crédito é lançado no financeiro." />
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Registros" value={all.length} icon={Undo2} />
        <StatCard label="Total devolvido" value={money(total)} tone="red" icon={Wallet} />
        <StatCard label="Trocas" value={all.filter((r) => r.kind === 'TROCA').length} tone="blue" icon={Repeat} />
      </div>
      <Filters><Chips value={kind} onChange={setKind} options={[{ value: '', label: 'Todas' }, { value: 'DEVOLUCAO', label: 'Devoluções' }, { value: 'TROCA', label: 'Trocas' }]} /></Filters>
      <DataTable loading={isLoading} rows={rows} onRowClick={(r: any) => setSel(r.id)} empty="Nenhuma devolução registrada. Use o botão “Devolução / troca” em um pedido faturado." columns={[
        { key: 'number', header: 'Nº', cell: (r: any) => <b>{r.number}</b> },
        { key: 'createdAt', header: 'Data', cell: (r: any) => fmtDate(r.createdAt) },
        { key: 'kind', header: 'Tipo', cell: (r: any) => <Badge tone={KIND[r.kind]?.[1]}>{KIND[r.kind]?.[0] || r.kind}</Badge> },
        { key: 'order', header: 'Pedido', cell: (r: any) => r.order ? <span>nº {r.order.number} <span className="text-muted-foreground">· {r.order.customer?.name}</span></span> : '—' },
        { key: 'reason', header: 'Motivo', cell: (r: any) => <span className="line-clamp-1 max-w-xs">{r.reason}</span> },
        { key: 'refundMethod', header: 'Reembolso', cell: (r: any) => r.kind === 'TROCA' ? '—' : REFUND[r.refundMethod] || r.refundMethod },
        { key: 'invoice', header: 'NF-e devolução', cell: (r: any) => r.invoice ? <span className="flex items-center gap-1">nº {r.invoice.number} <StatusBadge status={r.invoice.status} /></span> : '—' },
        { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> },
        { key: 'total', header: 'Total', align: 'right', cell: (r: any) => <b>{money(r.total)}</b> },
      ]} />

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)} size="lg" title={det ? `${KIND[det.kind]?.[0] || 'Devolução'} nº ${det.number}` : 'Carregando…'} description={det && `Registrada em ${fmtDateTime(det.createdAt)}`} footer={<Button variant="outline" onClick={() => setSel(null)}>Fechar</Button>}>
        {det && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KV label="Pedido" value={det.order ? <Link className="text-primary hover:underline" href={`/vendas/${det.order.id}`}>nº {det.order.number}</Link> : '—'} />
              <KV label="Cliente" value={det.order?.customer?.name} />
              <KV label="Situação" value={<StatusBadge status={det.status} />} />
              <KV label="Total" value={money(det.total)} />
              <KV label="Reembolso" value={det.kind === 'TROCA' ? '—' : REFUND[det.refundMethod] || det.refundMethod} />
              <KV label="Motivo" value={det.reason} />
            </div>
            <Card className="overflow-hidden">
              <table className="table-dense w-full">
                <thead><tr><th>Item</th><th className="text-right">Qtd</th><th className="text-right">Unitário</th><th className="text-right">Total</th><th className="text-center">Estoque</th></tr></thead>
                <tbody>
                  {(det.items || []).map((i: any, k: number) => (
                    <tr key={k}><td>{i.description}</td><td className="num">{num(i.quantity, 3)}</td><td className="num">{money(i.unitPrice)}</td><td className="num">{money(i.quantity * i.unitPrice)}</td><td className="text-center">{i.restock ? <Badge tone="green">Retornou</Badge> : <Badge>Não retornou</Badge>}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <div className="grid gap-3 md:grid-cols-3">
              <Card className="p-3 text-sm">
                <div className="mb-1 text-xs font-semibold text-muted-foreground">NF-e de devolução</div>
                {det.invoice ? (
                  <div className="space-y-1">
                    <Link className="flex items-center gap-1 text-primary hover:underline" href={`/fiscal/notas/${det.invoice.id}`}>nº {det.invoice.number} <StatusBadge status={det.invoice.status} /></Link>
                    {det.invoice.accessKey && <div className="break-all font-mono text-[10px] text-muted-foreground">Chave: {det.invoice.accessKey}</div>}
                    {det.invoice.refAccessKey && <div className="break-all font-mono text-[10px] text-muted-foreground">Ref.: {det.invoice.refAccessKey}</div>}
                  </div>
                ) : <span className="text-muted-foreground">Não emitida</span>}
              </Card>
              <Card className="p-3 text-sm">
                <div className="mb-1 text-xs font-semibold text-muted-foreground">Financeiro</div>
                {det.refund ? (
                  <div>
                    <div>{det.refund.description}</div>
                    <div className="flex items-center gap-1">{money(det.refund.amount)} · venc. {fmtDate(det.refund.dueDate)} <StatusBadge status={det.refund.status} /></div>
                  </div>
                ) : <span className="text-muted-foreground">{det.kind === 'TROCA' ? 'Troca — sem estorno' : 'Sem lançamento'}</span>}
              </Card>
              <Card className="p-3 text-sm">
                <div className="mb-1 text-xs font-semibold text-muted-foreground">Pedido de troca</div>
                {det.exchange ? <Link className="flex items-center gap-1 text-primary hover:underline" href={`/vendas/${det.exchange.id}`}>nº {det.exchange.number} <StatusBadge status={det.exchange.status} /></Link> : <span className="text-muted-foreground">—</span>}
              </Card>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
