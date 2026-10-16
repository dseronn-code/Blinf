'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useApi, qs } from '@/lib/api';
import { PageHeader, SearchBox, Filters, DataTable, Chips } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { money, fmtDate } from '@/lib/utils';

export default function ServiceOrders() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const { data, isLoading } = useApi<any>(`/api/service-orders${qs({ q, status })}`);
  return (
    <div>
      <PageHeader title="Ordens de serviço" description="Abertura, diagnóstico, execução, histórico e faturamento com NFS-e, baixa de peças e contas a receber" actions={<Button asChild><Link href="/servicos/novo"><Plus /> Nova OS</Link></Button>} />
      <Filters><SearchBox value={q} onChange={setQ} placeholder="Cliente, equipamento, nº de série" /><Chips value={status} onChange={setStatus} options={[{ value: '', label: 'Todas' }, { value: 'ABERTA,ORCAMENTO,APROVADA', label: 'Abertas' }, { value: 'EM_EXECUCAO,AGUARDANDO_PECA', label: 'Em andamento' }, { value: 'CONCLUIDA', label: 'Concluídas' }, { value: 'FATURADA', label: 'Faturadas' }]} /></Filters>
      <DataTable loading={isLoading} rows={data?.rows} onRowClick={(r: any) => router.push(`/servicos/${r.id}`)} columns={[
        { key: 'number', header: 'OS', cell: (r: any) => <b>{r.number}</b> }, { key: 'openedAt', header: 'Abertura', cell: (r: any) => fmtDate(r.openedAt) },
        { key: 'customer', header: 'Cliente', cell: (r: any) => r.customer.name }, { key: 'equipment', header: 'Equipamento', cell: (r: any) => `${r.equipment || ''} ${r.brand || ''} ${r.model || ''}` },
        { key: 'problem', header: 'Defeito', cell: (r: any) => <span className="line-clamp-1 max-w-[220px] text-xs">{r.problem}</span> }, { key: 'technician', header: 'Técnico' },
        { key: 'priority', header: 'Prioridade', cell: (r: any) => <Badge tone={r.priority === 'URGENTE' ? 'red' : r.priority === 'ALTA' ? 'orange' : 'gray'}>{r.priority}</Badge> },
        { key: 'dueDate', header: 'Previsão', cell: (r: any) => fmtDate(r.dueDate) }, { key: 'total', header: 'Total', align: 'right', cell: (r: any) => money(r.total) },
        { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> },
      ]} />
    </div>
  );
}
