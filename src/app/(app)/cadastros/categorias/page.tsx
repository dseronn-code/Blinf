'use client';
import { ResourceCrud } from '@/components/common/crud';

export default function Page() {
  return <ResourceCrud resource="categories" module="cadastros" title="Categorias de produtos" columns={[{ key: 'name', header: 'Categoria' }, { key: '_count', header: 'Produtos', render: (r) => r._count?.products ?? 0 }]} fields={[{ key: 'name', label: 'Nome', required: true, span: 3 }]} />;
}
