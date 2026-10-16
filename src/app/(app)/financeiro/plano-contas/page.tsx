'use client';
import { ResourceCrud } from '@/components/common/crud';
import { Badge } from '@/components/ui/badge';

const GROUPS = ['RECEITA_BRUTA', 'DEDUCOES', 'CMV', 'DESPESA_OPERACIONAL', 'DESPESA_ADMINISTRATIVA', 'DESPESA_PESSOAL', 'DESPESA_FINANCEIRA', 'RECEITA_FINANCEIRA', 'OUTRAS'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));
export default function Page() {
  return (
    <ResourceCrud resource="chart-accounts" module="financeiro" title="Plano de contas" description="Categorias financeiras e seu grupo no DRE"
      filter={{ key: 'type', options: [{ value: '', label: 'Todas' }, { value: 'RECEITA', label: 'Receitas' }, { value: 'DESPESA', label: 'Despesas' }] }}
      defaults={{ type: 'DESPESA', dreGroup: 'DESPESA_OPERACIONAL', active: true }}
      columns={[{ key: 'code', header: 'Código' }, { key: 'name', header: 'Conta' }, { key: 'type', header: 'Tipo', render: (r) => <Badge tone={r.type === 'RECEITA' ? 'green' : 'red'}>{r.type}</Badge> }, { key: 'dreGroup', header: 'Grupo DRE', render: (r) => r.dreGroup.replace(/_/g, ' ') }]}
      fields={[{ key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nome', required: true, span: 2 }, { key: 'type', label: 'Tipo', type: 'select', options: [{ value: 'RECEITA', label: 'Receita' }, { value: 'DESPESA', label: 'Despesa' }] }, { key: 'dreGroup', label: 'Grupo no DRE', type: 'select', options: GROUPS }, { key: 'active', label: 'Ativa', type: 'checkbox' }]} />
  );
}
