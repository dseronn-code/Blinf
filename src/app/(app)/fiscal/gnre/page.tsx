'use client';
import { useState } from 'react';
import Link from 'next/link';
import { FileText, FileCode, CheckCircle2, RefreshCw, Plus, Info } from 'lucide-react';
import { useApi, useAction, openFile } from '@/lib/api';
import { PageHeader, DataTable, Field, Chips, StatCard } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { money, fmtDate } from '@/lib/utils';

type Gnre = { id: string; uf: string; revenueCode: string; amount: number; dueDate: string; reference: string | null; barcode: string | null; line: string | null; status: string; paidAt: string | null; invoiceId: string | null; invoice: { id: string; number: number; customerName: string } | null };

const REVENUE: Record<string, string> = { '100099': 'ICMS-ST por operação', '100102': 'DIFAL consumidor final', '100129': 'FCP' };
const TONE: Record<string, string> = { PENDENTE: 'yellow', GERADA: 'blue', PAGA: 'green', CANCELADA: 'gray' };

export default function GnrePage() {
  const act = useAction();
  const [status, setStatus] = useState('');
  const { data, isLoading } = useApi<Gnre[]>(`/api/gnre${status ? `?status=${status}` : ''}`);
  const { data: invs } = useApi<{ rows: { id: string; number: number; customerName: string; total: number }[] }>('/api/invoices?model=NFE&status=AUTORIZADA&pageSize=100');
  const [invoiceId, setInvoiceId] = useState('');
  const open = (data || []).filter((g) => ['PENDENTE', 'GERADA'].includes(g.status));

  return (
    <div>
      <PageHeader title="GNRE" description="Guias de ICMS-ST, DIFAL e FCP devidos a outras UFs nas vendas interestaduais" />
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <StatCard label="A pagar" value={money(open.reduce((a, g) => a + g.amount, 0))} hint={`${open.length} guia(s)`} tone="amber" />
        <StatCard label="Pagas" value={money((data || []).filter((g) => g.status === 'PAGA').reduce((a, g) => a + g.amount, 0))} tone="green" />
        <Card>
          <CardHeader><CardTitle className="text-sm">Gerar para uma NF-e</CardTitle></CardHeader>
          <CardContent className="flex gap-2">
            <Field label="" className="flex-1"><Select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}><option value="">Selecione a NF-e…</option>{invs?.rows.map((i) => <option key={i.id} value={i.id}>{i.number} — {i.customerName} ({money(i.total)})</option>)}</Select></Field>
            <Button disabled={!invoiceId} onClick={async () => { if (await act('POST', '/api/gnre', { invoiceId }, 'GNRE gerada e lançada em contas a pagar')) setInvoiceId(''); }}><Plus /> Gerar</Button>
          </CardContent>
        </Card>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Chips value={status} onChange={setStatus} options={[{ value: '', label: 'Todas' }, { value: 'PENDENTE', label: 'Pendentes' }, { value: 'GERADA', label: 'Geradas' }, { value: 'PAGA', label: 'Pagas' }, { value: 'CANCELADA', label: 'Canceladas' }]} />
        <div className="flex items-center gap-1 text-xs text-muted-foreground"><Info className="h-3.5 w-3.5" /> Geradas automaticamente na autorização da NF-e quando a empresa (regime normal) não tem IE de substituto na UF de destino.</div>
      </div>
      <DataTable loading={isLoading} rows={data} empty="Nenhuma guia" columns={[
        { key: 'dueDate', header: 'Vencimento', cell: (r: Gnre) => fmtDate(r.dueDate) },
        { key: 'uf', header: 'UF', cell: (r: Gnre) => <b>{r.uf}</b> },
        { key: 'revenueCode', header: 'Receita', cell: (r: Gnre) => <span>{r.revenueCode} <span className="text-muted-foreground">{REVENUE[r.revenueCode]}</span></span> },
        { key: 'invoice', header: 'NF-e', cell: (r: Gnre) => (r.invoice ? <Link className="text-primary hover:underline" href={`/fiscal/notas/${r.invoice.id}`}>{r.invoice.number} — {r.invoice.customerName}</Link> : '—') },
        { key: 'line', header: 'Linha digitável', cell: (r: Gnre) => <span className="block max-w-[260px] truncate font-mono text-[11px]" title={r.reference || ''}>{r.line || r.reference || '—'}</span> },
        { key: 'amount', header: 'Valor', align: 'right', cell: (r: Gnre) => money(r.amount) },
        { key: 'status', header: 'Situação', cell: (r: Gnre) => <span className="flex gap-1"><Badge tone={TONE[r.status] || 'gray'}>{r.status}</Badge>{/SIMULADO/i.test(r.reference || '') && <Badge tone="purple">Simulada</Badge>}</span> },
        { key: 'actions', header: '', align: 'right', cell: (r: Gnre) => (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" title="Guia em PDF" onClick={() => openFile(`/api/gnre/${r.id}/pdf`)}><FileText /></Button>
            <Button size="sm" variant="ghost" title="Lote XML" onClick={() => openFile(`/api/gnre/${r.id}/xml`)}><FileCode /></Button>
            {r.status === 'PENDENTE' && /Recibo/.test(r.reference || '') && <Button size="sm" variant="ghost" title="Consultar o lote no Portal GNRE" onClick={() => act('POST', `/api/gnre/${r.id}/refresh`, {}, 'Lote consultado')}><RefreshCw /></Button>}
            {['PENDENTE', 'GERADA'].includes(r.status) && <Button size="sm" variant="outline" onClick={() => confirm(`Registrar o pagamento da GNRE ${r.uf} de ${money(r.amount)}? A conta a pagar vinculada será baixada.`) && act('POST', `/api/gnre/${r.id}/pay`, {}, 'GNRE paga')}><CheckCircle2 /> Pagar</Button>}
          </div>
        ) },
      ]} />
    </div>
  );
}
