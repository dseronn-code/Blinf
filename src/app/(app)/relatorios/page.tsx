'use client';
import Link from 'next/link';
import { BarChart3, FileSpreadsheet, FileText } from 'lucide-react';
import { useApi } from '@/lib/api';
import { PageHeader } from '@/components/common/page';
import { Card } from '@/components/ui/card';

export default function Reports() {
  const { data } = useApi<any>('/api/reports');
  const groups = [...new Set((data?.rows || []).map((r: any) => r.group))] as string[];
  return (
    <div>
      <PageHeader title="Relatórios" description="Todos os relatórios podem ser filtrados por período e exportados em PDF ou Excel" />
      {groups.map((g) => (
        <div key={g} className="mb-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.rows.filter((r: any) => r.group === g).map((r: any) => (
              <Card key={r.key} className="flex flex-col p-4">
                <Link href={`/relatorios/${r.key}`} className="flex-1"><BarChart3 className="mb-2 h-5 w-5 text-primary" /><div className="font-semibold">{r.title}</div><div className="text-xs text-muted-foreground">{r.description}</div></Link>
                <div className="mt-3 flex gap-3 text-xs"><a className="flex items-center gap-1 text-primary" href={`/api/reports/${r.key}?format=pdf`} target="_blank"><FileText className="h-3.5 w-3.5" /> PDF</a><a className="flex items-center gap-1 text-primary" href={`/api/reports/${r.key}?format=xlsx`}><FileSpreadsheet className="h-3.5 w-3.5" /> Excel</a></div>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
