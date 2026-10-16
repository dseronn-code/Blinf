'use client';
import { ResourceCrud } from '@/components/common/crud';
import { fmtDoc } from '@/lib/utils';
import { UFS } from '@/lib/br';

export default function Companies() {
  return (
    <ResourceCrud resource="companies" module="configuracoes" title="Empresas (multi-CNPJ)" description="Várias empresas na mesma conta, com cadastros compartilhados e documentos/estoque/financeiro por empresa. Alterne pelo seletor no topo ou use a visão consolidada."
      defaults={{ taxRegime: 'SIMPLES', uf: 'SP', logoColor: '#16a34a', nfeSeries: 1, nfceSeries: 1 }}
      columns={[{ key: 'tradeName', header: 'Nome fantasia', render: (r) => <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: r.logoColor }} />{r.tradeName || r.name}</span> }, { key: 'name', header: 'Razão social' }, { key: 'cnpj', header: 'CNPJ', render: (r) => fmtDoc(r.cnpj) }, { key: 'taxRegime', header: 'Regime' }, { key: 'city', header: 'Cidade/UF', render: (r) => `${r.city || ''}/${r.uf}` }]}
      fields={[
        { key: 'name', label: 'Razão social', required: true, span: 2 }, { key: 'tradeName', label: 'Nome fantasia' },
        { key: 'cnpj', label: 'CNPJ', required: true }, { key: 'ie', label: 'Inscrição estadual' }, { key: 'im', label: 'Inscrição municipal' },
        { key: 'taxRegime', label: 'Regime tributário', type: 'select', options: [{ value: 'SIMPLES', label: 'Simples Nacional' }, { value: 'PRESUMIDO', label: 'Lucro Presumido' }, { value: 'REAL', label: 'Lucro Real' }] },
        { key: 'email', label: 'E-mail' }, { key: 'phone', label: 'Telefone' },
        { key: 'zip', label: 'CEP' }, { key: 'street', label: 'Logradouro' }, { key: 'number', label: 'Número' }, { key: 'district', label: 'Bairro' }, { key: 'city', label: 'Cidade' },
        { key: 'uf', label: 'UF', type: 'select', options: UFS.map((u) => ({ value: u, label: u })) }, { key: 'cityCode', label: 'Código IBGE do município' },
        { key: 'nfeSeries', label: 'Série NF-e', type: 'number' }, { key: 'nfceSeries', label: 'Série NFC-e', type: 'number' }, { key: 'cscId', label: 'ID do CSC (NFC-e)' },
        { key: 'logoColor', label: 'Cor de identificação' },
      ]} />
  );
}
