'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Plus, Download } from 'lucide-react';
import { useApi, qs, openFile } from '@/lib/api';
import { PageHeader, SearchBox, Filters, DataTable, Pagination, Chips, StatCard, SimBanner, useDemoMode } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { money, fmtDateTime, fmtDoc } from '@/lib/utils';

const TITLES: Record<string, string> = { NFE: 'NF-e — Nota Fiscal Eletrônica (modelo 55)', NFCE: 'NFC-e — Nota Fiscal de Consumidor (modelo 65)', NFSE: 'NFS-e — Nota Fiscal de Serviços' };
export default function Invoices() {
  const router = useRouter();
  const sp = useSearchParams();
  const model = sp.get('model') || 'NFE';
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useApi<any>(`/api/invoices${qs({ model, q, status, page })}`);
  const demo = useDemoMode();
  const { data: company } = useApi<{ fiscalProvider?: string }>('/api/company');
  const noProvider = !demo && !!company && !['SEFAZ', 'FOCUS_NFE'].includes(company.fiscalProvider || '');
  return (
    <div>
      <PageHeader title={TITLES[model]} description="Emitidas a partir de pedidos (1 clique), PDV, OS ou avulsas" actions={<><Button variant="outline" onClick={() => openFile('/api/reports/fiscal-notas?format=xlsx')}><Download /> Excel</Button><Button asChild><Link href={`/fiscal/nova?model=${model}`}><Plus /> Emitir nota avulsa</Link></Button></>} />
      {noProvider && <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><b>Nenhum emissor fiscal configurado.</b> Para emitir notas, instale o certificado A1 e escolha SEFAZ direta em <Link className="underline" href="/fiscal/certificado">Notas fiscais → Certificado</Link> (ou conecte a Focus NFe em Integrações → Contas e credenciais). Enquanto isso, os pedidos podem ser faturados sem nota.</div>}
      <SimBanner>a transmissão usa uma SEFAZ/prefeitura simulada com regras de validação e códigos de rejeição reais (ex.: 778 NCM inexistente, 232 IE do destinatário). Nenhum documento tem valor fiscal.</SimBanner>
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Total autorizado (filtro)" value={money(data?.sums.total)} tone="green" />
        <StatCard label={model === 'NFSE' ? 'ISS' : 'ICMS'} value={money(model === 'NFSE' ? data?.sums.issValue : data?.sums.icmsValue)} />
        <StatCard label="IPI" value={money(data?.sums.ipiValue)} />
        <StatCard label="PIS" value={money(data?.sums.pisValue)} />
        <StatCard label="COFINS" value={money(data?.sums.cofinsValue)} />
      </div>
      <Filters>
        <Chips value={model} onChange={(m) => router.push(`/fiscal/notas?model=${m}`)} options={[{ value: 'NFE', label: 'NF-e' }, { value: 'NFCE', label: 'NFC-e' }, { value: 'NFSE', label: 'NFS-e' }]} />
        <SearchBox value={q} onChange={setQ} placeholder="Destinatário, número ou chave" />
        <Chips value={status} onChange={setStatus} options={[{ value: '', label: 'Todas' }, { value: 'AUTORIZADA', label: 'Autorizadas' }, { value: 'REJEITADA', label: 'Rejeitadas' }, { value: 'RASCUNHO', label: 'Rascunhos' }, { value: 'CANCELADA', label: 'Canceladas' }]} />
      </Filters>
      <DataTable loading={isLoading} rows={data?.rows} onRowClick={(r: any) => router.push(`/fiscal/notas/${r.id}`)} columns={[
        { key: 'number', header: 'Número', cell: (r: any) => <b>{r.number}<span className="text-xs font-normal text-muted-foreground">/{r.series}</span></b> },
        { key: 'issueDate', header: 'Emissão', cell: (r: any) => fmtDateTime(r.issueDate) },
        { key: 'customerName', header: 'Destinatário', cell: (r: any) => <div><div className="max-w-[240px] truncate">{r.customerName}</div><div className="text-xs text-muted-foreground">{fmtDoc(r.customerDoc)}</div></div> },
        { key: 'natureName', header: 'Natureza', cell: (r: any) => <span className="text-xs">{r.natureName}</span> },
        { key: 'accessKey', header: 'Chave / protocolo', cell: (r: any) => <span className="font-mono text-[10px]">{r.accessKey || '—'}</span> },
        { key: 'total', header: 'Total', align: 'right', cell: (r: any) => money(r.total) },
        { key: 'status', header: 'Situação', cell: (r: any) => <div><StatusBadge status={r.status} />{r.rejectionReason && <div className="max-w-[180px] truncate text-[10px] text-red-600" title={r.rejectionReason}>{r.rejectionReason}</div>}</div> },
      ]} />
      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}
