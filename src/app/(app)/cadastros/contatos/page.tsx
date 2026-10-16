'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus, Upload } from 'lucide-react';
import { useApi, qs } from '@/lib/api';
import { PageHeader, SearchBox, Filters, DataTable, Pagination, Chips } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fmtDoc, money } from '@/lib/utils';

export default function ContactsPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useApi<any>(`/api/r/contacts${qs({ q, type, page })}`);
  return (
    <div>
      <PageHeader title="Clientes e fornecedores" description="Cadastro unificado de contatos (PF/PJ) com endereços, pessoas de contato e limite de crédito"
        actions={<><Button variant="outline" asChild><Link href="/cadastros/importacao"><Upload /> Importar</Link></Button><Button asChild><Link href="/cadastros/contatos/novo"><Plus /> Incluir contato</Link></Button></>} />
      <Filters>
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Nome, CPF/CNPJ, e-mail, cidade…" />
        <Chips value={type} onChange={(v) => { setType(v); setPage(1); }} options={[{ value: '', label: 'Todos' }, { value: 'CLIENTE', label: 'Clientes' }, { value: 'FORNECEDOR', label: 'Fornecedores' }, { value: 'TRANSPORTADORA', label: 'Transportadoras' }]} />
      </Filters>
      <DataTable loading={isLoading} rows={data?.rows} onRowClick={(r: any) => router.push(`/cadastros/contatos/${r.id}`)} columns={[
        { key: 'name', header: 'Nome / Razão social', cell: (r: any) => <div><div className="font-medium">{r.name}</div>{r.tradeName && <div className="text-xs text-muted-foreground">{r.tradeName}</div>}</div> },
        { key: 'document', header: 'CPF/CNPJ', cell: (r: any) => fmtDoc(r.document) || '—' },
        { key: 'types', header: 'Tipo', cell: (r: any) => <div className="flex gap-1">{r.types.map((t: string) => <Badge key={t} tone={t === 'CLIENTE' ? 'green' : t === 'FORNECEDOR' ? 'blue' : 'purple'}>{t.toLowerCase()}</Badge>)}<Badge>{r.personType}</Badge></div> },
        { key: 'city', header: 'Cidade/UF', cell: (r: any) => (r.city ? `${r.city}/${r.uf}` : '—') },
        { key: 'email', header: 'Contato', cell: (r: any) => <div className="text-xs">{r.email}<br />{r.mobile || r.phone}</div> },
        { key: 'priceList', header: 'Lista de preço', cell: (r: any) => r.priceList?.name || '—' },
        { key: 'creditLimit', header: 'Limite crédito', align: 'right', cell: (r: any) => (r.creditLimit ? money(r.creditLimit) : '—') },
      ]} />
      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}
