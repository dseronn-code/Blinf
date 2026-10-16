'use client';
import { ResourceCrud } from '@/components/common/crud';
import { Badge } from '@/components/ui/badge';

const KINDS = [{ value: 'VENDEDOR', label: 'Vendedor' }, { value: 'FUNCIONARIO', label: 'Funcionário' }, { value: 'TECNICO', label: 'Técnico' }];
export default function Page() {
  return (
    <ResourceCrud resource="sellers" module="cadastros" title="Vendedores e funcionários" description="Comissão configurável por vendedor: liberada no faturamento ou no recebimento"
      filter={{ key: 'kind', options: [{ value: '', label: 'Todos' }, ...KINDS] }}
      defaults={{ kind: 'VENDEDOR', commissionBase: 'FATURAMENTO', active: true }}
      columns={[{ key: 'name', header: 'Nome' }, { key: 'kind', header: 'Tipo', render: (r) => <Badge tone={r.kind === 'VENDEDOR' ? 'green' : r.kind === 'TECNICO' ? 'blue' : 'gray'}>{KINDS.find((k) => k.value === r.kind)?.label}</Badge> }, { key: 'email', header: 'E-mail' }, { key: 'commissionRate', header: 'Comissão', format: 'percent' }, { key: 'commissionBase', header: 'Base', render: (r) => (r.commissionBase === 'RECEBIMENTO' ? 'No recebimento' : 'No faturamento') }, { key: 'active', header: 'Ativo', format: 'bool' }]}
      fields={[
        { key: 'name', label: 'Nome', required: true, span: 2 }, { key: 'kind', label: 'Tipo', type: 'select', options: KINDS },
        { key: 'email', label: 'E-mail' }, { key: 'phone', label: 'Telefone' }, { key: 'document', label: 'CPF' },
        { key: 'commissionRate', label: 'Comissão (%)', type: 'percent' }, { key: 'commissionBase', label: 'Liberar comissão', type: 'select', options: [{ value: 'FATURAMENTO', label: 'No faturamento' }, { value: 'RECEBIMENTO', label: 'No recebimento' }] }, { key: 'active', label: 'Ativo', type: 'checkbox' },
      ]} />
  );
}
