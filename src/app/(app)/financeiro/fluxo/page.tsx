'use client';
import { useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download } from 'lucide-react';
import { useApi, qs, openFile } from '@/lib/api';
import { PageHeader, Filters, DataTable, StatCard, Chips } from '@/components/common/page';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { money, toInputDate, addDays } from '@/lib/utils';

export default function CashFlow() {
  const [from, setFrom] = useState(toInputDate(addDays(new Date(), -15)));
  const [to, setTo] = useState(toInputDate(addDays(new Date(), 30)));
  const [gran, setGran] = useState('day');
  const { data } = useApi<any>(`/api/finance/cashflow${qs({ from, to, granularity: gran })}`);
  const today = toInputDate(new Date());
  return (
    <div>
      <PageHeader title="Fluxo de caixa" description="Realizado (movimentos bancários) + previsto (contas em aberto; vencidas entram como previstas para hoje)" actions={<Button variant="outline" onClick={() => openFile(`/api/reports/financeiro-fluxo${qs({ from, to, format: 'pdf' })}`)}><Download /> PDF</Button>} />
      <Filters>
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        <Chips value={gran} onChange={setGran} options={[{ value: 'day', label: 'Diário' }, { value: 'month', label: 'Mensal' }]} />
      </Filters>
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Saldo inicial" value={money(data?.opening)} />
        <StatCard label="Entradas (real + previsto)" value={money(data?.rows.reduce((a: number, r: any) => a + r.realizedIn + r.expectedIn, 0))} tone="green" />
        <StatCard label="Saídas (real + previsto)" value={money(data?.rows.reduce((a: number, r: any) => a + r.realizedOut + r.expectedOut, 0))} tone="red" />
        <StatCard label="Saldo final projetado" value={money(data?.closing)} tone={data?.closing < 0 ? 'red' : 'blue'} />
      </div>
      <Card className="mb-3"><CardContent className="h-80">
        <ResponsiveContainer>
          <ComposedChart data={data?.rows || []}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="period" fontSize={10} tickFormatter={(p) => (gran === 'day' ? p.slice(8, 10) + '/' + p.slice(5, 7) : p)} />
            <YAxis fontSize={10} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => money(v)} />
            <Legend />
            <Bar dataKey="realizedIn" stackId="in" name="Entradas realizadas" fill="#16a34a" />
            <Bar dataKey="expectedIn" stackId="in" name="A receber" fill="#86efac" />
            <Bar dataKey="realizedOut" stackId="out" name="Saídas realizadas" fill="#dc2626" />
            <Bar dataKey="expectedOut" stackId="out" name="A pagar" fill="#fca5a5" />
            <Line dataKey="balance" name="Saldo" stroke="#2563eb" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent></Card>
      <DataTable rows={data?.rows.map((r: any) => ({ ...r, id: r.period }))} rowClassName={(r: any) => (r.period === today ? 'bg-accent/50 font-semibold' : '')} columns={[
        { key: 'period', header: 'Data', cell: (r: any) => (gran === 'day' ? r.period.split('-').reverse().join('/') : r.period) },
        { key: 'realizedIn', header: 'Entradas realizadas', align: 'right', cell: (r: any) => money(r.realizedIn) },
        { key: 'realizedOut', header: 'Saídas realizadas', align: 'right', cell: (r: any) => money(r.realizedOut) },
        { key: 'expectedIn', header: 'A receber', align: 'right', cell: (r: any) => money(r.expectedIn) },
        { key: 'expectedOut', header: 'A pagar', align: 'right', cell: (r: any) => money(r.expectedOut) },
        { key: 'net', header: 'Resultado', align: 'right', cell: (r: any) => <span className={r.net < 0 ? 'text-red-600' : 'text-green-700'}>{money(r.net)}</span> },
        { key: 'balance', header: 'Saldo', align: 'right', cell: (r: any) => <b className={r.balance < 0 ? 'text-red-600' : ''}>{money(r.balance)}</b> },
      ]} />
    </div>
  );
}
