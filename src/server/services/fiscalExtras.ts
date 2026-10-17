/**
 * Recursos fiscais complementares:
 * - Transferência de mercadorias entre empresas (CNPJs) com NF-e de transferência
 * - Manifestação do destinatário (Distribuição DF-e real via SEFAZ/Focus ou simulada)
 * - Arquivos para o contador: SPED Fiscal (EFD ICMS/IPI), Sintegra e pacote ZIP de XMLs
 */
import JSZip from 'jszip';
import { prisma } from '@/lib/db';
import { round2, onlyDigits } from '@/lib/utils';
import { UF_CODES } from '@/lib/br';
import { fail } from '../errors';
import { nextNumber } from '../sequence';
import { emit } from '../events';
import { moveStock } from './stock';
import { buildInvoice, transmitInvoice, fiscalProviderOf } from './fiscal';
import { sefazCtx, distribuicaoDFe, enviarEvento, detManifestacao, readDistributedNfe } from './sefaz/nfe';
import { getAccount } from '@/server/integrations/accounts';
import { focusReceived, focusManifest, focusDownload } from '@/server/integrations/providers/focusnfe';
import { importNfeXml, sampleSupplierXml } from './purchases';
import type { Actor } from './sales';

// ---------------------------------------------------------------------------
// Transferência entre empresas
// ---------------------------------------------------------------------------
export async function transferBetweenCompanies(actor: Actor, input: { toCompanyId: string; fromWarehouseId?: string; toWarehouseId?: string; items: { productId: string; quantity: number }[]; emitInvoice?: boolean }) {
  if (input.toCompanyId === actor.companyId) fail(400, 'Escolha uma empresa de destino diferente');
  const from = await prisma.company.findUnique({ where: { id: actor.companyId } });
  const to = await prisma.company.findFirst({ where: { id: input.toCompanyId, organizationId: actor.orgId } });
  if (!to) fail(400, 'Empresa de destino inválida');
  const fromWh = input.fromWarehouseId ? await prisma.warehouse.findFirst({ where: { id: input.fromWarehouseId, companyId: actor.companyId } }) : await prisma.warehouse.findFirst({ where: { companyId: actor.companyId, isDefault: true } });
  const toWh = input.toWarehouseId ? await prisma.warehouse.findFirst({ where: { id: input.toWarehouseId, companyId: to!.id } }) : await prisma.warehouse.findFirst({ where: { companyId: to!.id, isDefault: true } });
  if (!fromWh || !toWh) fail(400, 'Depósitos de origem/destino inválidos');
  const items: { productId: string; quantity: number; unitCost: number; name: string }[] = [];
  for (const it of input.items.filter((i) => Number(i.quantity) > 0)) {
    const p = await prisma.product.findFirst({ where: { id: it.productId, organizationId: actor.orgId } });
    if (!p) fail(400, 'Produto inválido');
    const bal = await prisma.stockBalance.findUnique({ where: { productId_warehouseId: { productId: p!.id, warehouseId: fromWh!.id } } });
    items.push({ productId: p!.id, quantity: Number(it.quantity), unitCost: bal?.avgCost || p!.costPrice, name: p!.name });
  }
  if (!items.length) fail(400, 'Informe os itens');
  const total = round2(items.reduce((a, i) => a + i.quantity * i.unitCost, 0));
  const number = await nextNumber(prisma, from!.id, 'TRANSFERENCIA_CNPJ', 1);
  const tr = await prisma.companyTransfer.create({ data: { number, fromCompanyId: from!.id, toCompanyId: to!.id, fromWarehouseId: fromWh!.id, toWarehouseId: toWh!.id, items, total } });

  let invoiceId: string | null = null;
  if (input.emitInvoice !== false) {
    // A empresa de destino como destinatária da NF-e (cadastro compartilhado)
    let contact = await prisma.contact.findFirst({ where: { organizationId: actor.orgId, document: onlyDigits(to!.cnpj) } });
    contact ||= await prisma.contact.create({ data: { organizationId: actor.orgId, types: ['CLIENTE', 'FORNECEDOR'], personType: 'PJ', name: to!.name, tradeName: to!.tradeName, document: onlyDigits(to!.cnpj), ie: to!.ie, ieIndicator: 1, zip: to!.zip, street: to!.street, number: to!.number, district: to!.district, city: to!.city, uf: to!.uf, notes: 'Empresa do grupo (transferências)' } });
    const inv = await buildInvoice(prisma, { companyId: from!.id, model: 'NFE', natureKind: 'TRANSFERENCIA', customerId: contact.id, transferId: tr.id, items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: round2(i.unitCost) })), additionalInfo: `Transferência nº ${number} entre estabelecimentos do mesmo grupo.` });
    const r = await transmitInvoice(from!.id, actor.orgId, inv.id, actor.userName);
    if (r?.status !== 'AUTORIZADA') {
      await prisma.companyTransfer.update({ where: { id: tr.id }, data: { status: 'REJEITADA', invoiceId: inv.id } });
      fail(400, `NF-e de transferência rejeitada: ${r?.rejectionReason}`);
    }
    invoiceId = inv.id;
  }
  const changed: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const i of items) {
      changed.push(...(await moveStock(tx, { companyId: from!.id, productId: i.productId, warehouseId: fromWh!.id, quantity: i.quantity, direction: 'OUT', type: 'TRANSFERENCIA_SAIDA', origin: 'TRANSFERENCIA', originId: tr.id, originLabel: `Transferência nº ${number} para ${to!.tradeName || to!.name}`, userName: actor.userName })));
      changed.push(...(await moveStock(tx, { companyId: to!.id, productId: i.productId, warehouseId: toWh!.id, quantity: i.quantity, direction: 'IN', type: 'TRANSFERENCIA_ENTRADA', origin: 'TRANSFERENCIA', originId: tr.id, originLabel: `Transferência nº ${number} de ${from!.tradeName || from!.name}`, unitCost: i.unitCost, userName: actor.userName })));
    }
  });
  await prisma.companyTransfer.update({ where: { id: tr.id }, data: { invoiceId } });
  await emit('stock.changed', { ...actor, productIds: [...new Set(changed)] });
  await emit('stock.changed', { companyId: to!.id, orgId: actor.orgId, userName: actor.userName, productIds: [...new Set(changed)] });
  await emit('transfer.created', { ...actor, transferId: tr.id });
  return prisma.companyTransfer.findUnique({ where: { id: tr.id } });
}

// ---------------------------------------------------------------------------
// Manifestação do destinatário (Distribuição DF-e)
// SIMULADO: gera NF-e de fornecedores fictícios | SEFAZ: NFeDistribuicaoDFe e
// eventos 2102xx no Ambiente Nacional | FOCUS_NFE: /v2/nfes_recebidas
// ---------------------------------------------------------------------------
const DFE_STATE = 'SEFAZ_DFE';
/** Último NSU/versão consultado (linha interna em IntegrationAccount, oculta da tela de contas) */
async function dfeState(companyId: string) {
  const row = await prisma.integrationAccount.upsert({ where: { companyId_provider: { companyId, provider: DFE_STATE } }, create: { companyId, provider: DFE_STATE, status: 'INTERNO' }, update: {} });
  return { id: row.id, settings: (row.settings || {}) as Record<string, any> };
}
async function saveDfeState(id: string, settings: Record<string, any>) {
  await prisma.integrationAccount.update({ where: { id }, data: { settings } });
}

async function upsertDistributed(companyId: string, xml: string) {
  const d = readDistributedNfe(xml);
  if (!d.accessKey) return null;
  const existing = await prisma.nfeDistribution.findUnique({ where: { companyId_accessKey: { companyId, accessKey: d.accessKey } } });
  if (existing) {
    // Resumo substituído pela NF-e completa quando ela chega (após a ciência)
    if (d.full && !existing.xml.includes('<infNFe')) return prisma.nfeDistribution.update({ where: { id: existing.id }, data: { xml } });
    return null;
  }
  return prisma.nfeDistribution.create({ data: { companyId, accessKey: d.accessKey, number: d.number, issuerName: d.issuerName, issuerCnpj: d.issuerCnpj, issueDate: d.issueDate, total: d.total, xml } });
}

export async function fetchDistribution(actor: Actor, count = 3) {
  const company = (await prisma.company.findUnique({ where: { id: actor.companyId } }))!;
  const provider = fiscalProviderOf(company);
  if (provider === 'SEFAZ') {
    const ctx = sefazCtx(company);
    const st = await dfeState(actor.companyId);
    if (st.settings.blockedUntil && Date.now() < st.settings.blockedUntil) fail(429, `Consulta bloqueada pela SEFAZ por consumo indevido (656) até ${new Date(st.settings.blockedUntil).toLocaleTimeString('pt-BR')}. Aguarde 1 hora entre consultas sem novos documentos.`);
    let ultNSU = String(st.settings.ultNSU || '0');
    const created = [];
    for (let i = 0; i < Math.max(count, 1); i++) {
      const r = await distribuicaoDFe(ctx, { ultNSU });
      if (r.cStat === '656') {
        await saveDfeState(st.id, { ...st.settings, ultNSU, blockedUntil: Date.now() + 3600_000 });
        fail(429, `SEFAZ: ${r.cStat} - ${r.xMotivo}`);
      }
      if (!['137', '138'].includes(r.cStat)) fail(400, `SEFAZ: ${r.cStat} - ${r.xMotivo}`);
      for (const doc of r.docs) if (/^(resNFe|procNFe)/.test(doc.schema)) { const row = await upsertDistributed(actor.companyId, doc.xml); if (row) created.push(row); }
      ultNSU = r.ultNSU || ultNSU;
      // 137: nada novo — a SEFAZ exige aguardar 1h antes de nova consulta
      await saveDfeState(st.id, { ...st.settings, ultNSU, maxNSU: r.maxNSU, lastAt: Date.now(), ...(r.cStat === '137' ? { blockedUntil: Date.now() + 3600_000 } : { blockedUntil: null }) });
      if (r.cStat === '137' || Number(ultNSU) >= Number(r.maxNSU)) break;
    }
    return created;
  }
  if (provider === 'FOCUS_NFE') {
    const acc = await getAccount(actor.companyId, 'FOCUS_NFE');
    if (!acc) fail(400, 'Conecte a conta Focus NFe em Integrações → Contas e credenciais');
    const st = await dfeState(actor.companyId);
    const r = await focusReceived(acc!, onlyDigits(company.cnpj), Number(st.settings.focusVersion || 0));
    const created = [];
    for (const n of r.items) {
      if (!n.chave_nfe || (await prisma.nfeDistribution.findUnique({ where: { companyId_accessKey: { companyId: actor.companyId, accessKey: n.chave_nfe } } }))) continue;
      const xml = n.nfe_completa ? (await focusDownload(acc!, `/v2/nfes_recebidas/${n.chave_nfe}.xml`).catch(() => null)) : null;
      created.push(await prisma.nfeDistribution.create({ data: { companyId: actor.companyId, accessKey: n.chave_nfe, number: String(Number(String(n.chave_nfe).slice(25, 34))), issuerName: n.nome_emitente || 'Emitente', issuerCnpj: onlyDigits(n.documento_emitente), issueDate: new Date(n.data_emissao || Date.now()), total: Number(n.valor_total || 0), xml: xml || `<resNFe><chNFe>${n.chave_nfe}</chNFe></resNFe>` } }));
    }
    await saveDfeState(st.id, { ...st.settings, focusVersion: r.maxVersion });
    return created;
  }
  const created = [];
  for (let i = 0; i < count; i++) {
    const xml = await sampleSupplierXml(actor);
    const key = xml.match(/Id="NFe(\d{44})"/)![1];
    const name = xml.match(/<emit><CNPJ>\d+<\/CNPJ><xNome>([^<]+)/)?.[1] || 'Fornecedor';
    const cnpj = xml.match(/<emit><CNPJ>(\d+)/)?.[1] || '';
    const total = Number(xml.match(/<vNF>([\d.]+)<\/vNF>/)?.[1] || 0);
    const number = xml.match(/<nNF>(\d+)<\/nNF>/)?.[1] || '';
    created.push(await prisma.nfeDistribution.create({ data: { companyId: actor.companyId, accessKey: key, number, issuerName: name, issuerCnpj: cnpj, issueDate: new Date(), total, xml } }));
  }
  return created;
}

const EVENT_DESC: Record<string, string> = { CIENCIA: '210210 - Ciência da Operação', CONFIRMADA: '210200 - Confirmação da Operação', DESCONHECIDA: '210220 - Desconhecimento da Operação', NAO_REALIZADA: '210240 - Operação não Realizada' };
const EVENT_CODE: Record<string, string> = { CIENCIA: '210210', CONFIRMADA: '210200', DESCONHECIDA: '210220', NAO_REALIZADA: '210240' };

export async function manifest(actor: Actor, id: string, status: string, justification?: string) {
  if (!EVENT_DESC[status]) fail(400, 'Tipo de manifestação inválido');
  const d = await prisma.nfeDistribution.findFirst({ where: { id, companyId: actor.companyId } });
  if (!d) fail(404, 'Documento não encontrado');
  if (status === 'NAO_REALIZADA' && (!justification || justification.length < 15)) fail(400, 'Justificativa obrigatória (mín. 15 caracteres) para "Operação não realizada"');
  if (['CONFIRMADA', 'DESCONHECIDA', 'NAO_REALIZADA'].includes(d!.status)) fail(400, 'Manifestação conclusiva já registrada');
  const company = (await prisma.company.findUnique({ where: { id: actor.companyId } }))!;
  const provider = fiscalProviderOf(company);
  if (provider === 'SEFAZ') {
    const r = await enviarEvento(sefazCtx(company), 55, { chNFe: d!.accessKey, tpEvento: EVENT_CODE[status], det: detManifestacao(EVENT_CODE[status], justification), nacional: true });
    // 573: evento em duplicidade (já registrado) — trata como sucesso
    if (!r.ok && r.cStat !== '573') fail(400, `SEFAZ: ${r.cStat} - ${r.xMotivo}`);
  } else if (provider === 'FOCUS_NFE') {
    const acc = await getAccount(actor.companyId, 'FOCUS_NFE');
    if (!acc) fail(400, 'Conecte a conta Focus NFe em Integrações → Contas e credenciais');
    const r = await focusManifest(acc!, d!.accessKey, status, justification);
    if (!r.ok) fail(400, `Manifestação rejeitada: ${r.xMotivo}`);
  }
  return prisma.nfeDistribution.update({ where: { id }, data: { status } });
}

/** Importa o XML de um documento manifestado para o fluxo de NF-e de entrada */
export async function importDistribution(actor: Actor, id: string) {
  const d = await prisma.nfeDistribution.findFirst({ where: { id, companyId: actor.companyId } });
  if (!d) fail(404, 'Documento não encontrado');
  if (!['CIENCIA', 'CONFIRMADA'].includes(d!.status)) fail(400, 'Manifeste ciência ou confirmação antes de baixar o XML');
  if (d!.inboundId) fail(400, 'XML já importado');
  let xml = d!.xml;
  if (!xml.includes('<infNFe')) {
    // Só o resumo foi distribuído: busca a NF-e completa pela chave
    const company = (await prisma.company.findUnique({ where: { id: actor.companyId } }))!;
    const provider = fiscalProviderOf(company);
    if (provider === 'SEFAZ') {
      const r = await distribuicaoDFe(sefazCtx(company), { chNFe: d!.accessKey });
      xml = r.docs.find((x) => x.schema.startsWith('procNFe'))?.xml || xml;
    } else if (provider === 'FOCUS_NFE') {
      const acc = await getAccount(actor.companyId, 'FOCUS_NFE');
      if (acc) xml = (await focusDownload(acc, `/v2/nfes_recebidas/${d!.accessKey}.xml`).catch(() => null)) || xml;
    }
    if (!xml.includes('<infNFe')) fail(400, 'A NF-e completa ainda não está disponível na SEFAZ — tente novamente em alguns minutos após a ciência');
    await prisma.nfeDistribution.update({ where: { id }, data: { xml } });
  }
  const inbound = await importNfeXml(actor, xml);
  await prisma.nfeDistribution.update({ where: { id }, data: { inboundId: inbound.id } });
  return inbound;
}

export { EVENT_DESC };

// ---------------------------------------------------------------------------
// Arquivos para o contador
// ---------------------------------------------------------------------------
const d8 = (d: Date) => `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`;
const v2 = (n: number) => (Number(n) || 0).toFixed(2).replace('.', ',');
const clean = (s: unknown) => String(s ?? '').replace(/\|/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * SPED Fiscal (EFD ICMS/IPI) — leiaute com os registros principais
 * (0000/0005/0150/0190/0200, C100/C170/C190, E110, bloco 9).
 */
export async function spedFiscal(companyId: string, from: Date, to: Date) {
  const c = (await prisma.company.findUnique({ where: { id: companyId } }))!;
  const invs = await prisma.invoice.findMany({ where: { companyId, model: { in: ['NFE', 'NFCE'] }, status: { in: ['AUTORIZADA', 'CANCELADA'] }, issueDate: { gte: from, lte: to } }, include: { items: true }, orderBy: { issueDate: 'asc' } });
  const inbound = await prisma.inboundInvoice.findMany({ where: { companyId, status: 'LANCADA', issueDate: { gte: from, lte: to } } });
  const lines: string[] = [];
  const reg = (...f: unknown[]) => lines.push(`|${f.map(clean).join('|')}|`);
  reg('0000', '019', '0', d8(from), d8(to), c.name, onlyDigits(c.cnpj), '', c.uf, onlyDigits(c.ie), c.cityCode || '', onlyDigits(c.im), '', 'A', '1');
  reg('0001', '0');
  reg('0005', c.tradeName || c.name, onlyDigits(c.zip), c.street, c.number, '', c.district, onlyDigits(c.phone), '', c.email);
  const contactIds = [...new Set(invs.map((i) => i.customerId).filter(Boolean))] as string[];
  const contacts = await prisma.contact.findMany({ where: { id: { in: contactIds } } });
  for (const p of contacts) {
    const doc = onlyDigits(p.document);
    reg('0150', p.id.slice(-10), p.name, '01058', doc.length === 14 ? doc : '', doc.length === 11 ? doc : '', onlyDigits(p.ie), '', '', p.street, p.number, '', p.district);
  }
  const units = new Set<string>();
  const productCodes = new Map<string, { code: string; desc: string; unit: string; ncm: string }>();
  for (const i of invs) for (const it of i.items) { units.add(it.unit); productCodes.set(it.code, { code: it.code, desc: it.description, unit: it.unit, ncm: onlyDigits(it.ncm) }); }
  for (const u of units) reg('0190', u, u === 'UN' ? 'Unidade' : u);
  for (const p of productCodes.values()) reg('0200', p.code, p.desc, '', '', p.unit, '00', p.ncm, '', '', '', '');
  const n0 = lines.length + 1;
  reg('0990', n0);
  const cStart = lines.length;
  reg('C001', invs.length || inbound.length ? '0' : '1');
  let debit = 0;
  for (const i of invs) {
    const canc = i.status === 'CANCELADA';
    reg('C100', i.direction === 'ENTRADA' ? '0' : '1', '0', i.customerId?.slice(-10) || '', i.model === 'NFCE' ? '65' : '55', canc ? '02' : '00', i.series, i.number, i.accessKey, d8(i.issueDate), d8(i.issueDate), canc ? '' : v2(i.total), '0', v2(i.discount), '0', canc ? '' : v2(i.productsTotal), i.freight ? '0' : '9', v2(i.freight), '0', '0', canc ? '' : v2(i.icmsBase), canc ? '' : v2(i.icmsValue), v2(i.icmsStBase), v2(i.icmsStValue), v2(i.ipiValue), v2(i.pisValue), v2(i.cofinsValue), '0', '0');
    if (canc) continue;
    if (i.direction === 'SAIDA') debit += i.icmsValue;
    // C190: consolidação por CST/CFOP/alíquota
    const groups = new Map<string, { cst: string; cfop: string; rate: number; total: number; base: number; icms: number; ipi: number }>();
    for (const it of i.items) {
      const k = `${it.cst}|${it.cfop}|${it.icmsRate}`;
      const g = groups.get(k) || { cst: it.cst || '', cfop: it.cfop || '', rate: it.icmsRate, total: 0, base: 0, icms: 0, ipi: 0 };
      g.total += it.total; g.base += it.icmsBase; g.icms += it.icmsValue; g.ipi += it.ipiValue;
      groups.set(k, g);
    }
    for (const g of groups.values()) reg('C190', `0${g.cst}`.slice(-3), g.cfop, v2(g.rate), v2(g.total), v2(g.base), v2(g.icms), '0', '0', '0', v2(g.ipi), '');
  }
  let credit = 0;
  for (const n of inbound) {
    credit += n.icmsValue;
    reg('C100', '0', '1', '', '55', '00', n.series, n.number, n.accessKey, d8(n.issueDate), d8(n.createdAt), v2(n.total), '1', '0', '0', v2(n.productsTotal), '1', v2(n.freight), '0', '0', v2(n.productsTotal), v2(n.icmsValue), '0', '0', v2(n.ipiValue), '0', '0', '0', '0');
  }
  reg('C990', lines.length - cStart + 1);
  const eStart = lines.length;
  reg('E001', '0');
  reg('E100', d8(from), d8(to));
  const saldo = round2(debit - credit);
  reg('E110', v2(debit), '0', '0', '0', v2(credit), '0', '0', '0', '0', v2(Math.max(saldo, 0)), '0', v2(Math.max(saldo, 0)), v2(Math.max(-saldo, 0)), '0');
  reg('E990', lines.length - eStart + 1);
  reg('9001', '0');
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l.split('|')[1], (counts.get(l.split('|')[1]) || 0) + 1);
  const nineStart = lines.length;
  const regs = [...counts.keys(), '9001', '9900', '9990', '9999'];
  const uniq = [...new Set(regs)];
  for (const r of uniq) reg('9900', r, r === '9900' ? uniq.length : r === '9990' || r === '9999' ? 1 : counts.get(r) || 1);
  reg('9990', lines.length - nineStart + 2);
  reg('9999', lines.length + 1);
  return lines.join('\r\n') + '\r\n';
}

/** Sintegra (Convênio ICMS 57/95) — registros 10, 11, 50, 54, 75 e 90 (linhas de 126 posições) */
export async function sintegra(companyId: string, from: Date, to: Date) {
  const c = (await prisma.company.findUnique({ where: { id: companyId } }))!;
  const invs = await prisma.invoice.findMany({ where: { companyId, model: 'NFE', status: { in: ['AUTORIZADA', 'CANCELADA'] }, issueDate: { gte: from, lte: to } }, include: { items: true } });
  const pad = (s: unknown, n: number) => clean(s).toUpperCase().slice(0, n).padEnd(n, ' ');
  const num = (v: number | string, n: number) => String(v).replace(/\D/g, '').slice(-n).padStart(n, '0');
  const money = (v: number, n: number) => num(Math.round((v || 0) * 100), n);
  const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const L: string[] = [];
  L.push(`10${num(c.cnpj, 14)}${pad(onlyDigits(c.ie), 14)}${pad(c.name, 35)}${pad(c.city, 30)}${pad(c.uf, 2)}${num(onlyDigits(c.phone) || '0', 10)}${ymd(from)}${ymd(to)}331`);
  L.push(`11${pad(c.street, 34)}${num(c.number || '0', 5)}${pad('', 22)}${pad(c.district, 15)}${num(c.zip || '0', 8)}${pad(c.name, 28)}${num(onlyDigits(c.phone) || '0', 12)}`);
  const products = new Map<string, string>();
  for (const i of invs) {
    const canc = i.status === 'CANCELADA' ? 'S' : 'N';
    const cfop = i.items[0]?.cfop || '5102';
    L.push(`50${num(i.customerDoc || '0', 14)}${pad('ISENTO', 14)}${ymd(i.issueDate)}${pad(i.customerUf || c.uf, 2)}55${pad(i.series, 3)}${num(i.number, 6)}${num(cfop, 4)}P${money(i.total, 13)}${money(i.icmsBase, 13)}${money(i.icmsValue, 13)}${money(0, 13)}${money(0, 13)}${num(Math.round((i.items[0]?.icmsRate || 0) * 100), 4)}${canc}`);
    i.items.forEach((it, idx) => {
      products.set(it.code, it.description);
      L.push(`54${num(i.customerDoc || '0', 14)}55${pad(i.series, 3)}${num(i.number, 6)}${num(it.cfop || cfop, 4)}${pad(`0${it.cst || ''}`.slice(-3), 3)}${num(idx + 1, 3)}${pad(it.code, 14)}${num(Math.round(it.quantity * 1000), 11)}${money(it.total, 12)}${money(0, 12)}${money(it.icmsBase, 12)}${money(0, 12)}${money(it.ipiValue, 12)}${num(Math.round(it.icmsRate * 100), 4)}`);
    });
  }
  for (const [code, desc] of products) L.push(`75${ymd(from)}${ymd(to)}${pad(code, 14)}${pad('', 8)}${pad(desc, 53)}${pad('UN', 6)}${num(0, 5)}${num(0, 4)}${num(0, 5)}${money(0, 13)}`);
  const count = (t: string) => L.filter((l) => l.startsWith(t)).length;
  L.push(`90${num(c.cnpj, 14)}${pad(onlyDigits(c.ie), 14)}50${num(count('50'), 8)}54${num(count('54'), 8)}75${num(count('75'), 8)}99${num(L.length + 1, 8)}`.padEnd(125, ' ') + '1');
  return L.map((l) => l.padEnd(126, ' ').slice(0, 126)).join('\r\n') + '\r\n';
}

/** Pacote ZIP com XMLs autorizados/cancelados, SPED, Sintegra e resumo (envio ao contador) */
export async function accountantPackage(companyId: string, from: Date, to: Date) {
  const zip = new JSZip();
  const invs = await prisma.invoice.findMany({ where: { companyId, status: { in: ['AUTORIZADA', 'CANCELADA'] }, issueDate: { gte: from, lte: to }, xml: { not: null } } });
  for (const i of invs) zip.file(`xml/${i.model}/${i.status === 'CANCELADA' ? 'cancelados/' : ''}${i.accessKey || `NFSE-${i.number}`}.xml`, i.xml!);
  const inbound = await prisma.inboundInvoice.findMany({ where: { companyId, issueDate: { gte: from, lte: to } } });
  for (const n of inbound) zip.file(`xml/entradas/${n.accessKey}.xml`, n.xml);
  zip.file('SPED_EFD_ICMS_IPI.txt', await spedFiscal(companyId, from, to));
  zip.file('SINTEGRA.txt', await sintegra(companyId, from, to));
  const auth = invs.filter((i) => i.status === 'AUTORIZADA');
  zip.file('RESUMO.txt', [
    `Período: ${from.toLocaleDateString('pt-BR')} a ${to.toLocaleDateString('pt-BR')}`,
    `Notas autorizadas: ${auth.length}  |  canceladas: ${invs.length - auth.length}  |  entradas: ${inbound.length}`,
    `Total faturado: ${auth.reduce((a, i) => a + i.total, 0).toFixed(2)}`,
    `ICMS: ${auth.reduce((a, i) => a + i.icmsValue, 0).toFixed(2)}  ST: ${auth.reduce((a, i) => a + i.icmsStValue, 0).toFixed(2)}  DIFAL: ${auth.reduce((a, i) => a + i.difalValue, 0).toFixed(2)}`,
    `IPI: ${auth.reduce((a, i) => a + i.ipiValue, 0).toFixed(2)}  PIS: ${auth.reduce((a, i) => a + i.pisValue, 0).toFixed(2)}  COFINS: ${auth.reduce((a, i) => a + i.cofinsValue, 0).toFixed(2)}  ISS: ${auth.reduce((a, i) => a + i.issValue, 0).toFixed(2)}`,
    `CBS: ${auth.reduce((a, i) => a + i.cbsValue, 0).toFixed(2)}  IBS: ${auth.reduce((a, i) => a + i.ibsValue, 0).toFixed(2)} (informativos 2026)`,
  ].join('\r\n'));
  return zip.generateAsync({ type: 'nodebuffer' });
}

export const UF_OF = UF_CODES;
