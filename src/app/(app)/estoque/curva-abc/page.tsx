'use client';
import { useState } from 'react';
import { Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download } from 'lucide-react';
import { useApi, openFile } from '@/lib/api';
import { PageHeader, DataTable, Chips, Filters, StatCard } from '@/components/common/page';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { money, num } from '@/lib/utils';

export default function Abc() {
  const [days, setDays] = useState('90');
  const [by, setBy] = useState('value');
  const { data, isLoading } = useApi<any>(`/api/stock/abc?days=${days}&by=${by}`);
  return (
    <div>
      <PageHeader title="Curva ABC" description="Classificação dos produtos pela participação acumulada: A até 80%, B até 95%, C restante" actions={<Button variant="outline" onClick={() => openFile(`/api/reports/estoque-abc?format=xlsx`)}><Download /> Excel</Button>} />
      <Filters>
        <Chips value={days} onChange={setDays} options={[{ value: '30', label: '30 dias' }, { value: '90', label: '90 dias' }, { value: '180', label: '180 dias' }, { value: '365', label: '12 meses' }]} />
        <Chips value={by} onChange={setBy} options={[{ value: 'value', label: 'Por faturamento' }, { value: 'quantity', label: 'Por quantidade' }]} />
      </Filters>
      <div className="mb-3 grid grid-cols-3 gap-3">
        {data?.summary.map((s: any) => <StatCard key={s.class} label={`Classe ${s.class}`} value={`${s.products} produtos`} hint={money(s.revenue)} tone={s.class === 'A' ? 'green' : s.class === 'B' ? 'blue' : 'amber'} />)}
      </div>
      <Card className="mb-3"><CardContent className="h-64">
        <ResponsiveContainer>
          <ComposedChart data={(data?.rows || []).slice(0, 40)}>
            <XAxis dataKey="sku" fontSize={9} interval={0} angle={-45} textAnchor="end" height={60} />
            <YAxis yAxisId="l" fontSize={10} tickFormatter={(v) => (by === 'value' ? `${(v / 1000).toFixed(0)}k` : v)} />
            <YAxis yAxisId="r" orientation="right" domain={[0, 100]} fontSize={10} unit="%" />
            <Tooltip formatter={(v: number, n: string) => (n === '% acumulado' ? `${v}%` : by === 'value' ? money(v) : v)} />
            <Bar yAxisId="l" dataKey={by === 'value' ? 'revenue' : 'quantity'} name={by === 'value' ? 'Faturamento' : 'Quantidade'} fill="#16a34a" />
            <Line yAxisId="r" dataKey="cumulative" name="% acumulado" stroke="#2563eb" dot={false} strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent></Card>
      <DataTable loading={isLoading} rows={data?.rows.map((r: any) => ({ ...r, id: r.productId }))} columns={[
        { key: 'class', header: 'Classe', cell: (r: any) => <Badge tone={r.class === 'A' ? 'green' : r.class === 'B' ? 'blue' : 'yellow'}>{r.class}</Badge> },
        { key: 'sku', header: 'SKU' }, { key: 'name', header: 'Produto' },
        { key: 'quantity', header: 'Qtd vendida', align: 'right', cell: (r: any) => num(r.quantity) },
        { key: 'revenue', header: 'Faturamento', align: 'right', cell: (r: any) => money(r.revenue) },
        { key: 'profit', header: 'Lucro bruto', align: 'right', cell: (r: any) => money(r.profit) },
        { key: 'margin', header: 'Margem', align: 'right', cell: (r: any) => `${num(r.margin)}%` },
        { key: 'share', header: '% part.', align: 'right', cell: (r: any) => `${num(r.share)}%` },
        { key: 'cumulative', header: '% acum.', align: 'right', cell: (r: any) => `${num(r.cumulative)}%` },
      ]} />
    </div>
  );
}
