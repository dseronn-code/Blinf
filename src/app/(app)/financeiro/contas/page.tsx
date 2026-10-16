'use client';
import { ResourceCrud } from '@/components/common/crud';

const TYPES = [{ value: 'CAIXA', label: 'Caixa' }, { value: 'CORRENTE', label: 'Conta corrente' }, { value: 'POUPANCA', label: 'Poupança' }, { value: 'CONTA_DIGITAL', label: 'Conta digital' }, { value: 'CARTAO', label: 'Cartão' }];
export default function Page() {
  return (
    <ResourceCrud resource="bank-accounts" module="financeiro" title="Contas bancárias e caixas" defaults={{ type: 'CORRENTE', active: true }}
      columns={[{ key: 'name', header: 'Conta' }, { key: 'type', header: 'Tipo', render: (r) => TYPES.find((t) => t.value === r.type)?.label }, { key: 'bankName', header: 'Banco' }, { key: 'agency', header: 'Agência' }, { key: 'accountNumber', header: 'Conta' }, { key: 'initialBalance', header: 'Saldo inicial', format: 'money' }, { key: 'isDefault', header: 'Padrão', format: 'bool' }]}
      fields={[{ key: 'name', label: 'Nome', required: true, span: 2 }, { key: 'type', label: 'Tipo', type: 'select', options: TYPES }, { key: 'bankCode', label: 'Código do banco' }, { key: 'bankName', label: 'Banco' }, { key: 'agency', label: 'Agência' }, { key: 'accountNumber', label: 'Número da conta' }, { key: 'pixKey', label: 'Chave Pix' }, { key: 'initialBalance', label: 'Saldo inicial', type: 'money' }, { key: 'isDefault', label: 'Conta padrão', type: 'checkbox' }, { key: 'active', label: 'Ativa', type: 'checkbox' }]} />
  );
}
