'use client';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download } from 'lucide-react';
import { useApi, openFile, useAction } from '@/lib/api';
import { PageHeader, DataTable, StatCard } from '@/components/common/page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { money, fmtDate, num } from '@/lib/utils';

export default function Delinquency() {
  const { data } = useApi<any>('/api/finance/delinquency');
  const act = useAction();
  return (
    <div>
      <PageHeader title="Inadimplência" description="Recebíveis vencidos por faixa de atraso e cliente" actions={<><Button variant="outline" onClick={() => act('POST', '/api/automations/run', {}, 'Régua de cobrança executada (lembretes simulados)')}>Executar régua de cobrança</Button><Button variant="outline" onClick={() => openFile('/api/reports/financeiro-inadimplencia?format=pdf')}><Download /> PDF</Button></>} />
      <div className="mb-3 grid grid-cols-3 gap-3"><StatCard label="Total vencido" value={money(data?.overdue)} tone="red" /><StatCard label="Total em aberto" value={money(data?.totalOpen)} /><StatCard label="Taxa de inadimplência" value={`${num(data?.rate)}%`} tone="amber" /></div>
      <div className="mb-3 grid gap-3 md:grid-cols-2">
        <Card><CardHeader><CardTitle>Por faixa de atraso</CardTitle></CardHeader><CardContent className="h-56"><ResponsiveContainer><BarChart data={data?.ranges || []}><XAxis dataKey="range" fontSize={11} /><YAxis fontSize={10} /><Tooltip formatter={(v: number) => money(v)} /><Bar dataKey="amount" name="Valor" fill="#dc2626" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></CardContent></Card>
        <Card><CardHeader><CardTitle>Maiores devedores</CardTitle></CardHeader><div className="divide-y">{(data?.byCustomer || []).slice(0, 8).map((c: any) => <div key={c.customer} className="flex justify-between px-4 py-1.5 text-sm"><span>{c.customer}</span><b className="text-red-600">{money(c.amount)}</b></div>)}</div></Card>
      </div>
      <DataTable rows={data?.rows} columns={[{ key: 'customer', header: 'Cliente' }, { key: 'description', header: 'Título' }, { key: 'dueDate', header: 'Vencimento', cell: (r: any) => fmtDate(r.dueDate) }, { key: 'daysLate', header: 'Atraso', align: 'right', cell: (r: any) => `${r.daysLate} dias` }, { key: 'range', header: 'Faixa', cell: (r: any) => <Badge tone={r.daysLate > 30 ? 'red' : 'orange'}>{r.range}</Badge> }, { key: 'open', header: 'Em aberto', align: 'right', cell: (r: any) => <b>{money(r.open)}</b> }]} />
    </div>
  );
}
