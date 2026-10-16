'use client';
import { ResourceCrud } from '@/components/common/crud';

export default function Page() {
  return (
    <ResourceCrud resource="services" module="cadastros" title="Serviços" description="Serviços prestados (base para NFS-e e ordens de serviço)"
      defaults={{ unit: 'UN', issRate: 5, active: true }}
      columns={[{ key: 'code', header: 'Código' }, { key: 'name', header: 'Descrição' }, { key: 'serviceCode', header: 'Item LC 116' }, { key: 'issRate', header: 'ISS', format: 'percent' }, { key: 'price', header: 'Preço', format: 'money' }, { key: 'active', header: 'Ativo', format: 'bool' }]}
      fields={[
        { key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Descrição', required: true, span: 2 },
        { key: 'price', label: 'Preço (R$)', type: 'money' }, { key: 'unit', label: 'Unidade' }, { key: 'issRate', label: 'Alíquota ISS (%)', type: 'percent' },
        { key: 'serviceCode', label: 'Item da lista de serviços (LC 116)', placeholder: 'ex.: 14.01' }, { key: 'cnae', label: 'CNAE' }, { key: 'active', label: 'Ativo', type: 'checkbox' },
        { key: 'description', label: 'Descrição detalhada', type: 'textarea', span: 3 },
      ]} />
  );
}
