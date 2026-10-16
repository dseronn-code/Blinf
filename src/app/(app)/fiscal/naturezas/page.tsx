'use client';
import { ResourceCrud } from '@/components/common/crud';

const KIND = ['VENDA', 'NFCE', 'SERVICO', 'DEVOLUCAO', 'REMESSA', 'COMPRA'].map((v) => ({ value: v, label: v }));
export default function Page() {
  return (
    <ResourceCrud resource="natures" module="fiscal" title="Naturezas de operação" description="CFOPs e tributação configuráveis por operação (intra e interestadual)"
      defaults={{ kind: 'VENDA', direction: 'SAIDA', cfopIntra: '5102', cfopInter: '6102', icmsCst: '00', csosn: '102', icmsRateIntra: 18, icmsRateInter: 12, pisRate: 1.65, cofinsRate: 7.6, issRate: 5, movesStock: true, generatesFinancial: true, finalidade: 1 }}
      columns={[{ key: 'name', header: 'Natureza' }, { key: 'kind', header: 'Tipo' }, { key: 'direction', header: 'E/S' }, { key: 'cfopIntra', header: 'CFOP intra' }, { key: 'cfopInter', header: 'CFOP inter' }, { key: 'csosn', header: 'CSOSN' }, { key: 'icmsCst', header: 'CST ICMS' }, { key: 'icmsRateIntra', header: 'ICMS intra', format: 'percent' }, { key: 'isDefault', header: 'Padrão', format: 'bool' }]}
      fields={[
        { key: 'name', label: 'Descrição', required: true, span: 2 }, { key: 'kind', label: 'Tipo', type: 'select', options: KIND },
        { key: 'direction', label: 'Entrada/Saída', type: 'select', options: [{ value: 'SAIDA', label: 'Saída' }, { value: 'ENTRADA', label: 'Entrada' }] }, { key: 'cfopIntra', label: 'CFOP dentro do estado' }, { key: 'cfopInter', label: 'CFOP fora do estado' },
        { key: 'csosn', label: 'CSOSN (Simples Nacional)' }, { key: 'icmsCst', label: 'CST ICMS (Regime normal)' }, { key: 'ipiCst', label: 'CST IPI' },
        { key: 'icmsRateIntra', label: 'Alíq. ICMS interna (%)', type: 'percent' }, { key: 'icmsRateInter', label: 'Alíq. ICMS interestadual (%)', type: 'percent' }, { key: 'issRate', label: 'Alíq. ISS (%)', type: 'percent' },
        { key: 'pisCst', label: 'CST PIS' }, { key: 'pisRate', label: 'PIS (%)', type: 'percent' }, { key: 'cofinsRate', label: 'COFINS (%)', type: 'percent' },
        { key: 'finalidade', label: 'Finalidade', type: 'select', options: [{ value: '1', label: '1 - Normal' }, { value: '4', label: '4 - Devolução' }] },
        { key: 'movesStock', label: 'Movimenta estoque', type: 'checkbox' }, { key: 'generatesFinancial', label: 'Gera financeiro', type: 'checkbox' }, { key: 'isDefault', label: 'Padrão para o tipo', type: 'checkbox' },
        { key: 'notes', label: 'Informações complementares padrão', type: 'textarea', span: 3 },
      ]} />
  );
}
