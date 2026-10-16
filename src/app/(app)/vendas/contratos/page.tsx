'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Repeat, CalendarClock, TrendingUp, Receipt } from 'lucide-react';
import { useApi, useAction, qs } from '@/lib/api';
import { PageHeader, SearchBox, Filters, DataTable, Chips, StatCard } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { money, fmtDate } from '@/lib/utils';
import { useCan } from '@/components/layout/me';
import { INTERVAL_LABEL, ContractStatus } from './shared';

export default function Contracts() {
  const router = useRouter();
  const act = useAction();
  const canEdit = useCan()('vendas', 'edit');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ATIVO');
  const { data, isLoading } = useApi<any>(`/api/contracts${qs({ q, status })}`);
  const s = data?.summary;
  const billDue = async () => {
    const r = await act<any>('POST', '/api/contracts', { action: 'bill-due' }, false);
    if (r) {
      if (r.failed) toast.warning(`${r.billed} cobrança(s) gerada(s), ${r.failed} com erro: ${r.results.filter((x: any) => !x.ok).map((x: any) => `nº ${x.number}: ${x.message}`).join('; ')}`);
      else toast.success(r.billed ? `${r.billed} cobrança(s) gerada(s)` : 'Nenhum contrato com cobrança vencendo');
    }
  };
  return (
    <div>
      <PageHeader title="Contratos" description="Cobrança recorrente: contas a receber (boleto/Pix) e NFS-e geradas automaticamente a cada período" actions={canEdit && <>
        <Button variant="outline" onClick={billDue}><Receipt /> Faturar vencidos</Button>
        <Button asChild><Link href="/vendas/contratos/novo"><Plus /> Novo contrato</Link></Button>
      </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Receita recorrente mensal (MRR)" value={money(s?.mrr)} icon={TrendingUp} tone="green" hint="Valor mensal equivalente dos contratos ativos" />
        <StatCard label="Contratos ativos" value={s?.active ?? '—'} icon={Repeat} hint={s?.suspended ? `${s.suspended} suspenso(s)` : undefined} />
        <StatCard label="A faturar este mês" value={s?.toBillCount ?? '—'} icon={CalendarClock} tone="blue" hint={s ? money(s.toBillAmount) : undefined} />
        <StatCard label="Receita anual projetada" value={money((s?.mrr || 0) * 12)} icon={TrendingUp} hint="MRR × 12" />
      </div>
      <Filters>
        <SearchBox value={q} onChange={setQ} placeholder="Cliente, descrição ou nº" />
        <Chips value={status} onChange={setStatus} options={[{ value: 'ATIVO', label: 'Ativos' }, { value: 'SUSPENSO', label: 'Suspensos' }, { value: 'ENCERRADO', label: 'Encerrados' }, { value: '', label: 'Todos' }]} />
      </Filters>
      <DataTable loading={isLoading} rows={data?.rows} onRowClick={(r: any) => router.push(`/vendas/contratos/${r.id}`)} empty="Nenhum contrato — cadastre um contrato para cobrar seus clientes automaticamente" columns={[
        { key: 'number', header: 'Nº', cell: (r: any) => <b>{r.number}</b> },
        { key: 'customerName', header: 'Cliente' },
        { key: 'description', header: 'Descrição', cell: (r: any) => <span className="line-clamp-1 max-w-[260px]">{r.description}</span> },
        { key: 'interval', header: 'Periodicidade', cell: (r: any) => `${INTERVAL_LABEL[r.interval] || r.interval} · dia ${r.billingDay}` },
        { key: 'invoiceModel', header: 'Nota', cell: (r: any) => (r.invoiceModel === 'NENHUMA' ? '—' : r.invoiceModel === 'NFSE' ? 'NFS-e' : 'NF-e') },
        { key: 'nextBillingDate', header: 'Próxima cobrança', cell: (r: any) => (r.status === 'ATIVO' ? fmtDate(r.nextBillingDate) : '—') },
        { key: 'amount', header: 'Valor', align: 'right', cell: (r: any) => money(r.amount) },
        { key: 'monthly', header: 'MRR', align: 'right', cell: (r: any) => <span className="text-muted-foreground">{money(r.monthly)}</span> },
        { key: 'status', header: 'Situação', cell: (r: any) => <ContractStatus status={r.status} /> },
      ]} />
    </div>
  );
}
