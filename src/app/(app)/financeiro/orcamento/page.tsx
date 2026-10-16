'use client';
import { useEffect, useMemo, useState } from 'react';
import { Save, Copy, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, useAction, qs } from '@/lib/api';
import { PageHeader, Filters, StatCard } from '@/components/common/page';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Checkbox } from '@/components/ui/input';
import { money, num, round2, cn } from '@/lib/utils';

type BudgetRow = { chartAccountId: string; code: string; name: string; type: 'RECEITA' | 'DESPESA'; budget: number; actual: number; diff: number; percent: number | null };
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function Progress({ actual, budget, type }: { actual: number; budget: number; type: string }) {
  if (!budget) return <span className="text-xs text-muted-foreground">{actual ? 'sem orçamento' : '—'}</span>;
  const p = (actual / budget) * 100;
  const over = p > 100;
  const color = type === 'DESPESA' ? (over ? 'bg-red-500' : p > 85 ? 'bg-amber-500' : 'bg-green-600') : over ? 'bg-green-600' : p < 50 ? 'bg-amber-500' : 'bg-blue-600';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-28 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', color)} style={{ width: `${Math.min(100, p)}%` }} /></div>
      <span className={cn('w-12 text-right text-xs tabular-nums', type === 'DESPESA' && over && 'font-semibold text-red-600')}>{num(p, 0)}%</span>
    </div>
  );
}

export default function Orcamento() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | ''>(now.getMonth() + 1);
  const [onlyUsed, setOnlyUsed] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const { data, isLoading } = useApi<BudgetRow[]>(`/api/finance/budget${qs({ year, month })}`);
  const { data: charts } = useApi<any>('/api/r/chart-accounts?pageSize=500');
  const act = useAction();
  useEffect(() => setDraft({}), [year, month]);
  const editable = month !== '';

  const rows: BudgetRow[] = useMemo(() => {
    const api = data || [];
    if (!editable) return api;
    const accounts = (charts?.rows || []).filter((c: any) => c.active !== false);
    const list: BudgetRow[] = accounts.map((c: any) => api.find((r) => r.chartAccountId === c.id) || { chartAccountId: c.id, code: c.code, name: c.name, type: c.type, budget: 0, actual: 0, diff: 0, percent: null });
    for (const r of api) if (!list.some((x) => x.chartAccountId === r.chartAccountId)) list.push(r);
    return list.sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }));
  }, [data, charts, editable]);

  const budgetOf = (r: BudgetRow) => (r.chartAccountId in draft ? Number(draft[r.chartAccountId].replace(',', '.')) || 0 : r.budget);
  const visible = rows.filter((r) => !onlyUsed || budgetOf(r) || r.actual);
  const dirty = Object.keys(draft).filter((id) => { const r = rows.find((x) => x.chartAccountId === id); return r && round2(budgetOf(r)) !== round2(r.budget); });
  const totals = (type: string) => {
    const rs = rows.filter((r) => r.type === type);
    return { budget: round2(rs.reduce((a, r) => a + budgetOf(r), 0)), actual: round2(rs.reduce((a, r) => a + r.actual, 0)) };
  };
  const rec = totals('RECEITA');
  const desp = totals('DESPESA');

  const save = async (allMonths = false) => {
    if (!editable) return;
    const ids = allMonths ? rows.filter((r) => budgetOf(r)).map((r) => r.chartAccountId) : dirty;
    if (!ids.length) return toast.info('Nada para salvar');
    if (allMonths && !confirm(`Replicar o orçamento de ${MONTHS[Number(month) - 1]} para todos os 12 meses de ${year}? Valores existentes serão substituídos.`)) return;
    const months = allMonths ? Array.from({ length: 12 }, (_, i) => i + 1) : [Number(month)];
    const payload = ids.flatMap((id) => { const r = rows.find((x) => x.chartAccountId === id)!; return months.map((m) => ({ chartAccountId: id, year, month: m, amount: round2(budgetOf(r)) })); });
    setSaving(true);
    const r = await act('PUT', '/api/finance/budget', { rows: payload }, allMonths ? 'Orçamento replicado para o ano' : 'Orçamento salvo');
    setSaving(false);
    if (r) setDraft({});
  };

  const section = (type: 'RECEITA' | 'DESPESA') => {
    const rs = visible.filter((r) => r.type === type);
    const t = type === 'RECEITA' ? rec : desp;
    return (
      <>
        <tr className="bg-muted/50"><td colSpan={6} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{type === 'RECEITA' ? 'Receitas' : 'Despesas'}</td></tr>
        {!rs.length && <tr><td colSpan={6} className="px-4 py-3 text-center text-xs text-muted-foreground">Nenhuma conta com orçamento ou realizado</td></tr>}
        {rs.map((r) => {
          const b = budgetOf(r);
          const diff = round2(r.actual - b);
          const bad = type === 'DESPESA' ? diff > 0 : diff < 0;
          return (
            <tr key={r.chartAccountId} className="border-t">
              <td className="px-4 py-1.5"><span className="mr-2 font-mono text-xs text-muted-foreground">{r.code}</span>{r.name}</td>
              <td className="px-4 py-1.5 text-right">
                {editable
                  ? <Input type="number" step="0.01" min={0} className={cn('ml-auto h-8 w-32 text-right tabular-nums', r.chartAccountId in draft && round2(b) !== round2(r.budget) && 'border-amber-400 bg-amber-50')} value={r.chartAccountId in draft ? draft[r.chartAccountId] : r.budget || ''} placeholder="0,00" onChange={(e) => setDraft({ ...draft, [r.chartAccountId]: e.target.value })} />
                  : <span className="tabular-nums">{money(b)}</span>}
              </td>
              <td className="px-4 py-1.5 text-right tabular-nums">{money(r.actual)}</td>
              <td className={cn('px-4 py-1.5 text-right tabular-nums', b && (bad ? 'text-red-600' : 'text-green-700'))}>{b ? money(diff) : '—'}</td>
              <td className="px-4 py-1.5"><Progress actual={r.actual} budget={b} type={type} /></td>
              <td />
            </tr>
          );
        })}
        <tr className="border-t bg-muted/30 font-semibold">
          <td className="px-4 py-2">Total {type === 'RECEITA' ? 'receitas' : 'despesas'}</td>
          <td className="px-4 py-2 text-right tabular-nums">{money(t.budget)}</td>
          <td className="px-4 py-2 text-right tabular-nums">{money(t.actual)}</td>
          <td className={cn('px-4 py-2 text-right tabular-nums', t.budget && ((type === 'DESPESA' ? t.actual > t.budget : t.actual < t.budget) ? 'text-red-600' : 'text-green-700'))}>{money(round2(t.actual - t.budget))}</td>
          <td className="px-4 py-2"><Progress actual={t.actual} budget={t.budget} type={type} /></td>
          <td />
        </tr>
      </>
    );
  };

  const years = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  return (
    <div>
      <PageHeader title="Orçamento" description="Previsto × realizado por conta do plano de contas (realizado pela data de competência dos lançamentos)"
        actions={editable && <>
          {dirty.length > 0 && <Button variant="ghost" onClick={() => setDraft({})}><Undo2 /> Descartar</Button>}
          <Button variant="outline" onClick={() => save(true)} disabled={saving}><Copy /> Replicar para o ano</Button>
          <Button onClick={() => save(false)} disabled={saving || !dirty.length}><Save /> Salvar orçamento{dirty.length ? ` (${dirty.length})` : ''}</Button>
        </>} />
      <Filters>
        <Select className="w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
        <Select className="w-40" value={month} onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Ano inteiro</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </Select>
        {editable && <Checkbox label="Somente contas com valores" checked={onlyUsed} onChange={(e) => setOnlyUsed(e.target.checked)} />}
        {!editable && <span className="text-xs text-muted-foreground">Selecione um mês para editar o orçamento.</span>}
      </Filters>
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Receitas previstas" value={money(rec.budget)} />
        <StatCard label="Receitas realizadas" value={money(rec.actual)} tone="green" hint={rec.budget ? `${num((rec.actual / rec.budget) * 100, 0)}% do previsto` : undefined} />
        <StatCard label="Despesas previstas" value={money(desp.budget)} />
        <StatCard label="Despesas realizadas" value={money(desp.actual)} tone={desp.budget && desp.actual > desp.budget ? 'red' : 'amber'} hint={desp.budget ? `${num((desp.actual / desp.budget) * 100, 0)}% do previsto` : undefined} />
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-2 text-left">Conta</th><th className="px-4 py-2 text-right">Previsto</th><th className="px-4 py-2 text-right">Realizado</th><th className="px-4 py-2 text-right">Diferença</th><th className="px-4 py-2 text-left">Execução</th><th /></tr>
            </thead>
            <tbody>
              {isLoading ? <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">Carregando…</td></tr> : <>{section('RECEITA')}{section('DESPESA')}</>}
            </tbody>
            <tfoot className="border-t-2 font-bold">
              <tr>
                <td className="px-4 py-2">Resultado (receitas − despesas)</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(round2(rec.budget - desp.budget))}</td>
                <td className={cn('px-4 py-2 text-right tabular-nums', rec.actual - desp.actual < 0 ? 'text-red-600' : 'text-green-700')}>{money(round2(rec.actual - desp.actual))}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}
