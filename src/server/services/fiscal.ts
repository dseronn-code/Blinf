/**
 * Módulo fiscal: NF-e (55), NFC-e (65) e NFS-e.
 * - Cálculo de ICMS (próprio, ST, DIFAL e FCP), IPI, PIS, COFINS, ISS e
 *   IBS/CBS da reforma tributária (alíquotas de teste 2026, informativas)
 * - CFOP por natureza de operação (intra/interestadual), CSOSN/CST
 * - Chave de acesso real (mod 11), XML no layout 4.00 com assinatura XMLDSig
 *   REAL quando há certificado A1 instalado
 * - "SEFAZ" simulada: validações com códigos de rejeição reais, protocolo,
 *   contingência (NFC-e offline), cancelamento (prazo e justificativa),
 *   carta de correção, inutilização de numeração e NF-e de devolução.
 * A transmissão aos webservices oficiais NÃO é realizada (exige credenciamento).
 */
import type { Db } from '@/lib/db';
import { prisma } from '@/lib/db';
import { round2, onlyDigits, randomDigits } from '@/lib/utils';
import { buildAccessKey, ICMS_INTERNAL, interstateIcmsRate, isValidCNPJ, isValidCPF, isValidAccessKey, UF_CODES, FCP_RATE, CBS_RATE, IBS_RATE } from '@/lib/br';
import { fail } from '../errors';
import { nextNumber } from '../sequence';
import { emit } from '../events';
import { signElement } from './cert';
import type { Company, Invoice, InvoiceItem, OperationNature } from '@prisma/client';

export type InvoiceModel = 'NFE' | 'NFCE' | 'NFSE';

type TaxInputItem = { total: number; ipiRate: number; origin: number; isService: boolean; issRate?: number; mvaST?: number };
export type TaxDest = { uf: string; contributor: boolean; finalConsumer: boolean };

/** Calcula os impostos de um item (após rateio de frete/desconto) */
export function calcItemTaxes(company: Pick<Company, 'uf' | 'crt' | 'taxRegime'>, nature: Pick<OperationNature, 'cfopIntra' | 'cfopInter' | 'csosn' | 'icmsCst' | 'icmsRateIntra' | 'pisRate' | 'cofinsRate' | 'issRate' | 'kind'>, dest: TaxDest, item: TaxInputItem, freightShare = 0, discountShare = 0) {
  const base = round2(item.total + freightShare - discountShare);
  const intra = !dest.uf || dest.uf === company.uf;
  const normal = company.crt !== 1;
  const out = {
    cfop: intra ? nature.cfopIntra : nature.cfopInter,
    cst: normal ? nature.icmsCst : nature.csosn,
    icmsBase: 0, icmsRate: 0, icmsValue: 0,
    icmsStBase: 0, icmsStValue: 0, difalValue: 0, fcpValue: 0,
    ipiRate: 0, ipiValue: 0,
    pisRate: 0, pisValue: 0, cofinsRate: 0, cofinsValue: 0,
    issRate: 0, issValue: 0,
    ibsRate: 0, ibsValue: 0, cbsRate: 0, cbsValue: 0,
  };
  // Reforma tributária: IBS/CBS em fase de teste (2026) — destaque informativo para o regime normal
  if (normal) {
    out.cbsRate = CBS_RATE; out.cbsValue = round2((base * CBS_RATE) / 100);
    out.ibsRate = IBS_RATE; out.ibsValue = round2((base * IBS_RATE) / 100);
  }
  if (item.isService) {
    out.cfop = '';
    out.cst = '';
    out.issRate = item.issRate ?? nature.issRate;
    out.issValue = round2((base * out.issRate) / 100);
    if (normal) {
      const [pis, cofins] = company.taxRegime === 'REAL' ? [1.65, 7.6] : [0.65, 3];
      out.pisRate = pis; out.pisValue = round2((base * pis) / 100);
      out.cofinsRate = cofins; out.cofinsValue = round2((base * cofins) / 100);
    }
    return out;
  }
  const ownRate = intra ? nature.icmsRateIntra || ICMS_INTERNAL[company.uf] || 18 : interstateIcmsRate(company.uf, dest.uf, item.origin);
  if (normal) {
    out.ipiRate = item.ipiRate || 0;
    out.ipiValue = round2((item.total * out.ipiRate) / 100);
    out.icmsRate = ownRate;
    out.icmsBase = round2(base + (dest.finalConsumer ? out.ipiValue : 0));
    out.icmsValue = round2((out.icmsBase * out.icmsRate) / 100);
    const [pis, cofins] = company.taxRegime === 'REAL' ? [nature.pisRate || 1.65, nature.cofinsRate || 7.6] : [0.65, 3];
    out.pisRate = pis; out.pisValue = round2((base * pis) / 100);
    out.cofinsRate = cofins; out.cofinsValue = round2((base * cofins) / 100);
    // DIFAL (EC 87/2015): venda interestadual a consumidor final não contribuinte
    if (!intra && !dest.contributor && dest.finalConsumer && ['VENDA', 'NFCE'].includes(nature.kind)) {
      const destRate = ICMS_INTERNAL[dest.uf] || 18;
      out.difalValue = round2((out.icmsBase * Math.max(destRate - ownRate, 0)) / 100);
      out.fcpValue = round2((out.icmsBase * (FCP_RATE[dest.uf] || 0)) / 100);
    }
  }
  // ICMS-ST: produto com MVA vendido a contribuinte para revenda
  if (item.mvaST && item.mvaST > 0 && dest.contributor && nature.kind === 'VENDA') {
    const ipi = normal ? out.ipiValue : 0;
    const destRate = ICMS_INTERNAL[dest.uf] || 18;
    out.icmsStBase = round2((base + ipi) * (1 + item.mvaST / 100));
    out.icmsStValue = round2(Math.max((out.icmsStBase * destRate) / 100 - (base * ownRate) / 100, 0));
    out.cst = normal ? '10' : '202';
    out.cfop = intra ? '5403' : '6403';
  }
  return out;
}

export async function natureFor(db: Db, companyId: string, model: InvoiceModel, natureId?: string | null, kindOverride?: string) {
  if (natureId) {
    const n = await db.operationNature.findFirst({ where: { id: natureId, companyId } });
    if (n) return n;
  }
  const kind = kindOverride || (model === 'NFCE' ? 'NFCE' : model === 'NFSE' ? 'SERVICO' : 'VENDA');
  const n =
    (await db.operationNature.findFirst({ where: { companyId, kind, isDefault: true } })) ||
    (await db.operationNature.findFirst({ where: { companyId, kind } })) ||
    (kindOverride ? null : await db.operationNature.findFirst({ where: { companyId } }));
  if (!n) fail(400, `Cadastre uma natureza de operação do tipo ${kind} em Notas Fiscais > Naturezas de operação`);
  return n!;
}

export type BuildInvoiceInput = {
  companyId: string;
  model: InvoiceModel;
  natureId?: string | null;
  natureKind?: string;
  customerId?: string | null;
  items: { productId?: string | null; serviceId?: string | null; description?: string; quantity: number; unitPrice: number }[];
  freight?: number;
  discount?: number;
  salesOrderId?: string | null;
  serviceOrderId?: string | null;
  additionalInfo?: string | null;
  consumerDoc?: string | null;
  refAccessKey?: string | null;
  returnId?: string | null;
  transferId?: string | null;
};

/** Monta a nota (status RASCUNHO) com itens e impostos calculados */
export async function buildInvoice(db: Db, input: BuildInvoiceInput) {
  const company = await db.company.findUnique({ where: { id: input.companyId } });
  if (!company) fail(404, 'Empresa não encontrada');
  const c = company!;
  const nature = await natureFor(db, c.id, input.model, input.natureId, input.natureKind);
  const customer = input.customerId ? await db.contact.findUnique({ where: { id: input.customerId } }) : null;
  const destUf = customer?.uf || c.uf;
  const dest: TaxDest = { uf: destUf, contributor: customer?.ieIndicator === 1, finalConsumer: !customer || customer.ieIndicator !== 1 };

  const rawItems = [];
  for (const it of input.items) {
    if (it.serviceId) {
      const s = await db.service.findUnique({ where: { id: it.serviceId } });
      if (!s) continue;
      rawItems.push({ productId: null, serviceId: s.id, code: s.code, description: it.description || s.name, ncm: null as string | null, unit: s.unit, quantity: it.quantity, unitPrice: it.unitPrice, total: round2(it.quantity * it.unitPrice), ipiRate: 0, origin: 0, isService: true, issRate: s.issRate, mvaST: 0 });
    } else if (it.productId) {
      const p = await db.product.findUnique({ where: { id: it.productId } });
      if (!p) continue;
      rawItems.push({ productId: p.id, serviceId: null, code: p.sku, description: it.description || p.name, ncm: p.ncm, unit: p.unit, quantity: it.quantity, unitPrice: it.unitPrice, total: round2(it.quantity * it.unitPrice), ipiRate: p.ipiRate, origin: p.origin, isService: false, issRate: undefined, mvaST: p.mvaST });
    }
  }
  const relevant = rawItems.filter((i) => (input.model === 'NFSE' ? i.isService : !i.isService));
  if (!relevant.length) fail(400, input.model === 'NFSE' ? 'Nenhum serviço para emitir NFS-e' : 'Nenhum produto para emitir a nota');

  const gross = round2(relevant.reduce((a, i) => a + i.total, 0));
  const freight = round2(input.model === 'NFSE' ? 0 : input.freight || 0);
  const discount = round2(input.discount || 0);
  const items = relevant.map((i) => {
    const share = gross ? i.total / gross : 0;
    return { ...i, ...calcItemTaxes(c, nature, dest, i, round2(freight * share), round2(discount * share)) };
  });
  const sum = (k: keyof (typeof items)[number]) => round2(items.reduce((a, i) => a + Number(i[k] || 0), 0));
  const productsTotal = input.model === 'NFSE' ? 0 : gross;
  const servicesTotal = input.model === 'NFSE' ? gross : 0;
  const ipiValue = sum('ipiValue');
  const icmsStValue = sum('icmsStValue');
  // ST e IPI compõem o total; DIFAL/FCP são recolhidos pelo emitente (GNRE); IBS/CBS informativos em 2026
  const total = round2(gross + freight - discount + ipiValue + icmsStValue);
  const key = input.model === 'NFCE' ? 'NFCE' : input.model === 'NFSE' ? 'NFSE' : 'NFE';
  const series = input.model === 'NFCE' ? c.nfceSeries : input.model === 'NFSE' ? 1 : c.nfeSeries;
  const number = await nextFreeNumber(db, c.id, input.model, series, `${key}-${series}`);
  const approxTaxes = round2(total * (input.model === 'NFSE' ? 0.1615 : 0.3145));
  const ibsValue = sum('ibsValue');
  const cbsValue = sum('cbsValue');
  const difalValue = sum('difalValue');
  const fcpValue = sum('fcpValue');

  const info = [
    input.additionalInfo,
    nature.finalidade === 4 && input.refAccessKey ? `Devolução referente à NF-e chave ${input.refAccessKey}.` : null,
    c.crt === 1 ? 'DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL. NÃO GERA DIREITO A CRÉDITO FISCAL DE IPI.' : null,
    difalValue ? `DIFAL (EC 87/2015) para ${destUf}: R$ ${difalValue.toFixed(2).replace('.', ',')}${fcpValue ? ` + FCP R$ ${fcpValue.toFixed(2).replace('.', ',')}` : ''}.` : null,
    cbsValue || ibsValue ? `IBS/CBS (LC 214/2025, teste 2026): CBS R$ ${cbsValue.toFixed(2).replace('.', ',')} / IBS R$ ${ibsValue.toFixed(2).replace('.', ',')}.` : null,
    `Val. aprox. tributos R$ ${approxTaxes.toFixed(2).replace('.', ',')} Fonte: IBPT (simulado).`,
    'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO / SIMULAÇÃO - SEM VALOR FISCAL',
  ].filter(Boolean).join(' ');

  return db.invoice.create({
    data: {
      companyId: c.id,
      model: input.model,
      number,
      series,
      status: 'RASCUNHO',
      natureId: nature.id,
      natureName: nature.name,
      direction: nature.direction,
      finalidade: nature.finalidade,
      refAccessKey: input.refAccessKey || null,
      returnId: input.returnId || null,
      transferId: input.transferId || null,
      customerId: customer?.id || null,
      customerName: customer?.name || 'CONSUMIDOR NÃO IDENTIFICADO',
      customerDoc: customer?.document || input.consumerDoc || null,
      customerUf: destUf,
      salesOrderId: input.salesOrderId || null,
      serviceOrderId: input.serviceOrderId || null,
      productsTotal, servicesTotal, freight, discount,
      icmsBase: sum('icmsBase'), icmsValue: sum('icmsValue'), ipiValue,
      icmsStBase: sum('icmsStBase'), icmsStValue, difalValue, fcpValue,
      pisValue: sum('pisValue'), cofinsValue: sum('cofinsValue'), issValue: sum('issValue'),
      ibsValue, cbsValue, approxTaxes, total,
      additionalInfo: info,
      items: {
        create: items.map((i) => ({
          productId: i.productId, serviceId: i.serviceId, code: i.code, description: i.description, ncm: i.ncm, cfop: i.cfop, cst: i.cst, unit: i.unit,
          quantity: i.quantity, unitPrice: i.unitPrice, total: i.total,
          icmsBase: i.icmsBase, icmsRate: i.icmsRate, icmsValue: i.icmsValue,
          icmsStBase: i.icmsStBase, icmsStValue: i.icmsStValue, difalValue: i.difalValue, fcpValue: i.fcpValue,
          ipiRate: i.ipiRate, ipiValue: i.ipiValue, pisRate: i.pisRate, pisValue: i.pisValue, cofinsRate: i.cofinsRate, cofinsValue: i.cofinsValue,
          issRate: i.issRate, issValue: i.issValue, ibsRate: i.ibsRate, ibsValue: i.ibsValue, cbsRate: i.cbsRate, cbsValue: i.cbsValue,
        })),
      },
      events: { create: { type: 'CRIACAO', description: 'Nota criada (rascunho)' } },
    },
    include: { items: true },
  });
}

/** Próximo número livre, pulando faixas inutilizadas */
async function nextFreeNumber(db: Db, companyId: string, model: string, series: number, seqKey: string) {
  for (let i = 0; i < 1000; i++) {
    const n = await nextNumber(db, companyId, seqKey, 1);
    const voided = await db.numberVoid.findFirst({ where: { companyId, model, series, fromNumber: { lte: n }, toNumber: { gte: n } } });
    if (!voided) return n;
  }
  return nextNumber(db, companyId, seqKey, 1);
}

/** Validações equivalentes às regras de negócio da SEFAZ (subconjunto) */
async function sefazValidate(db: Db, inv: Invoice & { items: InvoiceItem[] }, company: Company): Promise<{ code: string; reason: string } | null> {
  if (!company.certValidUntil) return { code: '280', reason: 'Rejeição: Certificado Transmissor inválido (nenhum certificado digital A1 instalado)' };
  if (company.certValidUntil < new Date()) return { code: '284', reason: 'Rejeição: Certificado Transmissor vencido' };
  if (!isValidCNPJ(company.cnpj)) return { code: '207', reason: 'Rejeição: CNPJ do emitente inválido' };
  if (inv.model !== 'NFSE' && !company.ie) return { code: '209', reason: 'Rejeição: IE do emitente inválida' };
  if (inv.total <= 0) return { code: '610', reason: 'Rejeição: Total da NF difere do somatório dos valores' };
  if (inv.finalidade === 4) {
    if (!inv.refAccessKey || !isValidAccessKey(inv.refAccessKey)) return { code: '267', reason: 'Rejeição: NF-e de devolução sem documento referenciado válido' };
  }
  if (inv.model === 'NFE') {
    const customer = inv.customerId ? await db.contact.findUnique({ where: { id: inv.customerId } }) : null;
    if (!customer) return { code: '226', reason: 'Rejeição: Destinatário não informado (obrigatório para NF-e)' };
    const doc = onlyDigits(customer.document);
    if (doc.length === 14 && !isValidCNPJ(doc)) return { code: '208', reason: 'Rejeição: CNPJ do destinatário inválido' };
    if (doc.length === 11 && !isValidCPF(doc)) return { code: '237', reason: 'Rejeição: CPF do destinatário inválido' };
    if (doc.length !== 11 && doc.length !== 14) return { code: '237', reason: 'Rejeição: CPF/CNPJ do destinatário não informado' };
    if (customer.ieIndicator === 1 && !customer.ie) return { code: '232', reason: 'Rejeição: IE do destinatário não informada' };
    if (!customer.city || !customer.uf) return { code: '228', reason: 'Rejeição: Endereço do destinatário incompleto (município/UF)' };
  }
  if (inv.model === 'NFCE' && inv.total > 200000) return { code: '702', reason: 'Rejeição: NFC-e com valor superior ao permitido' };
  if (inv.model !== 'NFSE') {
    const noNcm = inv.items.find((i) => !i.ncm || onlyDigits(i.ncm).length !== 8);
    if (noNcm) return { code: '778', reason: `Rejeição: Informado NCM inexistente (item ${noNcm.code})` };
  }
  return null;
}

/**
 * Transmite a nota. Gera chave, assina o XML (certificado real, se instalado),
 * valida pelas regras da SEFAZ simulada e autoriza. Em modo CONTINGENCIA, NFC-e
 * é emitida offline (tpEmis 9) e regularizada depois.
 */
export async function transmitInvoice(companyId: string, orgId: string, invoiceId: string, userName?: string) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId }, include: { items: true } });
  if (!inv) fail(404, 'Nota fiscal não encontrada');
  const invoice = inv!;
  if (invoice.status === 'AUTORIZADA') fail(400, 'Nota já autorizada');
  if (invoice.status === 'CANCELADA') fail(400, 'Nota cancelada');
  const company = (await prisma.company.findUnique({ where: { id: companyId } }))!;
  const offline = company.sefazMode === 'CONTINGENCIA' && invoice.model === 'NFCE' && invoice.status !== 'CONTINGENCIA';
  await prisma.invoiceEvent.create({ data: { invoiceId, type: 'TRANSMISSAO', description: offline ? 'SEFAZ indisponível — emissão em contingência offline (tpEmis 9)' : `Lote enviado à ${invoice.model === 'NFSE' ? 'prefeitura' : 'SEFAZ-' + company.uf} (homologação simulada)` } });

  const rejection = await sefazValidate(prisma, invoice, company);
  if (rejection) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'REJEITADA', rejectionCode: rejection.code, rejectionReason: rejection.reason } });
    await prisma.invoiceEvent.create({ data: { invoiceId, type: 'REJEICAO', code: rejection.code, description: `${rejection.code} - ${rejection.reason}` } });
    return prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, events: true } });
  }

  const now = new Date();
  let accessKey: string | null = invoice.accessKey;
  let verificationCode: string | null = null;
  let protocol: string | null = null;
  if (invoice.model === 'NFSE') {
    verificationCode = Math.random().toString(36).slice(2, 10).toUpperCase();
    protocol = `${now.getFullYear()}${randomDigits(9)}`;
  } else {
    accessKey ||= buildAccessKey({ uf: company.uf, date: now, cnpj: company.cnpj, model: invoice.model === 'NFCE' ? 65 : 55, series: invoice.series, number: invoice.number, tpEmis: offline ? 9 : 1 });
    if (!offline) protocol = `1${UF_CODES[company.uf] || '35'}${String(now.getFullYear()).slice(2)}${randomDigits(10)}`;
  }
  const { xml, signed } = buildXml({ ...invoice, accessKey, protocol, authorizedAt: now, contingency: offline || invoice.contingency }, company);
  if (offline) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'CONTINGENCIA', contingency: true, accessKey, issueDate: now, xml, signed, rejectionCode: null, rejectionReason: null } });
    await prisma.invoiceEvent.create({ data: { invoiceId, type: 'CONTINGENCIA', description: 'NFC-e emitida em contingência offline — transmitir em até 24h' } });
    // Para efeitos operacionais (estoque/financeiro) a venda segue normalmente
    await emit('invoice.authorized', { companyId, orgId, invoiceId, salesOrderId: invoice.salesOrderId, serviceOrderId: invoice.serviceOrderId, model: invoice.model, userName });
    return prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, events: true } });
  }
  const wasContingency = invoice.status === 'CONTINGENCIA';
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: 'AUTORIZADA', accessKey, protocol, verificationCode, authorizedAt: now, ...(wasContingency ? {} : { issueDate: now }), xml, signed, rejectionCode: null, rejectionReason: null },
  });
  await prisma.invoiceEvent.create({ data: { invoiceId, type: 'AUTORIZACAO', code: '100', protocol, description: `100 - Autorizado o uso da ${invoice.model === 'NFSE' ? 'NFS-e' : 'NF-e'}${signed ? ' (XML assinado com certificado A1)' : ''}` } });
  if (!wasContingency) await emit('invoice.authorized', { companyId, orgId, invoiceId, salesOrderId: invoice.salesOrderId, serviceOrderId: invoice.serviceOrderId, model: invoice.model, userName });
  return prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, events: true } });
}

/** Transmite as NFC-e emitidas em contingência (após a SEFAZ voltar) */
export async function regularizeContingency(companyId: string, orgId: string, userName?: string) {
  const pending = await prisma.invoice.findMany({ where: { companyId, status: 'CONTINGENCIA' } });
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (company?.sefazMode === 'CONTINGENCIA') fail(400, 'Desative o modo contingência antes de regularizar');
  let ok = 0;
  for (const i of pending) {
    const r = await transmitInvoice(companyId, orgId, i.id, userName);
    if (r?.status === 'AUTORIZADA') ok++;
  }
  return { total: pending.length, authorized: ok };
}

export async function cancelInvoice(companyId: string, orgId: string, invoiceId: string, reason: string, userName?: string) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId } });
  if (!inv) fail(404, 'Nota não encontrada');
  if (inv!.status !== 'AUTORIZADA') {
    if (inv!.status === 'RASCUNHO' || inv!.status === 'REJEITADA') {
      await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELADA', cancelReason: reason || 'Descartada', cancelledAt: new Date() } });
      return;
    }
    fail(400, 'Somente notas autorizadas podem ser canceladas');
  }
  if (!reason || reason.trim().length < 15) fail(400, 'Rejeição 255: A justificativa do cancelamento deve ter no mínimo 15 caracteres');
  const hours = (Date.now() - (inv!.authorizedAt?.getTime() || 0)) / 3600000;
  const limit = inv!.model === 'NFCE' ? 0.5 : inv!.model === 'NFSE' ? 24 * 30 : 24;
  if (hours > limit) {
    await prisma.invoiceEvent.create({ data: { invoiceId, type: 'REJEICAO', code: '501', description: '501 - Rejeição: Prazo de cancelamento superior ao previsto na legislação' } });
    fail(400, `Rejeição 501: Prazo de cancelamento superior ao previsto (${inv!.model === 'NFCE' ? '30 minutos' : '24 horas'}). Emita uma nota de devolução.`);
  }
  const protocol = `1${randomDigits(14)}`;
  await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELADA', cancelReason: reason, cancelProtocol: protocol, cancelledAt: new Date() } });
  await prisma.invoiceEvent.create({ data: { invoiceId, type: 'CANCELAMENTO', code: '135', protocol, description: `135 - Evento registrado e vinculado a NF-e. Justificativa: ${reason}` } });
  await emit('invoice.cancelled', { companyId, orgId, invoiceId, salesOrderId: inv!.salesOrderId, userName });
}

/** Inutilização de faixa de numeração (números pulados que não serão usados) */
export async function voidNumbers(companyId: string, input: { model: string; series: number; fromNumber: number; toNumber: number; reason: string }) {
  const { model, series, fromNumber, toNumber, reason } = input;
  if (!['NFE', 'NFCE'].includes(model)) fail(400, 'Inutilização disponível apenas para NF-e e NFC-e');
  if (!(fromNumber > 0) || toNumber < fromNumber) fail(400, 'Faixa de numeração inválida');
  if (toNumber - fromNumber > 9999) fail(400, 'Rejeição 252: faixa de inutilização muito extensa');
  if (!reason || reason.trim().length < 15) fail(400, 'Justificativa deve ter no mínimo 15 caracteres');
  const used = await prisma.invoice.findFirst({ where: { companyId, model, series, number: { gte: fromNumber, lte: toNumber }, status: { in: ['AUTORIZADA', 'CANCELADA', 'CONTINGENCIA'] } } });
  if (used) fail(400, `Rejeição 241: número ${used.number} já utilizado em documento autorizado`);
  const overlap = await prisma.numberVoid.findFirst({ where: { companyId, model, series, fromNumber: { lte: toNumber }, toNumber: { gte: fromNumber } } });
  if (overlap) fail(400, 'Rejeição 256: faixa já inutilizada');
  const protocol = `1${randomDigits(14)}`;
  return prisma.numberVoid.create({ data: { companyId, model, series, fromNumber, toNumber, reason, protocol } });
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
const n2 = (n: number) => (Number(n) || 0).toFixed(2);
const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';

/** Gera o XML (NF-e 4.00 / NFS-e ABRASF). Retorna também se foi assinado com certificado real. */
export function buildXml(inv: Invoice & { items: InvoiceItem[] }, company: Company): { xml: string; signed: boolean } {
  if (inv.model === 'NFSE') {
    return {
      signed: false,
      xml: `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse versao="2.04"><InfNfse Id="NFSe${inv.number}">
    <Numero>${inv.number}</Numero><CodigoVerificacao>${esc(inv.verificationCode)}</CodigoVerificacao>
    <DataEmissao>${(inv.authorizedAt || new Date()).toISOString()}</DataEmissao>
    <ValoresNfse><BaseCalculo>${n2(inv.servicesTotal)}</BaseCalculo><ValorIss>${n2(inv.issValue)}</ValorIss><ValorLiquidoNfse>${n2(inv.total - inv.issValue)}</ValorLiquidoNfse></ValoresNfse>
    <PrestadorServico><IdentificacaoPrestador><CpfCnpj><Cnpj>${onlyDigits(company.cnpj)}</Cnpj></CpfCnpj><InscricaoMunicipal>${esc(company.im)}</InscricaoMunicipal></IdentificacaoPrestador><RazaoSocial>${esc(company.name)}</RazaoSocial></PrestadorServico>
    <TomadorServico><RazaoSocial>${esc(inv.customerName)}</RazaoSocial><CpfCnpj>${esc(onlyDigits(inv.customerDoc))}</CpfCnpj></TomadorServico>
    <Servico>${inv.items.map((i) => `<Item><Discriminacao>${esc(i.description)}</Discriminacao><Quantidade>${i.quantity}</Quantidade><ValorUnitario>${n2(i.unitPrice)}</ValorUnitario><Aliquota>${n2(i.issRate)}</Aliquota></Item>`).join('')}</Servico>
    <IBSCBS><vCBS>${n2(inv.cbsValue)}</vCBS><vIBS>${n2(inv.ibsValue)}</vIBS></IBSCBS>
  </InfNfse></Nfse>
</CompNfse>`,
    };
  }
  const mod = inv.model === 'NFCE' ? 65 : 55;
  const sn = company.crt === 1;
  const icmsGroup = (i: InvoiceItem) => {
    if (sn) {
      if (i.icmsStValue) return `<ICMSSN202><orig>0</orig><CSOSN>${esc(i.cst)}</CSOSN><modBCST>4</modBCST><vBCST>${n2(i.icmsStBase)}</vBCST><pICMSST>${n2((i.icmsStValue / (i.icmsStBase || 1)) * 100)}</pICMSST><vICMSST>${n2(i.icmsStValue)}</vICMSST></ICMSSN202>`;
      return `<ICMSSN102><orig>0</orig><CSOSN>${esc(i.cst)}</CSOSN></ICMSSN102>`;
    }
    if (i.icmsStValue) return `<ICMS10><orig>0</orig><CST>10</CST><modBC>3</modBC><vBC>${n2(i.icmsBase)}</vBC><pICMS>${n2(i.icmsRate)}</pICMS><vICMS>${n2(i.icmsValue)}</vICMS><modBCST>4</modBCST><vBCST>${n2(i.icmsStBase)}</vBCST><vICMSST>${n2(i.icmsStValue)}</vICMSST></ICMS10>`;
    return `<ICMS00><orig>0</orig><CST>${esc(i.cst)}</CST><modBC>3</modBC><vBC>${n2(i.icmsBase)}</vBC><pICMS>${n2(i.icmsRate)}</pICMS><vICMS>${n2(i.icmsValue)}</vICMS></ICMS00>`;
  };
  const dets = inv.items
    .map((i, idx) => {
      const difal = i.difalValue ? `<ICMSUFDest><vBCUFDest>${n2(i.icmsBase)}</vBCUFDest><vBCFCPUFDest>${n2(i.icmsBase)}</vBCFCPUFDest><pFCPUFDest>${n2((i.fcpValue / (i.icmsBase || 1)) * 100)}</pFCPUFDest><vFCPUFDest>${n2(i.fcpValue)}</vFCPUFDest><vICMSUFDest>${n2(i.difalValue)}</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet></ICMSUFDest>` : '';
      const ibscbs = i.cbsValue || i.ibsValue ? `<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>${n2(i.total)}</vBC><gIBSUF><pIBSUF>${n2(i.ibsRate)}</pIBSUF><vIBSUF>${n2(i.ibsValue)}</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.00</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>${n2(i.ibsValue)}</vIBS><gCBS><pCBS>${n2(i.cbsRate)}</pCBS><vCBS>${n2(i.cbsValue)}</vCBS></gCBS></gIBSCBS></IBSCBS>` : '';
      return `<det nItem="${idx + 1}"><prod><cProd>${esc(i.code)}</cProd><cEAN>SEM GTIN</cEAN><xProd>${esc(i.description)}</xProd><NCM>${esc(onlyDigits(i.ncm))}</NCM><CFOP>${esc(i.cfop)}</CFOP><uCom>${esc(i.unit)}</uCom><qCom>${i.quantity.toFixed(4)}</qCom><vUnCom>${i.unitPrice.toFixed(10)}</vUnCom><vProd>${n2(i.total)}</vProd><indTot>1</indTot></prod><imposto><ICMS>${icmsGroup(i)}</ICMS>${i.ipiValue ? `<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>${n2(i.total)}</vBC><pIPI>${n2(i.ipiRate)}</pIPI><vIPI>${n2(i.ipiValue)}</vIPI></IPITrib></IPI>` : ''}<PIS><PISAliq><CST>01</CST><vBC>${n2(i.total)}</vBC><pPIS>${n2(i.pisRate)}</pPIS><vPIS>${n2(i.pisValue)}</vPIS></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST><vBC>${n2(i.total)}</vBC><pCOFINS>${n2(i.cofinsRate)}</pCOFINS><vCOFINS>${n2(i.cofinsValue)}</vCOFINS></COFINSAliq></COFINS>${difal}${ibscbs}</imposto></det>`;
    })
    .join('');
  const doc = onlyDigits(inv.customerDoc);
  const dest = inv.customerDoc ? `<dest>${doc.length === 14 ? `<CNPJ>${doc}</CNPJ>` : `<CPF>${doc}</CPF>`}<xNome>${esc(inv.customerName)}</xNome><indIEDest>9</indIEDest></dest>` : '';
  const when = (inv.contingency ? inv.issueDate : inv.authorizedAt) || new Date();
  const nfref = inv.refAccessKey ? `<NFref><refNFe>${inv.refAccessKey}</refNFe></NFref>` : '';
  const inner = `<ide><cUF>${UF_CODES[company.uf]}</cUF><cNF>${inv.accessKey?.slice(35, 43)}</cNF><natOp>${esc(inv.natureName)}</natOp><mod>${mod}</mod><serie>${inv.series}</serie><nNF>${inv.number}</nNF><dhEmi>${when.toISOString()}</dhEmi><tpNF>${inv.direction === 'ENTRADA' ? 0 : 1}</tpNF><idDest>${inv.customerUf && inv.customerUf !== company.uf ? 2 : 1}</idDest><cMunFG>${esc(company.cityCode || '3550308')}</cMunFG><tpImp>${mod === 65 ? 4 : 1}</tpImp><tpEmis>${inv.contingency ? 9 : 1}</tpEmis><cDV>${inv.accessKey?.slice(-1)}</cDV><tpAmb>2</tpAmb><finNFe>${inv.finalidade || 1}</finNFe><indFinal>1</indFinal><indPres>${mod === 65 ? 1 : 2}</indPres><procEmi>0</procEmi><verProc>GestaoPro 2.0</verProc>${inv.contingency ? `<dhCont>${when.toISOString()}</dhCont><xJust>SEFAZ indisponivel - emissao em contingencia offline</xJust>` : ''}${nfref}</ide><emit><CNPJ>${onlyDigits(company.cnpj)}</CNPJ><xNome>${esc(company.name)}</xNome><xFant>${esc(company.tradeName)}</xFant><enderEmit><xLgr>${esc(company.street)}</xLgr><nro>${esc(company.number)}</nro><xBairro>${esc(company.district)}</xBairro><xMun>${esc(company.city)}</xMun><UF>${company.uf}</UF><CEP>${onlyDigits(company.zip)}</CEP></enderEmit><IE>${esc(onlyDigits(company.ie))}</IE><CRT>${company.crt}</CRT></emit>${dest}${dets}<total><ICMSTot><vBC>${n2(inv.icmsBase)}</vBC><vICMS>${n2(inv.icmsValue)}</vICMS><vFCPUFDest>${n2(inv.fcpValue)}</vFCPUFDest><vICMSUFDest>${n2(inv.difalValue)}</vICMSUFDest><vBCST>${n2(inv.icmsStBase)}</vBCST><vST>${n2(inv.icmsStValue)}</vST><vProd>${n2(inv.productsTotal)}</vProd><vFrete>${n2(inv.freight)}</vFrete><vDesc>${n2(inv.discount)}</vDesc><vIPI>${n2(inv.ipiValue)}</vIPI><vPIS>${n2(inv.pisValue)}</vPIS><vCOFINS>${n2(inv.cofinsValue)}</vCOFINS><vNF>${n2(inv.total)}</vNF><vTotTrib>${n2(inv.approxTaxes)}</vTotTrib></ICMSTot>${inv.cbsValue || inv.ibsValue ? `<IBSCBSTot><vBCIBSCBS>${n2(inv.productsTotal - inv.discount + inv.freight)}</vBCIBSCBS><gIBS><vIBS>${n2(inv.ibsValue)}</vIBS></gIBS><gCBS><vCBS>${n2(inv.cbsValue)}</vCBS></gCBS></IBSCBSTot>` : ''}</total><transp><modFrete>${inv.freight ? 0 : 9}</modFrete></transp><pag><detPag><tPag>${inv.finalidade === 4 ? '90' : '01'}</tPag><vPag>${n2(inv.finalidade === 4 ? 0 : inv.total)}</vPag></detPag></pag><infAdic><infCpl>${esc(inv.additionalInfo)}</infCpl></infAdic>`;
  const id = `NFe${inv.accessKey}`;
  // Forma canônica do infNFe (namespace herdado explícito) — base do digest da assinatura
  const canonical = `<infNFe xmlns="${NFE_NS}" Id="${id}" versao="4.00">${inner}</infNFe>`;
  let signature = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo></SignedInfo><SignatureValue>SIMULADO-SEM-CERTIFICADO</SignatureValue></Signature>`;
  let signed = false;
  if (company.certPfx && company.certPassword) {
    try {
      signature = signElement(canonical, id, Buffer.from(company.certPfx), company.certPassword);
      signed = true;
    } catch (e) {
      console.error('[assinatura]', (e as Error).message);
    }
  }
  const prot = inv.protocol
    ? `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SEFAZ-SIMULADA</verAplic><chNFe>${inv.accessKey}</chNFe><dhRecbto>${(inv.authorizedAt || new Date()).toISOString()}</dhRecbto><nProt>${inv.protocol}</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`
    : '';
  const nfe = `<NFe xmlns="${NFE_NS}"><infNFe Id="${id}" versao="4.00">${inner}</infNFe>${signature}</NFe>`;
  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n${prot ? `<nfeProc xmlns="${NFE_NS}" versao="4.00">${nfe}${prot}</nfeProc>` : nfe}`, signed };
}

/** Extrai a forma canônica do infNFe e a assinatura de um XML gerado (para conferência) */
export function extractSignedParts(xml: string) {
  const inf = xml.match(/<infNFe Id="([^"]+)" versao="4.00">([\s\S]*?)<\/infNFe>/);
  const sig = xml.match(/<Signature[\s\S]*?<\/Signature>/)?.[0];
  if (!inf || !sig) return null;
  return { canonical: `<infNFe xmlns="${NFE_NS}" Id="${inf[1]}" versao="4.00">${inf[2]}</infNFe>`, signature: sig };
}
