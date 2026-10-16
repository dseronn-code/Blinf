'use client';
import { ResourceCrud } from '@/components/common/crud';

export default function Page() {
  return <ResourceCrud resource="cost-centers" module="financeiro" title="Centros de custo" defaults={{ active: true }} columns={[{ key: 'code', header: 'Código' }, { key: 'name', header: 'Centro de custo' }, { key: 'active', header: 'Ativo', format: 'bool' }]} fields={[{ key: 'code', label: 'Código' }, { key: 'name', label: 'Nome', required: true, span: 2 }, { key: 'active', label: 'Ativo', type: 'checkbox' }]} />;
}
