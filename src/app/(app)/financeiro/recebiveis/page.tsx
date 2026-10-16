'use client';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, FastForward } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, StatCard, Filters, Chips, Field } from '@/components/common/page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { money, fmtDate, round2, startOfDay } from '@/lib/utils';

type Rec = { transactionId: string; installment: number; installments: number; dueDate: string; gross: number; fee: number; net: number; method: 'CREDITO' | 'DEBITO' | 'PIX'; terminal: string; settled: boolean };
const METHOD: Record<string, [string, string]> = { CREDITO: ['Crédito', 'blue'], DEBITO: ['Débito', 'teal'], PIX: ['Pix', 'purple'] };

export default function Receivables() {
  const { data, isLoading } = useApi<Rec[]>('/api/finance/receivables');
  const act = useAction();
  const [filter, setFilter] = useState<'PENDENTE' | 'LIQUIDADO' | ''>('PENDENTE');
  const [ant, setAnt] = useState<{ rate: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const today = startOfDay();
  const all = data || [];
  const pending = all.filter((r) => !r.settled);
  const future = pending.filter((r) => new Date(r.dueDate) > new Date());
  const overdue = pending.filter((r) => new Date(r.dueDate) <= new Date());
  const settled = all.filter((r) => r.settled);
  const sum = (rs: Rec[]) => round2(rs.reduce((a, r) => a + r.net, 0));

  const byMonth = useMemo(() => {
    const m = new Map<string, { key: string; month: string; aReceber: number; liquidado: number }>();
    for (const r of all) {
      const d = new Date(r.dueDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const row = m.get(key) || { key, month: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }), aReceber: 0, liquidado: 0 };
      if (r.settled) row.liquidado = round2(row.liquidado + r.net);
      else row.aReceber = round2(row.aReceber + r.net);
      m.set(key, row);
    }
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [all]);

  const rows = all
    .filter((r) => (filter === 'PENDENTE' ? !r.settled : filter === 'LIQUIDADO' ? r.settled : true))
    .map((r) => ({ ...r, id: `${r.transactionId}:${r.installment}` }));

  // estimativa da taxa de antecipação (mesma regra do servidor: taxa a.m. proporcional aos meses até o vencimento)
  const antEstimate = ant ? round2(future.reduce((a, r) => a + r.net * ((Number(ant.rate) || 0) / 100) * Math.max(0, (new Date(r.dueDate).getTime() - Date.now()) / (30 * 86400000)), 0)) : 0;

  const liquidar = async () => {
    const r: any = await act('POST', '/api/finance/receivables', {}, false);
    if (r) r.settled ? toast.success(`${r.settled} recebível(is) liquidado(s) · ${money(r.net)} creditado(s) na conta`) : toast.info('Nenhum recebível vencido pendente de liquidação');
  };
  const antecipar = async () => {
    setBusy(true);
    const r: any = await act('POST', '/api/finance/receivables', { anticipate: true, rate: Number(ant?.rate) || 0 }, false);
    setBusy(false);
    if (!r) return;
    setAnt(null);
    r.settled ? toast.success(`${r.settled} recebível(is) antecipado(s) · líquido ${money(r.net)} · taxa de antecipação ${money(r.anticipationFee)}`) : toast.info('Nenhum recebível pendente para antecipar');
  };

  return (
    <div>
      <PageHeader title="Agenda de recebíveis" description="Vendas no cartão e Pix pelas maquininhas: quando cada parcela cai na conta (débito D+1, crédito D+30 por parcela), com liquidação e antecipação"
        actions={<><Button variant="outline" onClick={liquidar} disabled={!overdue.length}><CheckCircle2 /> Liquidar vencidos</Button><Button onClick={() => setAnt({ rate: '1.99' })} disabled={!pending.length}><FastForward /> Antecipar tudo</Button></>} />
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="A receber (futuro)" value={money(sum(future))} tone="blue" hint={`${future.length} parcela(s)`} />
        <StatCard label="Vencido não liquidado" value={money(sum(overdue))} tone="amber" hint={`${overdue.length} parcela(s) — use “Liquidar vencidos”`} />
        <StatCard label="Liquidado" value={money(sum(settled))} tone="green" hint={`${settled.length} parcela(s)`} />
      </div>
      <Card className="mb-3">
        <CardHeader><CardTitle>Líquido a receber por mês</CardTitle></CardHeader>
        <CardContent className="h-60">
          <ResponsiveContainer>
            <BarChart data={byMonth}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis fontSize={10} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
              <Tooltip formatter={(v: number) => money(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="aReceber" name="A receber" stackId="a" fill="#2563eb" />
              <Bar dataKey="liquidado" name="Liquidado" stackId="a" fill="#16a34a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Filters>
        <Chips value={filter} onChange={setFilter} options={[{ value: 'PENDENTE', label: 'Pendentes' }, { value: 'LIQUIDADO', label: 'Liquidados' }, { value: '', label: 'Todos' }]} />
      </Filters>
      <DataTable loading={isLoading} rows={rows} empty="Nenhum recebível de cartão" columns={[
        { key: 'dueDate', header: 'Previsão', cell: (r) => <span className={!r.settled && new Date(r.dueDate) < today ? 'font-semibold text-amber-600' : ''}>{fmtDate(r.dueDate)}</span> },
        { key: 'method', header: 'Modalidade', cell: (r) => <Badge tone={METHOD[r.method]?.[1]}>{METHOD[r.method]?.[0] || r.method}</Badge> },
        { key: 'installment', header: 'Parcela', cell: (r) => `${r.installment}/${r.installments}` },
        { key: 'terminal', header: 'Terminal', cell: (r) => r.terminal || '—' },
        { key: 'gross', header: 'Bruto', align: 'right', cell: (r) => money(r.gross) },
        { key: 'fee', header: 'Taxa', align: 'right', cell: (r) => <span className="text-red-600">{money(r.fee)}</span> },
        { key: 'net', header: 'Líquido', align: 'right', cell: (r) => <b>{money(r.net)}</b> },
        { key: 'settled', header: 'Situação', cell: (r) => r.settled ? <Badge tone="green">Liquidado</Badge> : new Date(r.dueDate) <= new Date() ? <Badge tone="orange">Vencido</Badge> : <Badge tone="yellow">Pendente</Badge> },
      ]} footer={rows.length ? <tr><td colSpan={4} className="px-3 py-2">Total ({rows.length})</td><td className="num">{money(round2(rows.reduce((a, r) => a + r.gross, 0)))}</td><td className="num">{money(round2(rows.reduce((a, r) => a + r.fee, 0)))}</td><td className="num">{money(sum(rows))}</td><td /></tr> : undefined} />

      <Dialog open={!!ant} onOpenChange={(o) => !o && setAnt(null)} title="Antecipar recebíveis" description="Todos os recebíveis pendentes são liquidados hoje; sobre as parcelas futuras incide a taxa de antecipação proporcional aos meses até o vencimento" size="sm"
        footer={<><Button variant="outline" onClick={() => setAnt(null)}>Cancelar</Button><Button onClick={antecipar} disabled={busy}><FastForward /> Confirmar antecipação</Button></>}>
        {ant && <div className="space-y-3 text-sm">
          <Field label="Taxa de antecipação (% a.m.)"><Input type="number" step="0.01" min={0} value={ant.rate} onChange={(e) => setAnt({ rate: e.target.value })} /></Field>
          <div className="space-y-1 rounded-md border bg-muted/40 p-3">
            <div className="flex justify-between"><span>Pendentes (líquido)</span><b>{money(sum(pending))}</b></div>
            <div className="flex justify-between text-red-600"><span>Taxa de antecipação estimada</span><b>− {money(antEstimate)}</b></div>
            <div className="flex justify-between border-t pt-1"><span>Valor a creditar</span><b className="text-green-700">{money(round2(sum(pending) - antEstimate))}</b></div>
          </div>
        </div>}
      </Dialog>
    </div>
  );
}
