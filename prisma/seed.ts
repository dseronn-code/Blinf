/**
 * Seed de demonstração do GestãoPro.
 * Os pedidos, compras, notas e financeiro são gerados pelos PRÓPRIOS serviços
 * do sistema (mesmos fluxos usados pela interface), garantindo dados
 * consistentes entre módulos. Depois, as datas são "envelhecidas" para formar
 * um histórico de ~90 dias.
 *
 * Uso: npm run db:seed   (use SEED_FORCE=1 para recriar mesmo com dados)
 */
import { prisma } from '../src/lib/db';
import bcrypt from 'bcryptjs';
import { DEFAULT_ROLES } from '../src/lib/permissions';
import { generateCPF, buildEan13 } from '../src/lib/br';
import { addDays, round2, randomInt, pick, randomDigits } from '../src/lib/utils';
import { moveStock } from '../src/server/services/stock';
import { createOrder, invoiceOrder, cancelOrder, saveQuote, approveQuote, setOrderStatus, type Actor } from '../src/server/services/sales';
import { payEntry, createEntries } from '../src/server/services/finance';
import { savePurchase, receivePurchase, importNfeXml, sampleSupplierXml } from '../src/server/services/purchases';
import { connectChannel, publishListings, importOrders } from '../src/server/services/integrations';
import { advanceTracking } from '../src/server/services/logistics';
import { createProductionOrder, finishProduction, startProduction } from '../src/server/services/production';
import { saveServiceOrder, changeServiceOrderStatus, invoiceServiceOrder } from '../src/server/services/serviceOrders';
import { AUTOMATIONS } from '../src/server/services/automations';

// mesmo client usado pelos serviços
const log = (...a: unknown[]) => console.log('  •', ...a);

async function wipe() {
  // Ordem respeitando FKs
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(',')} CASCADE`);
}

const CHART = [
  ['1', 'Receitas', 'RECEITA', 'RECEITA_BRUTA'],
  ['1.1.01', 'Venda de mercadorias', 'RECEITA', 'RECEITA_BRUTA'],
  ['1.1.02', 'Vendas balcão (PDV)', 'RECEITA', 'RECEITA_BRUTA'],
  ['1.1.03', 'Vendas online (loja e marketplaces)', 'RECEITA', 'RECEITA_BRUTA'],
  ['1.1.04', 'Prestação de serviços', 'RECEITA', 'RECEITA_BRUTA'],
  ['1.2.01', 'Rendimentos de aplicações', 'RECEITA', 'RECEITA_FINANCEIRA'],
  ['1.3.01', 'Outras receitas', 'RECEITA', 'OUTRAS'],
  ['2', 'Despesas', 'DESPESA', 'DESPESA_OPERACIONAL'],
  ['2.1.01', 'Compra de mercadorias / matéria-prima', 'DESPESA', 'CMV'],
  ['2.1.05', 'Tarifas de marketplaces', 'DESPESA', 'DESPESA_OPERACIONAL'],
  ['2.1.06', 'Fretes e envios', 'DESPESA', 'DESPESA_OPERACIONAL'],
  ['2.2.01', 'Aluguel', 'DESPESA', 'DESPESA_ADMINISTRATIVA'],
  ['2.2.02', 'Energia elétrica', 'DESPESA', 'DESPESA_ADMINISTRATIVA'],
  ['2.2.03', 'Internet e telefone', 'DESPESA', 'DESPESA_ADMINISTRATIVA'],
  ['2.2.04', 'Contabilidade', 'DESPESA', 'DESPESA_ADMINISTRATIVA'],
  ['2.2.05', 'Software e sistemas', 'DESPESA', 'DESPESA_ADMINISTRATIVA'],
  ['2.3.01', 'Salários', 'DESPESA', 'DESPESA_PESSOAL'],
  ['2.3.02', 'Encargos e benefícios', 'DESPESA', 'DESPESA_PESSOAL'],
  ['2.3.03', 'Comissões de vendedores', 'DESPESA', 'DESPESA_PESSOAL'],
  ['2.4.01', 'Marketing e anúncios', 'DESPESA', 'DESPESA_OPERACIONAL'],
  ['2.5.01', 'Tarifas bancárias', 'DESPESA', 'DESPESA_FINANCEIRA'],
  ['2.5.02', 'Juros e multas pagos', 'DESPESA', 'DESPESA_FINANCEIRA'],
  ['2.6.01', 'Impostos sobre vendas (DAS/ICMS/PIS/COFINS)', 'DESPESA', 'DEDUCOES'],
];

async function setupCompany(orgId: string, data: { name: string; tradeName: string; cnpj: string; ie: string; im: string; taxRegime: string; crt: number; uf: string; city: string; cityCode: string; zip: string; street: string; number: string; district: string; phone: string; email: string; color: string }) {
  const { color, ...rest } = data;
  const company = await prisma.company.create({
    data: {
      organizationId: orgId,
      ...rest,
      logoColor: color,
      certName: `${data.name}:${data.cnpj}`,
      certIssuer: 'AC SIMULADA RFB v5 (certificado A1 de demonstração)',
      certValidUntil: addDays(new Date(), 300),
      certUploadedAt: new Date(),
      cscToken: randomDigits(32),
    },
  });
  await prisma.warehouse.createMany({
    data: [
      { companyId: company.id, name: 'Depósito Principal', code: 'PRINC', isDefault: true },
      { companyId: company.id, name: 'Loja / Showroom', code: 'LOJA' },
      { companyId: company.id, name: 'Fulfillment Marketplace', code: 'FULL', available: true },
    ],
  });
  await prisma.bankAccount.createMany({
    data: [
      { companyId: company.id, name: 'Caixa da loja', type: 'CAIXA', initialBalance: 500 },
      { companyId: company.id, name: 'Banco do Brasil', type: 'CORRENTE', bankCode: '001', bankName: 'Banco do Brasil', agency: '1234-5', accountNumber: '98765-4', initialBalance: 45000, isDefault: true },
      { companyId: company.id, name: 'Conta Digital GestãoPro', type: 'CONTA_DIGITAL', bankCode: '999', bankName: 'GestãoPro Bank (simulado)', agency: '0001', accountNumber: `${randomDigits(6)}-${randomDigits(1)}`, pixKey: data.cnpj, initialBalance: 8000 },
    ],
  });
  for (const [code, name, type, dreGroup] of CHART) await prisma.chartAccount.create({ data: { companyId: company.id, code, name, type, dreGroup } });
  await prisma.costCenter.createMany({ data: [{ companyId: company.id, code: 'ADM', name: 'Administrativo' }, { companyId: company.id, code: 'COM', name: 'Comercial' }, { companyId: company.id, code: 'ECO', name: 'E-commerce' }, { companyId: company.id, code: 'PRD', name: 'Produção' }] });
  const normal = data.crt !== 1;
  await prisma.operationNature.createMany({
    data: [
      { companyId: company.id, name: 'Venda de mercadoria', kind: 'VENDA', cfopIntra: '5102', cfopInter: '6102', isDefault: true, icmsRateIntra: data.uf === 'SP' ? 18 : 22, pisRate: normal ? 0.65 : 0, cofinsRate: normal ? 3 : 0 },
      { companyId: company.id, name: 'Venda de produção do estabelecimento', kind: 'VENDA', cfopIntra: '5101', cfopInter: '6101', icmsRateIntra: data.uf === 'SP' ? 18 : 22 },
      { companyId: company.id, name: 'Venda ao consumidor (NFC-e)', kind: 'NFCE', cfopIntra: '5102', cfopInter: '6102', isDefault: true },
      { companyId: company.id, name: 'Devolução de venda', kind: 'DEVOLUCAO', direction: 'ENTRADA', cfopIntra: '1202', cfopInter: '2202', finalidade: 4 },
      { companyId: company.id, name: 'Remessa para conserto', kind: 'REMESSA', cfopIntra: '5915', cfopInter: '6915', icmsCst: '41', csosn: '400', generatesFinancial: false, movesStock: true },
      { companyId: company.id, name: 'Prestação de serviços', kind: 'SERVICO', cfopIntra: '', cfopInter: '', issRate: 5, isDefault: true },
      { companyId: company.id, name: 'Compra para comercialização', kind: 'COMPRA', direction: 'ENTRADA', cfopIntra: '1102', cfopInter: '2102' },
    ],
  });
  for (const a of AUTOMATIONS) await prisma.automation.create({ data: { companyId: company.id, key: a.key, active: a.defaultActive !== false } });
  return company;
}

async function main() {
  const existing = await prisma.organization.count();
  if (existing && !process.env.SEED_FORCE) {
    console.log('Banco já possui dados — seed ignorado (use SEED_FORCE=1 para recriar).');
    return;
  }
  console.log('🌱 Recriando dados de demonstração...');
  await wipe();

  const org = await prisma.organization.create({ data: { name: 'Grupo Demo GestãoPro', stockMode: 'SEPARADO' } });
  const roles: Record<string, string> = {};
  for (const r of DEFAULT_ROLES) roles[r.name] = (await prisma.role.create({ data: { organizationId: org.id, name: r.name, description: r.description, isAdmin: !!r.isAdmin, permissions: r.permissions } })).id;

  const moda = await setupCompany(org.id, {
    name: 'Moda Brasil Comércio de Roupas Ltda', tradeName: 'Moda Brasil', cnpj: '11444777000161', ie: '110042490114', im: '45678912', taxRegime: 'SIMPLES', crt: 1,
    uf: 'SP', city: 'São Paulo', cityCode: '3550308', zip: '01311000', street: 'Avenida Paulista', number: '1500', district: 'Bela Vista', phone: '(11) 3456-7890', email: 'contato@modabrasil.com.br', color: '#16a34a',
  });
  const tech = await setupCompany(org.id, {
    name: 'TechCasa Eletrônicos e Serviços Ltda', tradeName: 'TechCasa', cnpj: '45723174000110', ie: '86123456', im: '0987654', taxRegime: 'PRESUMIDO', crt: 3,
    uf: 'RJ', city: 'Rio de Janeiro', cityCode: '3304557', zip: '20040002', street: 'Avenida Rio Branco', number: '156', district: 'Centro', phone: '(21) 2222-3333', email: 'contato@techcasa.com.br', color: '#2563eb',
  });
  log('Empresas:', moda.tradeName, '+', tech.tradeName);

  const pass = await bcrypt.hash('demo123', 10);
  const users = [
    { name: 'Administrador Demo', email: 'admin@gestaopro.com.br', role: 'Administrador', pwd: await bcrypt.hash('admin123', 10) },
    { name: 'Vanessa Vendas', email: 'vendedor@gestaopro.com.br', role: 'Vendedor', pwd: pass },
    { name: 'Fábio Financeiro', email: 'financeiro@gestaopro.com.br', role: 'Financeiro', pwd: pass },
    { name: 'Eduardo Estoque', email: 'estoque@gestaopro.com.br', role: 'Estoquista', pwd: pass },
  ];
  for (const u of users) {
    const user = await prisma.user.create({ data: { organizationId: org.id, roleId: roles[u.role], name: u.name, email: u.email, passwordHash: u.pwd } });
    await prisma.userCompany.createMany({ data: [{ userId: user.id, companyId: moda.id }, { userId: user.id, companyId: tech.id }] });
  }
  log('Usuários: admin@gestaopro.com.br / admin123 (+ vendedor, financeiro, estoque / demo123)');

  // ---------------- Cadastros ----------------
  const sellers = await Promise.all([
    prisma.seller.create({ data: { organizationId: org.id, name: 'Vanessa Vendas', kind: 'VENDEDOR', email: 'vendedor@gestaopro.com.br', commissionRate: 5, commissionBase: 'FATURAMENTO' } }),
    prisma.seller.create({ data: { organizationId: org.id, name: 'Ricardo Representante', kind: 'VENDEDOR', email: 'ricardo@rep.com.br', commissionRate: 3, commissionBase: 'RECEBIMENTO' } }),
    prisma.seller.create({ data: { organizationId: org.id, name: 'Juliana Loja', kind: 'VENDEDOR', email: 'juliana@modabrasil.com.br', commissionRate: 2.5 } }),
    prisma.seller.create({ data: { organizationId: org.id, name: 'Carlos Técnico', kind: 'TECNICO', email: 'carlos@techcasa.com.br', commissionRate: 10 } }),
    prisma.seller.create({ data: { organizationId: org.id, name: 'Marina Expedição', kind: 'FUNCIONARIO', email: 'marina@modabrasil.com.br' } }),
  ]);

  const cats: Record<string, string> = {};
  for (const n of ['Camisetas', 'Calças', 'Calçados', 'Acessórios', 'Eletrônicos', 'Informática', 'Saúde e beleza', 'Matérias-primas', 'Kits']) cats[n] = (await prisma.category.create({ data: { organizationId: org.id, name: n } })).id;

  const priceLists = {
    varejo: await prisma.priceList.create({ data: { organizationId: org.id, name: 'Varejo (padrão)', type: 'VAREJO' } }),
    atacado: await prisma.priceList.create({ data: { organizationId: org.id, name: 'Atacado (-15%, mín. 10 un)', type: 'ATACADO', adjustPercent: -15, minQuantity: 10 } }),
    promo: await prisma.priceList.create({ data: { organizationId: org.id, name: 'Promoção Black Friday', type: 'PROMOCAO', adjustPercent: -20, validFrom: addDays(new Date(), -10), validUntil: addDays(new Date(), 30) } }),
    ml: await prisma.priceList.create({ data: { organizationId: org.id, name: 'Canal Mercado Livre (+12%)', type: 'CANAL', adjustPercent: 12 } }),
  };

  const suppliers = [];
  const supData = [
    ['Têxtil Santa Catarina S.A.', 'Têxtil SC', '33000167000101', 'Blumenau', 'SC', '89010000'],
    ['Distribuidora Eletrônica Paulista Ltda', 'DEP Eletrônicos', '06990590000123', 'São Paulo', 'SP', '01310000'],
    ['Calçados Franca Indústria Ltda', 'Franca Shoes', '60701190000104', 'Franca', 'SP', '14400000'],
    ['Embalagens Express Ltda', 'EmbalaFácil', '07526557000100', 'Guarulhos', 'SP', '07010000'],
    ['Farma Cosméticos Ltda', 'FarmaCos', '61585865000151', 'Campinas', 'SP', '13010000'],
  ];
  for (const [name, trade, doc, city, uf, zip] of supData) {
    suppliers.push(await prisma.contact.create({ data: { organizationId: org.id, types: ['FORNECEDOR'], personType: 'PJ', name, tradeName: trade, document: doc, ie: randomDigits(12), ieIndicator: 1, email: `comercial@${trade.toLowerCase().replace(/[^a-z]/g, '')}.com.br`, phone: `(11) 3${randomDigits(3)}-${randomDigits(4)}`, city, uf, zip, street: 'Rua Industrial', number: String(randomInt(10, 999)), district: 'Distrito Industrial' } }));
  }
  await prisma.contact.create({ data: { organizationId: org.id, types: ['TRANSPORTADORA'], personType: 'PJ', name: 'Jadlog Logística S.A.', document: '04884082000135', city: 'Barueri', uf: 'SP' } });
  await prisma.contact.create({ data: { organizationId: org.id, types: ['TRANSPORTADORA', 'FORNECEDOR'], personType: 'PJ', name: 'Transportadora Rápida Sul Ltda', document: '33014556000196', city: 'Curitiba', uf: 'PR' } });

  const custData: [string, string, string, string, string][] = [
    ['Mariana Costa Almeida', 'São Paulo', 'SP', '04538132', 'Rua Funchal'],
    ['Pedro Henrique Souza', 'Campinas', 'SP', '13015001', 'Rua Conceição'],
    ['Juliana Ferreira Lima', 'Rio de Janeiro', 'RJ', '22021001', 'Avenida Atlântica'],
    ['Lucas Martins Ribeiro', 'Belo Horizonte', 'MG', '30140071', 'Rua da Bahia'],
    ['Fernanda Oliveira Santos', 'Curitiba', 'PR', '80010010', 'Rua Marechal Deodoro'],
    ['Rafael Gomes Carvalho', 'Porto Alegre', 'RS', '90010273', 'Avenida Borges de Medeiros'],
    ['Camila Rodrigues Pereira', 'Salvador', 'BA', '40015970', 'Rua Chile'],
    ['Bruno Alves Teixeira', 'Recife', 'PE', '50030230', 'Avenida Guararapes'],
    ['Aline Barbosa Moreira', 'Santos', 'SP', '11013000', 'Rua XV de Novembro'],
    ['Gustavo Pinto Rocha', 'Goiânia', 'GO', '74015010', 'Avenida Anhanguera'],
    ['Patrícia Mendes Dias', 'Florianópolis', 'SC', '88010400', 'Rua Felipe Schmidt'],
    ['Thiago Nunes Araújo', 'Fortaleza', 'CE', '60025100', 'Rua Major Facundo'],
    ['Beatriz Cardoso Freitas', 'São Paulo', 'SP', '05424020', 'Rua dos Pinheiros'],
    ['Diego Ramos Vieira', 'Niterói', 'RJ', '24020005', 'Rua da Conceição'],
    ['Larissa Monteiro Castro', 'Ribeirão Preto', 'SP', '14010100', 'Rua General Osório'],
  ];
  const customers: Awaited<ReturnType<typeof prisma.contact.create>>[] = [];
  for (const [name, city, uf, zip, street] of custData) {
    customers.push(await prisma.contact.create({ data: { organizationId: org.id, types: ['CLIENTE'], personType: 'PF', name, document: generateCPF(), email: `${name.split(' ')[0].toLowerCase()}@email.com.br`, mobile: `(11) 9${randomDigits(4)}-${randomDigits(4)}`, city, uf, zip, street, number: String(randomInt(10, 3000)), district: 'Centro', creditLimit: 0, sellerId: pick([sellers[0].id, sellers[2].id]) } }));
  }
  const pjData: [string, string, string, string, string, string][] = [
    ['Boutique Elegance Ltda', 'Elegance', '27865757000102', 'São Paulo', 'SP', '01415000'],
    ['Lojas Estilo Jovem EIRELI', 'Estilo Jovem', '18236120000158', 'Campinas', 'SP', '13024000'],
    ['Magazine Ponto Certo Ltda', 'Ponto Certo', '09358105000191', 'Belo Horizonte', 'MG', '30110000'],
    ['Escritório Contábil Exato S/S', 'Exato Contabilidade', '13347016000117', 'Rio de Janeiro', 'RJ', '20031000'],
    ['Clínica Bem Estar Ltda', 'Bem Estar', '05570714000159', 'Niterói', 'RJ', '24030000'],
  ];
  for (const [name, trade, doc, city, uf, zip] of pjData) {
    const c = await prisma.contact.create({ data: { organizationId: org.id, types: ['CLIENTE'], personType: 'PJ', name, tradeName: trade, document: doc, ie: randomDigits(12), ieIndicator: 1, email: `compras@${trade.toLowerCase().replace(/[^a-z]/g, '')}.com.br`, phone: `(11) 3${randomDigits(3)}-${randomDigits(4)}`, city, uf, zip, street: 'Rua Comercial', number: String(randomInt(10, 999)), district: 'Centro', creditLimit: 0, priceListId: priceLists.atacado.id, sellerId: sellers[1].id } });
    await prisma.contactPerson.create({ data: { contactId: c.id, name: `${pick(['Ana', 'Marcos', 'Rita', 'Paulo'])} ${pick(['Lopes', 'Melo', 'Prado'])}`, role: 'Compras', email: c.email } });
    await prisma.contactAddress.create({ data: { contactId: c.id, label: 'Entrega', zip, street: 'Rua do Depósito', number: '50', district: 'Industrial', city, uf } });
    customers.push(c);
  }
  const consumer = await prisma.contact.create({ data: { organizationId: org.id, code: 'CONSUMIDOR', types: ['CLIENTE'], personType: 'PF', name: 'Consumidor Final', city: 'São Paulo', uf: 'SP' } });
  log(`${customers.length} clientes, ${suppliers.length} fornecedores, ${sellers.length} vendedores/funcionários`);

  // ---------------- Produtos ----------------
  let eanSeq = 789100000000;
  const ean = () => buildEan13(String(eanSeq++));
  const P = async (d: Record<string, unknown>) => prisma.product.create({ data: { organizationId: org.id, gtin: ean(), ...d } as never });

  const raw = {
    tecido: await P({ sku: 'MP-TEC-ALG', name: 'Tecido malha algodão (metro)', kind: 'MATERIA_PRIMA', unit: 'M', ncm: '60062200', categoryId: cats['Matérias-primas'], costPrice: 18.5, price: 0, minStock: 50, supplierId: suppliers[0].id }),
    tinta: await P({ sku: 'MP-TINTA-SER', name: 'Tinta para serigrafia (litro)', kind: 'MATERIA_PRIMA', unit: 'L', ncm: '32151900', categoryId: cats['Matérias-primas'], costPrice: 42, price: 0, minStock: 5, supplierId: suppliers[3].id, controlsLot: true }),
    embalagem: await P({ sku: 'EMB-PLAST-01', name: 'Embalagem plástica 30x40', kind: 'MATERIA_PRIMA', unit: 'UN', ncm: '39232190', categoryId: cats['Matérias-primas'], costPrice: 0.35, price: 0, minStock: 200, supplierId: suppliers[3].id }),
    etiqueta: await P({ sku: 'MP-ETQ-TEC', name: 'Etiqueta de tecido bordada', kind: 'MATERIA_PRIMA', unit: 'UN', ncm: '58071000', categoryId: cats['Matérias-primas'], costPrice: 0.25, price: 0, minStock: 300, supplierId: suppliers[0].id }),
  };

  // Variações: Camiseta básica (cor x tamanho)
  const variationParent = async (base: { sku: string; name: string; price: number; cost: number; ncm: string; cat: string; attrs: Record<string, string[]>; weight: number; supplier: string; min: number }) => {
    const parent = await P({ sku: base.sku, name: base.name, kind: 'VARIACAO_PAI', ncm: base.ncm, categoryId: cats[base.cat], price: base.price, costPrice: base.cost, attributes: base.attrs, weight: base.weight, supplierId: base.supplier, featured: true, description: `${base.name} — produto com grade de variações.` });
    const keys = Object.keys(base.attrs);
    const combos: Record<string, string>[] = keys.reduce<Record<string, string>[]>((acc, k) => acc.flatMap((c) => base.attrs[k].map((v) => ({ ...c, [k]: v }))), [{}]);
    const children = [];
    for (const combo of combos) {
      const suffix = Object.values(combo).map((v) => v.slice(0, 3).toUpperCase()).join('-');
      children.push(await P({ sku: `${base.sku}-${suffix}`, name: `${base.name} ${Object.values(combo).join(' ')}`, kind: 'VARIACAO', parentId: parent.id, attributes: combo, ncm: base.ncm, categoryId: cats[base.cat], price: base.price, costPrice: base.cost, weight: base.weight, supplierId: base.supplier, minStock: base.min }));
    }
    return { parent, children };
  };
  const camiseta = await variationParent({ sku: 'CAM-BAS', name: 'Camiseta Básica Algodão', price: 59.9, cost: 22, ncm: '61091000', cat: 'Camisetas', attrs: { Cor: ['Branca', 'Preta', 'Azul'], Tamanho: ['P', 'M', 'G'] }, weight: 0.2, supplier: suppliers[0].id, min: 5 });
  const calca = await variationParent({ sku: 'CAL-JEANS', name: 'Calça Jeans Slim', price: 189.9, cost: 78, ncm: '62034200', cat: 'Calças', attrs: { Tamanho: ['38', '40', '42', '44'] }, weight: 0.6, supplier: suppliers[0].id, min: 3 });
  const simples = {
    tenis: await P({ sku: 'TEN-RUN-01', name: 'Tênis Running Performance', ncm: '64041100', categoryId: cats['Calçados'], price: 349.9, costPrice: 160, weight: 0.9, height: 13, width: 20, length: 32, minStock: 4, maxStock: 30, supplierId: suppliers[2].id, featured: true, description: 'Tênis para corrida com amortecimento em gel e cabedal respirável.' }),
    bone: await P({ sku: 'BON-ABA-01', name: 'Boné Aba Curva Bordado', ncm: '65050090', categoryId: cats['Acessórios'], price: 79.9, costPrice: 28, weight: 0.15, minStock: 8, supplierId: suppliers[0].id, featured: true }),
    mochila: await P({ sku: 'MOC-URB-01', name: 'Mochila Urbana Notebook 15"', ncm: '42029200', categoryId: cats['Acessórios'], price: 229.9, costPrice: 95, weight: 0.8, minStock: 3, supplierId: suppliers[1].id, featured: true }),
    meia: await P({ sku: 'MEI-KIT3-01', name: 'Meia Cano Médio (par)', ncm: '61159500', categoryId: cats['Acessórios'], price: 19.9, costPrice: 6.5, weight: 0.05, minStock: 20, supplierId: suppliers[0].id }),
    fone: await P({ sku: 'ELE-FONE-BT', name: 'Fone de Ouvido Bluetooth TWS', ncm: '85183000', categoryId: cats['Eletrônicos'], price: 199.9, costPrice: 82, ipiRate: 15, weight: 0.2, minStock: 6, supplierId: suppliers[1].id, featured: true, description: 'Fone sem fio com cancelamento de ruído e 30h de bateria.' }),
    carregador: await P({ sku: 'ELE-CARR-65W', name: 'Carregador Turbo USB-C 65W', ncm: '85044010', categoryId: cats['Eletrônicos'], price: 149.9, costPrice: 55, ipiRate: 9.75, weight: 0.25, minStock: 10, supplierId: suppliers[1].id }),
    cabo: await P({ sku: 'ELE-CABO-C', name: 'Cabo USB-C 2 metros', ncm: '85444200', categoryId: cats['Eletrônicos'], price: 39.9, costPrice: 11, ipiRate: 9.75, weight: 0.08, minStock: 25, supplierId: suppliers[1].id }),
    relogio: await P({ sku: 'ELE-WATCH-01', name: 'Smartwatch Fitness Pro', ncm: '85176299', categoryId: cats['Eletrônicos'], price: 499.9, costPrice: 230, ipiRate: 15, weight: 0.3, minStock: 3, supplierId: suppliers[1].id, featured: true }),
    ssd: await P({ sku: 'INF-SSD-480', name: 'SSD 480GB SATA III', ncm: '84717012', categoryId: cats['Informática'], price: 259.9, costPrice: 140, weight: 0.1, minStock: 5, supplierId: suppliers[1].id }),
    mouse: await P({ sku: 'INF-MOUSE-SF', name: 'Mouse sem fio ergonômico', ncm: '84716053', categoryId: cats['Informática'], price: 89.9, costPrice: 32, weight: 0.12, minStock: 8, supplierId: suppliers[1].id }),
    teclado: await P({ sku: 'INF-TECL-MEC', name: 'Teclado Mecânico RGB ABNT2', ncm: '84716052', categoryId: cats['Informática'], price: 329.9, costPrice: 150, weight: 1.0, minStock: 3, supplierId: suppliers[1].id }),
    protetor: await P({ sku: 'SAU-PROT-50', name: 'Protetor Solar FPS 50 - 200ml', ncm: '33049910', categoryId: cats['Saúde e beleza'], price: 69.9, costPrice: 24, weight: 0.25, minStock: 10, controlsLot: true, supplierId: suppliers[4].id }),
    whey: await P({ sku: 'SAU-WHEY-900', name: 'Whey Protein Concentrado 900g', ncm: '21069030', categoryId: cats['Saúde e beleza'], price: 159.9, costPrice: 78, weight: 1.0, minStock: 6, controlsLot: true, supplierId: suppliers[4].id, featured: true }),
  };
  // Produto fabricado (ficha técnica)
  const personalizada = await P({ sku: 'CAM-PERS-01', name: 'Camiseta Personalizada Estampada', kind: 'FABRICADO', ncm: '61091000', categoryId: cats['Camisetas'], price: 89.9, costPrice: 0, weight: 0.22, minStock: 5, featured: true });
  await prisma.productComponent.createMany({
    data: [
      { productId: personalizada.id, componentId: raw.tecido.id, quantity: 1.2 },
      { productId: personalizada.id, componentId: raw.tinta.id, quantity: 0.05 },
      { productId: personalizada.id, componentId: raw.embalagem.id, quantity: 1 },
      { productId: personalizada.id, componentId: raw.etiqueta.id, quantity: 1 },
    ],
  });
  // Kits
  const kitVerao = await P({ sku: 'KIT-VERAO-01', name: 'Kit Verão: Camiseta Branca M + Boné + Protetor', kind: 'KIT', ncm: '61091000', categoryId: cats['Kits'], price: 179.9, costPrice: 0, weight: 0.6, featured: true });
  await prisma.productComponent.createMany({ data: [{ productId: kitVerao.id, componentId: camiseta.children[1].id, quantity: 1 }, { productId: kitVerao.id, componentId: simples.bone.id, quantity: 1 }, { productId: kitVerao.id, componentId: simples.protetor.id, quantity: 1 }] });
  const kitTech = await P({ sku: 'KIT-SETUP-01', name: 'Kit Setup: Teclado + Mouse', kind: 'KIT', ncm: '84716052', categoryId: cats['Kits'], price: 379.9, costPrice: 0, weight: 1.2 });
  await prisma.productComponent.createMany({ data: [{ productId: kitTech.id, componentId: simples.teclado.id, quantity: 1 }, { productId: kitTech.id, componentId: simples.mouse.id, quantity: 1 }] });
  await prisma.priceListItem.createMany({ data: [{ priceListId: priceLists.promo.id, productId: simples.tenis.id, price: 279.9 }, { priceListId: priceLists.promo.id, productId: simples.fone.id, price: 149.9 }] });

  const services = await Promise.all([
    prisma.service.create({ data: { organizationId: org.id, code: 'SRV-INST', name: 'Instalação e configuração de equipamento', price: 120, serviceCode: '14.06', cnae: '9511800', issRate: 5 } }),
    prisma.service.create({ data: { organizationId: org.id, code: 'SRV-MANUT', name: 'Manutenção corretiva de notebook', price: 180, serviceCode: '14.01', cnae: '9511800', issRate: 5 } }),
    prisma.service.create({ data: { organizationId: org.id, code: 'SRV-FORMAT', name: 'Formatação e backup de dados', price: 150, serviceCode: '14.01', cnae: '9511800', issRate: 5 } }),
    prisma.service.create({ data: { organizationId: org.id, code: 'SRV-PERS', name: 'Personalização de estampa (arte)', price: 45, serviceCode: '23.01', issRate: 3 } }),
    prisma.service.create({ data: { organizationId: org.id, code: 'SRV-PREV', name: 'Manutenção preventiva (limpeza)', price: 95, serviceCode: '14.01', issRate: 5 } }),
  ]);
  log('Produtos com variações, kits, fabricado, lotes e serviços criados');

  // Cadastros personalizados
  const ctTec = await prisma.customEntityType.create({ data: { organizationId: org.id, name: 'Técnicos parceiros', slug: 'tecnicos-parceiros', icon: 'wrench', fields: [{ key: 'nome', label: 'Nome', type: 'text', required: true }, { key: 'especialidade', label: 'Especialidade', type: 'select', options: ['Notebooks', 'Celulares', 'Redes', 'Impressoras'] }, { key: 'valorHora', label: 'Valor hora (R$)', type: 'number' }, { key: 'ativo', label: 'Ativo', type: 'boolean' }] } });
  await prisma.customEntityRecord.createMany({ data: [{ typeId: ctTec.id, data: { nome: 'André Reparos', especialidade: 'Notebooks', valorHora: 85, ativo: true } }, { typeId: ctTec.id, data: { nome: 'Cel Fix', especialidade: 'Celulares', valorHora: 70, ativo: true } }] });
  const ctEmb = await prisma.customEntityType.create({ data: { organizationId: org.id, name: 'Embalagens', slug: 'embalagens', icon: 'package', fields: [{ key: 'descricao', label: 'Descrição', type: 'text', required: true }, { key: 'dimensoes', label: 'Dimensões (cm)', type: 'text' }, { key: 'pesoMax', label: 'Peso máximo (kg)', type: 'number' }, { key: 'material', label: 'Material', type: 'select', options: ['Papelão', 'Plástico', 'Envelope'] }] } });
  await prisma.customEntityRecord.createMany({ data: [{ typeId: ctEmb.id, data: { descricao: 'Caixa P', dimensoes: '20x15x10', pesoMax: 2, material: 'Papelão' } }, { typeId: ctEmb.id, data: { descricao: 'Caixa M', dimensoes: '30x25x15', pesoMax: 5, material: 'Papelão' } }, { typeId: ctEmb.id, data: { descricao: 'Envelope de segurança', dimensoes: '32x40', pesoMax: 1, material: 'Envelope' } }] });

  // ---------------- Estoque inicial ----------------
  const stockable = [...camiseta.children, ...calca.children, ...Object.values(simples), ...Object.values(raw)];
  const whModa = await prisma.warehouse.findFirst({ where: { companyId: moda.id, isDefault: true } });
  const whTech = await prisma.warehouse.findFirst({ where: { companyId: tech.id, isDefault: true } });
  const whLoja = await prisma.warehouse.findFirst({ where: { companyId: moda.id, code: 'LOJA' } });
  for (const p of stockable) {
    const isRaw = p.kind === 'MATERIA_PRIMA';
    const qty = isRaw ? (p.unit === 'UN' ? 1500 : p.unit === 'L' ? 20 : 300) : randomInt(220, 380);
    await moveStock(prisma, { companyId: moda.id, productId: p.id, warehouseId: whModa!.id, quantity: qty, direction: 'IN', type: 'ENTRADA', origin: 'INVENTARIO', notes: 'Saldo inicial de implantação', unitCost: p.costPrice, lotNumber: p.controlsLot ? `L${randomDigits(4)}` : null, expiresAt: p.controlsLot ? addDays(new Date(), randomInt(20, 400)) : null });
    if (!isRaw && p.categoryId && [cats['Eletrônicos'], cats['Informática']].includes(p.categoryId)) {
      await moveStock(prisma, { companyId: tech.id, productId: p.id, warehouseId: whTech!.id, quantity: randomInt(120, 200), direction: 'IN', origin: 'INVENTARIO', notes: 'Saldo inicial de implantação', unitCost: p.costPrice });
    }
  }
  for (const p of [...camiseta.children, simples.bone, simples.meia]) await moveStock(prisma, { companyId: moda.id, productId: p.id, warehouseId: whLoja!.id, quantity: 25, direction: 'IN', origin: 'INVENTARIO', notes: 'Estoque da loja física' });
  // Um item propositalmente com estoque baixo (ruptura)
  await moveStock(prisma, { companyId: moda.id, productId: simples.relogio.id, warehouseId: whModa!.id, quantity: (await prisma.stockBalance.findFirst({ where: { productId: simples.relogio.id, warehouseId: whModa!.id } }))!.quantity - 2, direction: 'OUT', type: 'AJUSTE', origin: 'INVENTARIO', notes: 'Ajuste de inventário' });
  await prisma.stockMovement.updateMany({ data: { createdAt: addDays(new Date(), -95) } });
  log('Estoque inicial lançado');

  // ---------------- Canais de venda ----------------
  const actorModa: Actor = { companyId: moda.id, orgId: org.id, userName: 'Administrador Demo' };
  const actorTech: Actor = { companyId: tech.id, orgId: org.id, userName: 'Administrador Demo' };
  const ml = await connectChannel(actorModa, 'MERCADO_LIVRE', 'MODABRASIL_OFICIAL');
  await prisma.salesChannel.update({ where: { id: ml.id }, data: { priceListId: priceLists.ml.id } });
  const shopee = await connectChannel(actorModa, 'SHOPEE', 'modabrasil.store');
  const nuvem = await connectChannel(actorModa, 'NUVEMSHOP', 'modabrasil.lojavirtual.com.br');
  const amazon = await connectChannel(actorTech, 'AMAZON', 'TechCasa Store');
  const magalu = await connectChannel(actorTech, 'MAGALU', 'TechCasa Oficial');
  await connectChannel(actorModa, 'GESTAO_ENVIOS');
  await connectChannel(actorModa, 'MELHOR_ENVIO');
  for (const ch of [ml, shopee, nuvem]) await publishListings(actorModa, ch.id);
  for (const ch of [amazon, magalu]) await publishListings(actorTech, ch.id, [simples.fone, simples.carregador, simples.cabo, simples.relogio, simples.ssd, simples.mouse, simples.teclado].map((p) => p.id));
  log('Canais conectados e anúncios publicados');

  // ---------------- Histórico de vendas (fluxo real) ----------------
  const sellableModa = [...camiseta.children, ...calca.children, simples.tenis, simples.bone, simples.mochila, simples.meia, simples.protetor, simples.whey, kitVerao];
  const sellableTech = [simples.fone, simples.carregador, simples.cabo, simples.relogio, simples.ssd, simples.mouse, simples.teclado, kitTech];

  async function ageOrder(orderId: string, date: Date) {
    const d = date;
    await prisma.salesOrder.update({ where: { id: orderId }, data: { date: d, createdAt: d, invoicedAt: d } });
    await prisma.invoice.updateMany({ where: { salesOrderId: orderId }, data: { issueDate: d, authorizedAt: d, createdAt: d } });
    await prisma.stockMovement.updateMany({ where: { originId: orderId }, data: { createdAt: d } });
    await prisma.commission.updateMany({ where: { salesOrderId: orderId }, data: { createdAt: d, releasedAt: d } });
    const order = await prisma.salesOrder.findUnique({ where: { id: orderId } });
    const entries = await prisma.financialEntry.findMany({ where: { originId: orderId }, orderBy: { installment: 'asc' } });
    for (const e of entries) {
      const due = e.type === 'PAGAR' ? addDays(d, 15) : order!.paidOnCreate ? d : addDays(d, (order!.paymentTermDays || 0) + (e.installment - 1) * 30);
      await prisma.financialEntry.update({ where: { id: e.id }, data: { issueDate: d, competenceDate: d, dueDate: due, ...(e.paymentDate ? { paymentDate: d } : {}) } });
      await prisma.bankTransaction.updateMany({ where: { entryId: e.id }, data: { date: d } });
    }
    const shipments = await prisma.shipment.findMany({ where: { salesOrderId: orderId } });
    for (const s of shipments) {
      const daysAgo = (Date.now() - d.getTime()) / 86400000;
      if (daysAgo > 3) for (let i = 0; i < (daysAgo > 10 ? 4 : daysAgo > 6 ? 2 : 1); i++) await advanceTracking(actorFor(order!.companyId), s.id);
      const fresh = await prisma.shipment.findUnique({ where: { id: s.id } });
      const events = ((fresh!.events as { date: string }[]) || []).map((ev, i) => ({ ...ev, date: addDays(d, i).toISOString() }));
      await prisma.shipment.update({ where: { id: s.id }, data: { createdAt: d, labelAt: d, postedAt: fresh!.postedAt ? addDays(d, 1) : null, deliveredAt: fresh!.deliveredAt ? addDays(d, events.length - 1) : null, events } });
      await prisma.salesOrder.update({ where: { id: orderId }, data: { shippedAt: fresh!.postedAt ? addDays(d, 1) : null, deliveredAt: fresh!.deliveredAt ? addDays(d, events.length - 1) : null, separatedAt: fresh!.postedAt ? d : null } });
    }
  }
  const actorFor = (cid: string) => (cid === moda.id ? actorModa : actorTech);

  let orderCount = 0;
  async function simulateSale(actor: Actor, daysAgo: number, sellables: typeof sellableModa, opts: { channelId?: string; origin?: string } = {}) {
    const date = addDays(new Date(), -daysAgo);
    date.setHours(randomInt(8, 20), randomInt(0, 59));
    const customer = pick(customers);
    const items = [...new Map(Array.from({ length: randomInt(1, 3) }, () => pick(sellables)).map((p) => [p.id, p])).values()].map((p) => ({ productId: p.id, quantity: customer.personType === 'PJ' ? randomInt(6, 12) : randomInt(1, 2) }));
    const method = pick(['BOLETO', 'PIX', 'PIX', 'CARTAO_CREDITO', 'BOLETO']);
    const order = await createOrder(actor, {
      customerId: customer.id,
      date,
      items,
      freight: pick([0, 0, 19.9, 24.5]),
      discount: pick([0, 0, 0, 10]),
      paymentMethod: method,
      installments: method === 'CARTAO_CREDITO' ? pick([1, 2, 3]) : method === 'BOLETO' ? pick([1, 2]) : 1,
      paymentTermDays: method === 'BOLETO' ? 28 : method === 'CARTAO_CREDITO' ? 30 : 0,
      paidOnCreate: method === 'PIX',
      channelId: opts.channelId,
      origin: opts.origin,
    });
    orderCount++;
    if (daysAgo > 1 || Math.random() < 0.4) {
      await invoiceOrder(actor, order.id);
      await ageOrder(order.id, date);
    } else {
      await prisma.salesOrder.update({ where: { id: order.id }, data: { date, createdAt: date } });
    }
    return order;
  }
  for (let d = 88; d >= 0; d--) {
    const n = d % 7 === 0 ? 1 : randomInt(1, 3);
    for (let i = 0; i < n; i++) await simulateSale(actorModa, d, sellableModa);
    if (d % 3 === 0) await simulateSale(actorTech, d, sellableTech);
  }
  // Marketplace (importação automática)
  for (const [actor, ch, days] of [[actorModa, ml, 40], [actorModa, shopee, 25], [actorTech, amazon, 30]] as const) {
    for (let i = 0; i < 6; i++) {
      const orders = await importOrders(actor, ch.id, 1);
      for (const o of orders) {
        const date = addDays(new Date(), -randomInt(0, days));
        await invoiceOrder(actor, o.id);
        await ageOrder(o.id, date);
        orderCount++;
      }
    }
  }
  // Pedidos em aberto recentes + cancelado
  for (let i = 0; i < 4; i++) {
    const o = await createOrder(actorModa, { customerId: pick(customers).id, items: [{ productId: pick(sellableModa).id, quantity: randomInt(1, 3) }], paymentMethod: 'BOLETO', paymentTermDays: 28, sellerId: sellers[0].id });
    orderCount++;
    if (i === 3) await cancelOrder(actorModa, o.id, 'Cliente desistiu da compra antes do faturamento');
  }
  log(`${orderCount} pedidos de venda processados (reserva → NF → estoque → financeiro → envio)`);

  // Baixa de recebíveis passados (85% pagos; demais ficam inadimplentes)
  const pastReceivables = await prisma.financialEntry.findMany({ where: { type: 'RECEBER', status: 'ABERTO', dueDate: { lt: new Date() } } });
  for (const e of pastReceivables) {
    if (Math.random() < 0.85) {
      await payEntry(e.companyId, org.id, e.id, { date: e.dueDate, method: e.paymentMethod });
      await prisma.bankTransaction.updateMany({ where: { entryId: e.id }, data: { date: e.dueDate } });
      await prisma.financialEntry.update({ where: { id: e.id }, data: { paymentDate: e.dueDate } });
    }
  }
  // Tarifas de marketplace pagas
  for (const e of await prisma.financialEntry.findMany({ where: { type: 'PAGAR', status: 'ABERTO', origin: 'INTEGRACAO', dueDate: { lt: new Date() } } })) {
    await payEntry(e.companyId, org.id, e.id, { date: e.dueDate });
    await prisma.bankTransaction.updateMany({ where: { entryId: e.id }, data: { date: e.dueDate } });
  }

  // ---------------- Compras ----------------
  for (const [i, sup] of [suppliers[0], suppliers[1], suppliers[2], suppliers[4]].entries()) {
    const prods = stockable.filter((p) => p.supplierId === sup.id).slice(0, 4);
    if (!prods.length) continue;
    const po = await savePurchase(actorModa, { supplierId: sup.id, items: prods.map((p) => ({ productId: p.id, quantity: randomInt(10, 40), unitCost: p.costPrice, lotNumber: p.controlsLot ? `LC${randomDigits(4)}` : null, expiresAt: p.controlsLot ? addDays(new Date(), 200).toISOString() : null })), freight: 60, installments: 2, paymentTermDays: 28 });
    const date = addDays(new Date(), -(70 - i * 15));
    await receivePurchase(actorModa, po.id);
    await prisma.purchaseOrder.update({ where: { id: po.id }, data: { date, receivedAt: date, createdAt: date } });
    await prisma.stockMovement.updateMany({ where: { originId: po.id }, data: { createdAt: date } });
    for (const e of await prisma.financialEntry.findMany({ where: { originId: po.id } })) {
      const due = addDays(date, 28 + (e.installment - 1) * 30);
      await prisma.financialEntry.update({ where: { id: e.id }, data: { issueDate: date, competenceDate: date, dueDate: due } });
      if (due < new Date()) {
        await payEntry(moda.id, org.id, e.id, { date: due });
        await prisma.bankTransaction.updateMany({ where: { entryId: e.id }, data: { date: due } });
      }
    }
  }
  const poOpen = await savePurchase(actorModa, { supplierId: suppliers[2].id, items: [{ productId: simples.tenis.id, quantity: 24, unitCost: 158 }], expectedDate: addDays(new Date(), 5).toISOString(), installments: 3, notes: 'Reposição para coleção de verão' });
  await prisma.purchaseOrder.update({ where: { id: poOpen.id }, data: { status: 'ENVIADO' } });
  await savePurchase(actorTech, { supplierId: suppliers[1].id, items: [{ productId: simples.relogio.id, quantity: 10, unitCost: 228 }, { productId: simples.fone.id, quantity: 20, unitCost: 80 }], expectedDate: addDays(new Date(), 10).toISOString() });
  await importNfeXml(actorModa, await sampleSupplierXml(actorModa));
  log('Compras recebidas, pedido em trânsito e XML de NF-e pendente de lançamento');

  // ---------------- Despesas recorrentes ----------------
  const fixed: [string, number, string, string][] = [
    ['Aluguel do galpão', 3800, '2.2.01', 'ADM'], ['Energia elétrica', 690, '2.2.02', 'ADM'], ['Internet fibra + telefonia', 249.9, '2.2.03', 'ADM'],
    ['Honorários contábeis', 890, '2.2.04', 'ADM'], ['Assinatura GestãoPro', 299, '2.2.05', 'ADM'], ['Folha de pagamento', 7400, '2.3.01', 'ADM'],
    ['FGTS e benefícios', 1900, '2.3.02', 'ADM'], ['Anúncios Google/Meta', 1500, '2.4.01', 'ECO'], ['DAS - Simples Nacional', 2600, '2.6.01', 'ADM'], ['Tarifa bancária pacote', 79.9, '2.5.01', 'ADM'],
  ];
  for (const company of [moda, tech]) {
    const centers = await prisma.costCenter.findMany({ where: { companyId: company.id } });
    for (let m = -3; m <= 1; m++) {
      for (const [desc, value, code, cc] of fixed) {
        const due = new Date(new Date().getFullYear(), new Date().getMonth() + m, pick([5, 10, 15, 20]));
        const amount = round2(value * (company.id === tech.id ? 0.6 : 1) * (1 + (Math.random() - 0.5) * 0.1));
        const [e] = await createEntries(prisma, { companyId: company.id, type: 'PAGAR', description: `${desc} - ${String(due.getMonth() + 1).padStart(2, '0')}/${due.getFullYear()}`, contactName: desc.includes('Aluguel') ? 'Imobiliária Central' : desc.includes('Energia') ? 'Enel Distribuição' : undefined, total: amount, firstDueDate: due, chartAccountCode: code, costCenterId: centers.find((c) => c.code === cc)?.id, paymentMethod: 'BOLETO', competenceDate: due });
        if (due < addDays(new Date(), -1)) {
          await payEntry(company.id, org.id, e.id, { date: due });
          await prisma.bankTransaction.updateMany({ where: { entryId: e.id }, data: { date: due } });
        }
      }
    }
  }
  log('Despesas recorrentes (3 meses) lançadas');

  // ---------------- Propostas ----------------
  const q1 = await saveQuote(actorModa, { customerId: customers[15].id, sellerId: sellers[1].id, priceListId: priceLists.atacado.id, items: [{ productId: camiseta.children[0].id, quantity: 30 }, { productId: camiseta.children[4].id, quantity: 30 }], paymentTerms: '30/60 dias boleto', deliveryTerms: 'Entrega em 7 dias úteis', status: 'ENVIADA' });
  await saveQuote(actorModa, { customerId: customers[16].id, sellerId: sellers[1].id, items: [{ productId: simples.tenis.id, quantity: 12 }, { productId: simples.bone.id, quantity: 20 }], paymentTerms: 'À vista com 5% de desconto', status: 'RASCUNHO' });
  const q3 = await saveQuote(actorTech, { customerId: customers[18].id, sellerId: sellers[0].id, items: [{ productId: simples.ssd.id, quantity: 8 }, { serviceId: services[0].id, quantity: 8, unitPrice: 100 }], paymentTerms: '28 dias', status: 'ENVIADA' });
  await approveQuote(actorTech, q3.id);
  await saveQuote(actorModa, { customerId: customers[2].id, items: [{ productId: simples.mochila.id, quantity: 1 }], status: 'RECUSADA' });
  void q1;
  log('Propostas comerciais (uma aprovada → convertida em pedido)');

  // ---------------- Produção ----------------
  const op1 = await createProductionOrder(actorModa, { productId: personalizada.id, quantity: 40, dueDate: addDays(new Date(), -20).toISOString(), responsible: 'Marina Expedição' });
  await startProduction(actorModa, op1.id);
  await finishProduction(actorModa, op1.id);
  await prisma.productionOrder.update({ where: { id: op1.id }, data: { startDate: addDays(new Date(), -25), finishedAt: addDays(new Date(), -21) } });
  const op2 = await createProductionOrder(actorModa, { productId: personalizada.id, quantity: 60, startDate: addDays(new Date(), -2).toISOString(), dueDate: addDays(new Date(), 4).toISOString(), responsible: 'Marina Expedição' });
  await startProduction(actorModa, op2.id);
  await createProductionOrder(actorModa, { productId: personalizada.id, quantity: 100, startDate: addDays(new Date(), 6).toISOString(), dueDate: addDays(new Date(), 12).toISOString(), notes: 'Pedido corporativo Boutique Elegance' });
  log('Ordens de produção (finalizada, em produção e planejada)');

  // ---------------- Ordens de serviço ----------------
  const tecnico = sellers[3];
  const os1 = await saveServiceOrder(actorTech, { customerId: customers[17].id, technicianId: tecnico.id, equipment: 'Notebook', brand: 'Dell', model: 'Inspiron 15', serialNumber: 'DL' + randomDigits(8), problem: 'Notebook não liga após queda de energia', items: [{ kind: 'SERVICO', serviceId: services[1].id, quantity: 1, unitPrice: 180 }, { kind: 'PRODUTO', productId: simples.ssd.id, quantity: 1, unitPrice: 259.9 }] });
  await changeServiceOrderStatus(actorTech, os1.id, 'EM_EXECUCAO', 'Diagnóstico: fonte e SSD danificados');
  await changeServiceOrderStatus(actorTech, os1.id, 'CONCLUIDA', 'SSD substituído e sistema restaurado');
  await invoiceServiceOrder(actorTech, os1.id);
  const os2 = await saveServiceOrder(actorTech, { customerId: customers[2].id, technicianId: tecnico.id, equipment: 'Desktop', brand: 'Positivo', problem: 'Lentidão e vírus', items: [{ kind: 'SERVICO', serviceId: services[2].id, quantity: 1, unitPrice: 150 }], dueDate: addDays(new Date(), 2).toISOString() });
  await changeServiceOrderStatus(actorTech, os2.id, 'EM_EXECUCAO', 'Backup em andamento');
  const os3 = await saveServiceOrder(actorTech, { customerId: customers[13].id, technicianId: tecnico.id, equipment: 'Impressora', brand: 'HP', model: 'LaserJet M1132', problem: 'Atolamento de papel constante', items: [{ kind: 'SERVICO', serviceId: services[4].id, quantity: 1, unitPrice: 95 }], dueDate: addDays(new Date(), 5).toISOString() });
  await changeServiceOrderStatus(actorTech, os3.id, 'AGUARDANDO_PECA', 'Aguardando rolete de tração');
  await saveServiceOrder(actorTech, { customerId: customers[19].id, equipment: 'Rede corporativa', problem: 'Instalação de 8 pontos de rede e roteador', items: [{ kind: 'SERVICO', serviceId: services[0].id, quantity: 8, unitPrice: 110 }], dueDate: addDays(new Date(), 7).toISOString() });
  log('Ordens de serviço');

  // ---------------- PDV ----------------
  const session = await prisma.cashSession.create({ data: { companyId: moda.id, userName: 'Juliana Loja', openingAmount: 200, openedAt: addDays(new Date(), -1), status: 'ABERTO' } });
  await prisma.cashMovement.create({ data: { sessionId: session.id, type: 'ABERTURA', amount: 200, createdAt: addDays(new Date(), -1) } });
  let cashSales = 0;
  for (let i = 0; i < 6; i++) {
    const p = pick([...camiseta.children, simples.bone, simples.meia]);
    const method = pick(['DINHEIRO', 'CARTAO_DEBITO', 'PIX', 'CARTAO_CREDITO']);
    const o = await createOrder(actorModa, { customerId: consumer.id, origin: 'PDV', items: [{ productId: p.id, quantity: randomInt(1, 2) }], paymentMethod: method, paidOnCreate: true, warehouseId: whLoja!.id, cashSessionId: session.id, sellerId: sellers[2].id });
    await invoiceOrder(actorModa, o.id, { model: 'NFCE' });
    await prisma.cashMovement.create({ data: { sessionId: session.id, type: 'VENDA', method, amount: o.total, orderId: o.id, createdAt: addDays(new Date(), -1) } });
    if (method === 'DINHEIRO') cashSales += o.total;
    await ageOrder(o.id, addDays(new Date(), -1));
  }
  await prisma.cashMovement.create({ data: { sessionId: session.id, type: 'SANGRIA', amount: -100, notes: 'Sangria para cofre', createdAt: addDays(new Date(), -1) } });
  await prisma.cashSession.update({ where: { id: session.id }, data: { status: 'FECHADO', closedAt: addDays(new Date(), -1), expectedAmount: round2(200 + cashSales - 100), closingAmount: round2(200 + cashSales - 100) } });
  await prisma.posTerminal.create({ data: { companyId: moda.id, name: 'Maquininha Loja 01', serial: 'STN' + randomDigits(8), acquirer: 'Stone', bankAccountId: (await prisma.bankAccount.findFirst({ where: { companyId: moda.id, type: 'CONTA_DIGITAL' } }))!.id } });
  await prisma.posTerminal.create({ data: { companyId: tech.id, name: 'POS Balcão', serial: 'PAG' + randomDigits(8), acquirer: 'PagBank', debitFee: 1.99, creditFee: 4.39 } });
  log('PDV: sessão de caixa com vendas e NFC-e');

  // ---------------- Loja virtual, API e webhooks ----------------
  await prisma.store.create({ data: { companyId: moda.id, slug: 'modabrasil', name: 'Moda Brasil', primaryColor: '#16a34a', accentColor: '#0f172a', logoText: 'MODA BRASIL', bannerTitle: 'Coleção Verão 2026', bannerSubtitle: 'Até 20% OFF no Pix e frete grátis acima de R$ 299', aboutText: 'Moda casual brasileira desde 2015. Peças confortáveis, sustentáveis e com o melhor preço.', whatsapp: '11999990000', freeShippingAbove: 299, pixDiscount: 5, warehouseId: whModa!.id } });
  await prisma.store.create({ data: { companyId: tech.id, slug: 'techcasa', name: 'TechCasa', primaryColor: '#2563eb', accentColor: '#111827', logoText: 'TECHCASA', bannerTitle: 'Tecnologia para sua casa', bannerSubtitle: 'Eletrônicos com garantia e assistência técnica própria', freeShippingAbove: 499 } });
  const crypto = await import('crypto');
  const demoKey = 'gp_live_demo_0123456789abcdef';
  await prisma.apiKey.create({ data: { companyId: moda.id, name: 'Chave de demonstração', prefix: demoKey.slice(0, 12), keyHash: crypto.createHash('sha256').update(demoKey).digest('hex') } });
  await prisma.webhook.create({ data: { companyId: moda.id, url: 'https://webhook.simulado.dev/gestaopro', events: ['order.created', 'order.invoiced', 'invoice.authorized', 'stock.changed'], secret: randomDigits(24) } });
  const recv = await prisma.financialEntry.findFirst({ where: { companyId: moda.id, type: 'RECEBER', status: 'ABERTO', dueDate: { gt: new Date() } } });
  if (recv) await prisma.paymentLink.create({ data: { companyId: moda.id, slug: `pg${randomDigits(8)}`, description: recv.description, amount: recv.amount, entryId: recv.id, customerName: recv.contactName, pixPayload: recv.pixPayload, expiresAt: recv.dueDate } });
  log('Loja virtual /loja/modabrasil, chave de API e webhook');

  await prisma.notification.createMany({ data: [
    { companyId: moda.id, title: 'Bem-vindo ao GestãoPro!', message: 'Este é um ambiente de demonstração com dados fictícios. Integrações externas são simuladas.', level: 'success', link: '/' },
    { companyId: moda.id, title: 'NF-e de entrada disponível', message: 'Há um XML de fornecedor aguardando lançamento.', level: 'info', link: '/compras/xml' },
  ] });
  // Limites de crédito definidos após o histórico (para não bloquear a simulação)
  await prisma.contact.updateMany({ where: { organizationId: org.id, types: { has: 'CLIENTE' }, personType: 'PF', code: null }, data: { creditLimit: 5000 } });
  await prisma.contact.updateMany({ where: { organizationId: org.id, types: { has: 'CLIENTE' }, personType: 'PJ' }, data: { creditLimit: 80000 } });
  console.log('✅ Seed concluído!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
