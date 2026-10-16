'use client';
import { ResourceCrud } from '@/components/common/crud';

export default function Page() {
  return (
    <ResourceCrud resource="warehouses" module="estoque" title="Depósitos" description="Múltiplos depósitos por empresa. Desmarque 'disponível para venda' para não enviar o saldo aos canais."
      defaults={{ active: true, available: true }}
      columns={[{ key: 'name', header: 'Depósito' }, { key: 'code', header: 'Código' }, { key: 'isDefault', header: 'Padrão', format: 'bool' }, { key: 'available', header: 'Disponível p/ venda', format: 'bool' }, { key: 'active', header: 'Ativo', format: 'bool' }]}
      fields={[{ key: 'name', label: 'Nome', required: true, span: 2 }, { key: 'code', label: 'Código' }, { key: 'isDefault', label: 'Padrão', type: 'checkbox', hint: 'Depósito padrão' }, { key: 'available', label: 'Saldo disponível', type: 'checkbox', hint: 'Disponível para venda' }, { key: 'active', label: 'Ativo', type: 'checkbox' }]} />
  );
}
