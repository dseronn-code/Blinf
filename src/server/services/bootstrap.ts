import { prisma } from '@/lib/db';
import { AUTOMATIONS } from './automations';

/** Cria a estrutura padrão de uma nova empresa (depósito, contas, plano de contas, naturezas, automações) */
export async function bootstrapCompany(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return;
  await prisma.warehouse.create({ data: { companyId, name: 'Depósito Principal', code: 'PRINC', isDefault: true } });
  await prisma.bankAccount.createMany({
    data: [
      { companyId, name: 'Caixa', type: 'CAIXA' },
      { companyId, name: 'Recebíveis de cartão', type: 'CARTAO', bankName: 'Adquirentes' },
      { companyId, name: 'Conta Digital GestãoPro', type: 'CONTA_DIGITAL', bankCode: '999', bankName: 'GestãoPro Bank (simulado)', agency: '0001', accountNumber: String(Date.now()).slice(-7), pixKey: company.cnpj, isDefault: true },
    ],
  });
  const chart: [string, string, string, string][] = [
    ['1.1.01', 'Venda de mercadorias', 'RECEITA', 'RECEITA_BRUTA'], ['1.1.02', 'Vendas balcão (PDV)', 'RECEITA', 'RECEITA_BRUTA'], ['1.1.03', 'Vendas online', 'RECEITA', 'RECEITA_BRUTA'],
    ['1.1.04', 'Prestação de serviços', 'RECEITA', 'RECEITA_BRUTA'], ['2.1.01', 'Compra de mercadorias', 'DESPESA', 'CMV'], ['2.1.05', 'Tarifas de marketplaces', 'DESPESA', 'DESPESA_OPERACIONAL'],
    ['2.2.01', 'Aluguel', 'DESPESA', 'DESPESA_ADMINISTRATIVA'], ['2.3.01', 'Salários', 'DESPESA', 'DESPESA_PESSOAL'], ['2.3.03', 'Comissões', 'DESPESA', 'DESPESA_PESSOAL'],
    ['2.5.01', 'Tarifas bancárias', 'DESPESA', 'DESPESA_FINANCEIRA'], ['2.6.01', 'Impostos sobre vendas', 'DESPESA', 'DEDUCOES'], ['2.6.02', 'Devoluções de vendas', 'DESPESA', 'DEDUCOES'],
  ];
  for (const [code, name, type, dreGroup] of chart) await prisma.chartAccount.create({ data: { companyId, code, name, type, dreGroup } });
  await prisma.operationNature.createMany({
    data: [
      { companyId, name: 'Venda de mercadoria', kind: 'VENDA', cfopIntra: '5102', cfopInter: '6102', isDefault: true },
      { companyId, name: 'Venda ao consumidor (NFC-e)', kind: 'NFCE', cfopIntra: '5102', cfopInter: '6102', isDefault: true },
      { companyId, name: 'Prestação de serviços', kind: 'SERVICO', cfopIntra: '', cfopInter: '', isDefault: true },
      { companyId, name: 'Devolução de venda', kind: 'DEVOLUCAO', direction: 'ENTRADA', cfopIntra: '1202', cfopInter: '2202', finalidade: 4, isDefault: true },
      { companyId, name: 'Transferência entre filiais', kind: 'TRANSFERENCIA', cfopIntra: '5152', cfopInter: '6152', generatesFinancial: false, isDefault: true },
    ],
  });
  for (const a of AUTOMATIONS) await prisma.automation.create({ data: { companyId, key: a.key, active: a.defaultActive !== false } }).catch(() => {});
}
