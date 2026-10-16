'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Plus, Upload, Tag } from 'lucide-react';
import { useApi, qs } from '@/lib/api';
import { PageHeader, SearchBox, Filters, DataTable, Pagination, Chips } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { money, num } from '@/lib/utils';
import { KIND_LABEL } from '@/lib/labels';


export default function ProductsPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || '');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useApi<any>(`/api/products${qs({ q, kind, page })}`);
  return (
    <div>
      <PageHeader title="Produtos" description="Simples, com variações (grade), kits, fabricados (ficha técnica), matérias-primas e controle de lote/validade"
        actions={<><Button variant="outline" asChild><Link href="/estoque/etiquetas"><Tag /> Etiquetas</Link></Button><Button variant="outline" asChild><Link href="/cadastros/importacao"><Upload /> Importar</Link></Button><Button asChild><Link href="/cadastros/produtos/novo"><Plus /> Incluir produto</Link></Button></>} />
      <Filters>
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Nome, SKU ou código de barras" />
        <Chips value={kind} onChange={(v) => { setKind(v); setPage(1); }} options={[{ value: '', label: 'Todos' }, ...Object.entries(KIND_LABEL).filter(([k]) => k !== 'VARIACAO').map(([value, [label]]) => ({ value, label }))]} />
      </Filters>
      <DataTable loading={isLoading} rows={data?.rows} onRowClick={(r: any) => router.push(`/cadastros/produtos/${r.id}`)} columns={[
        { key: 'sku', header: 'Código (SKU)', cell: (r: any) => <span className="font-mono text-xs">{r.sku}</span> },
        { key: 'name', header: 'Descrição', cell: (r: any) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.category?.name}{r._count?.variations ? ` · ${r._count.variations} variações` : ''}{r._count?.components ? ` · ${r._count.components} componentes` : ''}</div></div> },
        { key: 'kind', header: 'Tipo', cell: (r: any) => <Badge tone={KIND_LABEL[r.kind]?.[1]}>{KIND_LABEL[r.kind]?.[0]}</Badge> },
        { key: 'unit', header: 'UN' },
        { key: 'price', header: 'Preço', align: 'right', cell: (r: any) => money(r.price) },
        { key: 'costPrice', header: 'Custo', align: 'right', cell: (r: any) => money(r.costPrice) },
        { key: 'stock', header: 'Físico', align: 'right', cell: (r: any) => num(r.stock?.quantity) },
        { key: 'reserved', header: 'Reservado', align: 'right', cell: (r: any) => num(r.stock?.reserved) },
        { key: 'available', header: 'Disponível', align: 'right', cell: (r: any) => <span className={r.stock?.available <= 0 ? 'font-bold text-red-600' : r.minStock && r.stock?.available < r.minStock ? 'font-semibold text-amber-600' : 'font-semibold'}>{num(r.stock?.available)}</span> },
        { key: 'active', header: '', cell: (r: any) => (!r.active ? <Badge tone="red">inativo</Badge> : null) },
      ]} />
      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}
