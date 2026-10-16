'use client';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, FileSpreadsheet, FileText } from 'lucide-react';
import { useApi, qs, openFile } from '@/lib/api';
import { PageHeader, Filters, DataTable } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { money, num, fmtDate, toInputDate, addDays } from '@/lib/utils';

export default function ReportView() {
  const { key } = useParams<{ key: string }>();
  const router = useRouter();
  const [from, setFrom] = useState(toInputDate(addDays(new Date(), -30)));
  const [to, setTo] = useState(toInputDate(new Date()));
  const { data, isLoading } = useApi<any>(`/api/reports/${key}${qs({ from, to })}`);
  const fmt = (c: any, v: any) => (c.type === 'money' ? money(v) : c.type === 'date' ? fmtDate(v) : c.type === 'percent' ? `${num(v)}%` : c.type === 'number' ? num(v, 3) : String(v ?? ''));
  return (
    <div>
      <PageHeader title={data?.title || 'Relatório'} description={data?.subtitle} actions={<><Button variant="outline" onClick={() => router.push('/relatorios')}><ArrowLeft /> Voltar</Button><Button variant="outline" onClick={() => openFile(`/api/reports/${key}${qs({ from, to, format: 'pdf' })}`)}><FileText /> PDF</Button><Button variant="outline" onClick={() => openFile(`/api/reports/${key}${qs({ from, to, format: 'xlsx' })}`)}><FileSpreadsheet /> Excel</Button></>} />
      <Filters><Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} /><Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} /><span className="text-xs text-muted-foreground">{data?.rows.length ?? 0} linha(s)</span></Filters>
      <DataTable loading={isLoading} rows={data?.rows.map((r: any, i: number) => ({ ...r, id: String(i) }))}
        footer={data?.totals && <tr>{data.columns.map((c: any) => <td key={c.key} className={c.align === 'right' ? 'num px-3 py-2' : 'px-3 py-2'}>{data.totals[c.key] != null ? fmt(c, data.totals[c.key]) : ''}</td>)}</tr>}
        columns={(data?.columns || []).map((c: any) => ({ key: c.key, header: c.label, align: c.align, cell: (r: any) => fmt(c, r[c.key]) }))} />
    </div>
  );
}
