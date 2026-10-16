'use client';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ResourceCrud } from '@/components/common/crud';
import { useApi, qs } from '@/lib/api';
import { DataTable, Filters, StatCard } from '@/components/common/page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { money, round2, toInputDate, startOfMonth, endOfMonth, cn } from '@/lib/utils';

type CenterRow = { center: string; revenue: number; expense: number; result: number };

function CostCenterReport() {
  const [from, setFrom] = useState(toInputDate(startOfMonth()));
  const [to, setTo] = useState(toInputDate(endOfMonth()));
  const { data, isLoading } = useApi<CenterRow[]>(`/api/finance/cost-centers${qs({ from, to })}`);
  const rows = (data || []).map((r) => ({ ...r, id: r.center }));
  const tot = { revenue: round2(rows.reduce((a, r) => a + r.revenue, 0)), expense: round2(rows.reduce((a, r) => a + r.expense, 0)) };
  const presets = [0, 1, 2].map((m) => { const d = new Date(); d.setMonth(d.getMonth() - m); return { label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }), from: toInputDate(startOfMonth(d)), to: toInputDate(endOfMonth(d)) }; });
  return (
    <div>
      <p className="mb-3 text-xs text-muted-foreground">Receitas e despesas pela data de competência. Lançamentos com <b>rateio</b> têm o valor dividido entre vários centros de custo conforme os percentuais informados no lançamento; os demais entram integralmente no centro de custo do lançamento.</p>
      <Filters>
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} title="De" />
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} title="Até" />
        {presets.map((p) => <Button key={p.label} size="sm" variant="outline" onClick={() => { setFrom(p.from); setTo(p.to); }}>{p.label}</Button>)}
        <Button size="sm" variant="outline" onClick={() => { const y = new Date().getFullYear(); setFrom(`${y}-01-01`); setTo(`${y}-12-31`); }}>Ano</Button>
      </Filters>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Receitas" value={money(tot.revenue)} tone="green" />
        <StatCard label="Despesas" value={money(tot.expense)} tone="red" />
        <StatCard label="Resultado" value={money(round2(tot.revenue - tot.expense))} tone={tot.revenue - tot.expense < 0 ? 'red' : 'blue'} />
      </div>
      <Card className="mb-3">
        <CardHeader><CardTitle>Receitas × despesas por centro de custo</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer>
            <BarChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="center" fontSize={11} interval={0} />
              <YAxis fontSize={10} tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
              <Tooltip formatter={(v: number) => money(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="revenue" name="Receitas" fill="#16a34a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" name="Despesas" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <DataTable loading={isLoading} rows={rows} empty="Nenhum lançamento no período" columns={[
        { key: 'center', header: 'Centro de custo', cell: (r) => <span className="font-medium">{r.center}</span> },
        { key: 'revenue', header: 'Receitas', align: 'right', cell: (r) => <span className="text-green-700">{money(r.revenue)}</span> },
        { key: 'expense', header: 'Despesas', align: 'right', cell: (r) => <span className="text-red-600">{money(r.expense)}</span> },
        { key: 'result', header: 'Resultado', align: 'right', cell: (r) => <b className={cn(r.result < 0 ? 'text-red-600' : 'text-blue-700')}>{money(r.result)}</b> },
        { key: 'share', header: '% das despesas', align: 'right', cell: (r) => (tot.expense ? `${((r.expense / tot.expense) * 100).toFixed(1).replace('.', ',')}%` : '—') },
      ]} footer={rows.length ? <tr><td className="px-3 py-2">Total</td><td className="num">{money(tot.revenue)}</td><td className="num">{money(tot.expense)}</td><td className="num">{money(round2(tot.revenue - tot.expense))}</td><td /></tr> : undefined} />
    </div>
  );
}

export default function Page() {
  return (
    <Tabs defaultValue="cadastro">
      <TabsList><TabsTrigger value="cadastro">Cadastro</TabsTrigger><TabsTrigger value="resultado">Resultado por centro de custo</TabsTrigger></TabsList>
      <TabsContent value="cadastro">
        <ResourceCrud resource="cost-centers" module="financeiro" title="Centros de custo" defaults={{ active: true }} columns={[{ key: 'code', header: 'Código' }, { key: 'name', header: 'Centro de custo' }, { key: 'active', header: 'Ativo', format: 'bool' }]} fields={[{ key: 'code', label: 'Código' }, { key: 'name', label: 'Nome', required: true, span: 2 }, { key: 'active', label: 'Ativo', type: 'checkbox' }]} />
      </TabsContent>
      <TabsContent value="resultado">
        <h1 className="mb-1 text-xl font-bold tracking-tight">Resultado por centro de custo</h1>
        <CostCenterReport />
      </TabsContent>
    </Tabs>
  );
}
