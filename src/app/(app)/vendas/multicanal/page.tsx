'use client';
import { useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { useApi, qs } from '@/lib/api';
import { PageHeader, DataTable, Filters, Chips } from '@/components/common/page';
import { Card, CardContent } from '@/components/ui/card';
import { money, num, toInputDate, addDays } from '@/lib/utils';

export default function Multichannel() {
  const [days, setDays] = useState('30');
  const from = toInputDate(addDays(new Date(), -Number(days)));
  const { data } = useApi<any>(`/api/reports/vendas-canal${qs({ from, to: toInputDate(new Date()) })}`);
  return (
    <div>
      <PageHeader title="Vendas multicanal" description="Faturamento, custo, tarifas e margem por canal — marketplaces, loja virtual, PDV e venda direta" />
      <Filters><Chips value={days} onChange={setDays} options={[{ value: '7', label: '7 dias' }, { value: '30', label: '30 dias' }, { value: '90', label: '90 dias' }]} /></Filters>
      <Card className="mb-3"><CardContent className="h-72">
        <ResponsiveContainer>
          <BarChart data={data?.rows || []}>
            <XAxis dataKey="channel" fontSize={11} /><YAxis fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={(v: number) => money(v)} /><Legend />
            <Bar dataKey="revenue" name="Faturamento" fill="#16a34a" /><Bar dataKey="cost" name="CMV" fill="#94a3b8" /><Bar dataKey="fees" name="Tarifas" fill="#f59e0b" /><Bar dataKey="profit" name="Lucro bruto" fill="#2563eb" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent></Card>
      <DataTable rows={data?.rows.map((r: any) => ({ ...r, id: r.channel }))} columns={[
        { key: 'channel', header: 'Canal' }, { key: 'orders', header: 'Pedidos', align: 'right' }, { key: 'revenue', header: 'Faturamento', align: 'right', cell: (r: any) => money(r.revenue) },
        { key: 'ticket', header: 'Ticket médio', align: 'right', cell: (r: any) => money(r.revenue / r.orders) }, { key: 'cost', header: 'CMV', align: 'right', cell: (r: any) => money(r.cost) },
        { key: 'fees', header: 'Tarifas', align: 'right', cell: (r: any) => money(r.fees) }, { key: 'profit', header: 'Lucro bruto', align: 'right', cell: (r: any) => <b>{money(r.profit)}</b> }, { key: 'margin', header: 'Margem', align: 'right', cell: (r: any) => `${num(r.margin)}%` },
      ]} />
    </div>
  );
}
