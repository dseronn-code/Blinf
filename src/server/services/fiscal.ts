/**
 * Módulo fiscal: NF-e (55), NFC-e (65) e NFS-e.
 * - Cálculo de ICMS (próprio, ST, DIFAL e FCP), IPI, PIS, COFINS, ISS e
 *   IBS/CBS da reforma tributária (alíquotas de teste 2026, informativas)
 * - CFOP por natureza de operação (intra/interestadual), CSOSN/CST
 * - Chave de acesso real (mod 11), XML no leiaute 4.00 com assinatura XMLDSig
 *   (certificado A1 instalado) e QR Code v2 da NFC-e
 * - Quem autoriza depende de Company.fiscalProvider (como no Bling):
 *   SIMULADO  → "SEFAZ" simulada (validações com códigos reais, protocolo fictício) —
 *               SÓ no modo demonstração; em produção a emissão é bloqueada (requireRealFiscal)
 *   SEFAZ     → webservices oficiais com o certificado A1 (homologação ou produção)
 *   FOCUS_NFE → API da Focus NFe (conta conectada em Integrações)
 * - Contingência: NFC-e offline (tpEmis 9) e SVC-AN/SVC-RS para NF-e (tpEmis 6/7)
 *   quando a SEFAZ da UF responde 108/109.
 */
import type { Db } from '@/lib/db';
import { prisma } from '@/lib/db';
import { round2, onlyDigits, randomDigits } from '@/lib/utils';
import { buildAccessKey, ICMS_INTERNAL, interstateIcmsRate, isValidCNPJ, isValidCPF, isValidAccessKey, UF_CODES, FCP_RATE, CBS_RATE, IBS_RATE } from '@/lib/br';
import { fail } from '../errors';
import { isDemoMode, requireRealOrDemo } from '@/lib/demo';
import { notify } from './notify';
import { nextNumber } from '../sequence';
import { emit } from '../events';
import { signElement } from './cert';
import { IntegrationError } from '@/server/integrations/http';
import { getAccount } from '@/server/integrations/accounts';
import { focusEmit, focusGet, focusCancel, focusCce, focusInutilizar, focusDownload, focusNfePayload, focusNfsePayload, type FocusResult } from '@/server/integrations/providers/focusnfe';
import { sefazCtx, autorizar, consultarRecibo, consultarProtocolo, enviarEvento, authorizerOfKey, inutilizar, statusServico, buildNfeProc, detCancelamento, detCCe, type AuthResult } from './sefaz/nfe';
import { svcFor, authorizerFor } from './sefaz/urls';
import { nfceQrCode, nfceUrlChave } from './sefaz/qrcode';
import { resolveCityCode, localCityCode } from './sefaz/ibge';
import { dhUF, txt, tag, stripDecl, block } from './sefaz/xml';
import type { Company, Contact, Invoice, InvoiceItem, OperationNature } from '@prisma/client';

export type InvoiceModel = 'NFE' | 'NFCE' | 'NFSE';
export type FiscalProvider = 'SIMULADO' | 'SEFAZ' | 'FOCUS_NFE';
export const fiscalProviderOf = (c: Pick<Company, 'fiscalProvider'>): FiscalProvider => (['SEFAZ', 'FOCUS_NFE'].includes(c.fiscalProvider) ? (c.fiscalProvider as FiscalProvider) : 'SIMULADO');

/** Onde configurar a emissão real (mensagem exibida quando a emissão é bloqueada em produção) */
export const FISCAL_HOWTO = 'Em Notas fiscais → Certificado, instale o certificado A1 e escolha SEFAZ direta (ou conecte a Focus NFe em Integrações → Contas e credenciais).';
/** Em produção, sem SEFAZ/Focus não existe emissão: a "SEFAZ simulada" só roda no modo demonstração */
export const fiscalSimulationBlocked = (c: Pick<Company, 'fiscalProvider'>) => fiscalProviderOf(c) === 'SIMULADO' && !isDemoMode();
export function requireRealFiscal(c: Pick<Company, 'fiscalProvider'>, feature = 'Emissão de nota fiscal') {
  if (fiscalProviderOf(c) === 'SIMULADO') requireRealOrDemo(feature, FISCAL_HOWTO);
}

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

/** Ambiente efetivo da empresa: a simulação é sempre homologação */
export const environmentOf = (c: Pick<Company, 'fiscalProvider' | 'nfeEnvironment'>): 1 | 2 => (fiscalProviderOf(c) !== 'SIMULADO' && c.nfeEnvironment === 1 ? 1 : 2);

/** Monta a nota (status RASCUNHO) com itens e impostos calculados */
export async function buildInvoice(db: Db, input: BuildInvoiceInput) {
  const company = await db.company.findUnique({ where: { id: input.companyId } });
  if (!company) fail(404, 'Empresa não encontrada');
  const c = company!;
  // Produção sem provedor fiscal: não cria rascunho (nem consome numeração) para uma nota que não pode ser emitida
  if (fiscalSimulationBlocked(c)) {
    const order = input.salesOrderId ? await db.salesOrder.findUnique({ where: { id: input.salesOrderId }, select: { number: true, origin: true } }) : null;
    if (order && ['PDV', 'INTEGRACAO'].includes(order.origin)) {
      await notify(c.id, 'Venda sem nota fiscal', `Pedido nº ${order.number}: a ${input.model === 'NFCE' ? 'NFC-e' : input.model === 'NFSE' ? 'NFS-e' : 'NF-e'} não foi emitida porque não há emissor fiscal configurado. ${FISCAL_HOWTO}`, { level: 'warning', link: '/fiscal/certificado' }).catch(() => {});
    }
    requireRealFiscal(c);
  }
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
  const environment = environmentOf(c);
  const simulated = fiscalProviderOf(c) === 'SIMULADO';

  const info = [
    input.additionalInfo,
    nature.finalidade === 4 && input.refAccessKey ? `Devolução referente à NF-e chave ${input.refAccessKey}.` : null,
    c.crt === 1 ? 'DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL. NÃO GERA DIREITO A CRÉDITO FISCAL DE IPI.' : null,
    difalValue ? `DIFAL (EC 87/2015) para ${destUf}: R$ ${difalValue.toFixed(2).replace('.', ',')}${fcpValue ? ` + FCP R$ ${fcpValue.toFixed(2).replace('.', ',')}` : ''}.` : null,
    cbsValue || ibsValue ? `IBS/CBS (LC 214/2025, teste 2026): CBS R$ ${cbsValue.toFixed(2).replace('.', ',')} / IBS R$ ${ibsValue.toFixed(2).replace('.', ',')}.` : null,
    `Val. aprox. tributos R$ ${approxTaxes.toFixed(2).replace('.', ',')} Fonte: IBPT${simulated ? ' (simulado)' : ''}.`,
    simulated ? 'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO / SIMULAÇÃO - SEM VALOR FISCAL' : environment === 2 ? 'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL' : null,
  ].filter(Boolean).join(' ');

  return db.invoice.create({
    data: {
      companyId: c.id,
      model: input.model,
      environment,
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

/** Validações equivalentes às regras de negócio da SEFAZ (subconjunto) — também usadas como pré-validação no modo real */
async function sefazValidate(db: Db, inv: Invoice & { items: InvoiceItem[] }, company: Company): Promise<{ code: string; reason: string } | null> {
  const provider = fiscalProviderOf(company);
  if (provider !== 'FOCUS_NFE') {
    if (!company.certValidUntil) return { code: '280', reason: 'Rejeição: Certificado Transmissor inválido (nenhum certificado digital A1 instalado)' };
    if (company.certValidUntil < new Date()) return { code: '284', reason: 'Rejeição: Certificado Transmissor vencido' };
  }
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
    if (provider === 'SEFAZ' && !customer.street) return { code: '228', reason: 'Rejeição: Endereço do destinatário incompleto (logradouro)' };
  }
  if (inv.model === 'NFCE' && inv.total > 200000) return { code: '702', reason: 'Rejeição: NFC-e com valor superior ao permitido' };
  if (inv.model !== 'NFSE') {
    const noNcm = inv.items.find((i) => !i.ncm || onlyDigits(i.ncm).length !== 8);
    if (noNcm) return { code: '778', reason: `Rejeição: Informado NCM inexistente (item ${noNcm.code})` };
  }
  if (provider === 'SEFAZ') {
    if (inv.model !== 'NFSE' && !onlyDigits(company.cityCode)) return { code: '272', reason: 'Rejeição: Código do município do emitente não informado (cadastre o código IBGE em Configurações → Empresas)' };
    if (inv.model === 'NFCE' && !company.cscToken) return { code: '464', reason: 'Rejeição: CSC (token da NFC-e) não informado — cadastre o ID e o CSC na tela do certificado' };
  }
  return null;
}

type FullInvoice = Invoice & { items: InvoiceItem[] };
export const reload = (invoiceId: string) => prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, events: true } });

/**
 * Transmite a nota. Gera chave, assina o XML (certificado real, se instalado),
 * valida e autoriza pelo provedor fiscal da empresa (simulado, SEFAZ direta ou
 * Focus NFe). Em modo CONTINGENCIA, NFC-e é emitida offline (tpEmis 9) e
 * regularizada depois. Notas com ST/DIFAL interestadual geram GNRE.
 */
export async function transmitInvoice(companyId: string, orgId: string, invoiceId: string, userName?: string) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId }, include: { items: true } });
  if (!inv) fail(404, 'Nota fiscal não encontrada');
  const invoice = inv!;
  if (invoice.status === 'AUTORIZADA') fail(400, 'Nota já autorizada');
  if (invoice.status === 'CANCELADA') fail(400, 'Nota cancelada');
  if (invoice.status === 'DENEGADA') fail(400, 'Nota com uso denegado não pode ser retransmitida');
  const company = (await prisma.company.findUnique({ where: { id: companyId } }))!;
  const provider = fiscalProviderOf(company);
  let result;
  if (provider === 'SEFAZ') result = await transmitSefaz(company, invoice, orgId, userName);
  else if (provider === 'FOCUS_NFE') result = await transmitFocus(company, invoice, orgId, userName);
  else {
    requireRealFiscal(company);
    result = await transmitSimulated(company, invoice, orgId, userName);
  }
  if (result?.status === 'AUTORIZADA') await afterAuthorized(companyId, orgId, invoiceId);
  return result;
}

/** GNRE automática (ST/DIFAL/FCP interestadual) — nunca derruba a autorização */
async function afterAuthorized(companyId: string, orgId: string, invoiceId: string) {
  try {
    const { autoGnreForInvoice } = await import('./gnre');
    await autoGnreForInvoice(companyId, orgId, invoiceId);
  } catch (e) {
    await prisma.invoiceEvent.create({ data: { invoiceId, type: 'GNRE', description: `Falha ao gerar a GNRE: ${(e as Error).message}` } }).catch(() => {});
  }
}

/** Dados auxiliares para o XML: destinatário, município, produtos, forma de pagamento */
async function xmlContext(company: Company, invoice: Invoice, online: boolean) {
  const customer = invoice.customerId ? await prisma.contact.findUnique({ where: { id: invoice.customerId } }) : null;
  const sameCity = customer?.city && company.city && customer.uf === company.uf && customer.city.trim().toUpperCase() === company.city.trim().toUpperCase();
  const destCityCode = customer?.city ? (sameCity ? company.cityCode : await resolveCityCode(customer.uf, customer.city, { companyId: company.id, online })) : null;
  const items = await prisma.invoiceItem.findMany({ where: { invoiceId: invoice.id, productId: { not: null } }, select: { productId: true } });
  const prods = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId!) } }, select: { id: true, origin: true, gtin: true, cest: true } });
  const products = Object.fromEntries(prods.map((p) => [p.id, { origin: p.origin, gtin: p.gtin, cest: p.cest }]));
  const order = invoice.salesOrderId ? await prisma.salesOrder.findUnique({ where: { id: invoice.salesOrderId }, select: { paymentMethod: true } }) : null;
  const nature = invoice.natureId ? await prisma.operationNature.findUnique({ where: { id: invoice.natureId }, select: { kind: true } }) : null;
  return { customer, destCityCode, products, paymentMethod: order?.paymentMethod || null, natureKind: nature?.kind };
}

async function transmitSimulated(company: Company, invoice: FullInvoice, orgId: string, userName?: string) {
  const companyId = company.id;
  const invoiceId = invoice.id;
  const offline = company.sefazMode === 'CONTINGENCIA' && invoice.model === 'NFCE' && invoice.status !== 'CONTINGENCIA';
  await prisma.invoiceEvent.create({ data: { invoiceId, type: 'TRANSMISSAO', description: offline ? 'SEFAZ indisponível — emissão em contingência offline (tpEmis 9)' : `Lote enviado à ${invoice.model === 'NFSE' ? 'prefeitura' : 'SEFAZ-' + company.uf} (homologação simulada)` } });

  const rejection = await sefazValidate(prisma, invoice, company);
  if (rejection) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'REJEITADA', rejectionCode: rejection.code, rejectionReason: rejection.reason } });
    await prisma.invoiceEvent.create({ data: { invoiceId, type: 'REJEICAO', code: rejection.code, description: `${rejection.code} - ${rejection.reason}` } });
    return reload(invoiceId);
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
  const ctx = invoice.model === 'NFSE' ? null : await xmlContext(company, invoice, false);
  const contingency = offline || invoice.contingency;
  const { xml, signed } = buildXml({ ...invoice, accessKey, protocol, authorizedAt: now, contingency }, company, { ...ctx, tpEmis: contingency ? 9 : 1, dhEmi: contingency ? invoice.issueDate : now });
  if (offline) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'CONTINGENCIA', contingency: true, accessKey, issueDate: now, xml, signed, rejectionCode: null, rejectionReason: null } });
    await prisma.invoiceEvent.create({ data: { invoiceId, type: 'CONTINGENCIA', description: 'NFC-e emitida em contingência offline — transmitir em até 24h' } });
    // Para efeitos operacionais (estoque/financeiro) a venda segue normalmente
    await emit('invoice.authorized', { companyId, orgId, invoiceId, salesOrderId: invoice.salesOrderId, serviceOrderId: invoice.serviceOrderId, model: invoice.model, userName });
    return reload(invoiceId);
  }
  const wasContingency = invoice.status === 'CONTINGENCIA';
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: 'AUTORIZADA', accessKey, protocol, verificationCode, authorizedAt: now, ...(wasContingency ? {} : { issueDate: now }), xml, signed, rejectionCode: null, rejectionReason: null },
  });
  await prisma.invoiceEvent.create({ data: { invoiceId, type: 'AUTORIZACAO', code: '100', protocol, description: `100 - Autorizado o uso da ${invoice.model === 'NFSE' ? 'NFS-e' : 'NF-e'}${signed ? ' (XML assinado com certificado A1)' : ''}` } });
  if (!wasContingency) await emit('invoice.authorized', { companyId, orgId, invoiceId, salesOrderId: invoice.salesOrderId, serviceOrderId: invoice.serviceOrderId, model: invoice.model, userName });
  return reload(invoiceId);
}

// ---------------------------------------------------------------------------
// SEFAZ direta (webservices oficiais)
// ---------------------------------------------------------------------------
const reuseKey = (key: string | null, date: Date, tpEmis: number) => {
  if (!key || key.length !== 44) return null;
  const aamm = `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, '0')}`;
  return key.slice(2, 6) === aamm && key[34] === String(tpEmis) ? key.slice(35, 43) : null;
};

/** Grava a rejeição local (antes do envio) */
export async function rejectLocal(invoiceId: string, code: string, reason: string, extra: Partial<Invoice> = {}) {
  await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'REJEITADA', rejectionCode: code, rejectionReason: reason, ...extra } });
  await prisma.invoiceEvent.create({ data: { invoiceId, type: 'REJEICAO', code, description: `${code} - ${reason}` } });
  return reload(invoiceId);
}

async function transmitSefaz(company: Company, invoice: FullInvoice, orgId: string, userName?: string) {
  const invoiceId = invoice.id;
  if (invoice.model === 'NFSE') {
    const { transmitNfseNacional } = await import('./nfse');
    return transmitNfseNacional(company, invoice, orgId, userName);
  }
  const model = invoice.model === 'NFCE' ? 65 : 55;
  const ctx = sefazCtx(company);

  // Lote pendente: consulta primeiro no mesmo autorizador do envio (SVC quando tpEmis 6/7) — recibo ou, sem recibo, protocolo pela chave
  if (invoice.status === 'PROCESSANDO' && (invoice.receipt || invoice.accessKey)) {
    const nfe = block(invoice.xml, 'NFe') || '';
    const r = await consultPending(ctx, model, invoice);
    if (r) return applySefazResult(company, invoice, r, nfe, { orgId, userName });
  }

  const rejection = await sefazValidate(prisma, invoice, company);
  if (rejection) return rejectLocal(invoiceId, rejection.code, rejection.reason);

  const offline = company.sefazMode === 'CONTINGENCIA' && model === 65 && invoice.status !== 'CONTINGENCIA';
  const now = new Date();
  let nfe: string;
  let tpEmis = 1;
  let signed = true;
  const extras = await xmlContext(company, invoice, true);
  if (model === 55 && !extras.destCityCode) return rejectLocal(invoiceId, '230', 'Rejeição: Código do município do destinatário não localizado (confira cidade/UF do cliente)');
  const resend = (invoice.status === 'CONTINGENCIA' || invoice.rejectionCode === 'COMUNICACAO') && invoice.xml && invoice.accessKey;
  if (resend) {
    // Mesmo XML já assinado (contingência offline impressa ou falha de comunicação)
    nfe = block(invoice.xml, 'NFe')!;
    tpEmis = Number(invoice.accessKey![34]) || 1;
  } else {
    tpEmis = offline ? 9 : 1;
    const code = reuseKey(invoice.accessKey, now, tpEmis) || randomDigits(8);
    const accessKey = buildAccessKey({ uf: company.uf, date: now, cnpj: company.cnpj, model, series: invoice.series, number: invoice.number, tpEmis, code });
    const built = buildXml({ ...invoice, accessKey, protocol: null, authorizedAt: null, contingency: offline }, company, { ...extras, tpAmb: ctx.tpAmb, tpEmis, dhEmi: now, noProt: true });
    if (!built.signed) return rejectLocal(invoiceId, '280', 'Rejeição: não foi possível assinar o XML com o certificado instalado (senha ou arquivo inválido)');
    nfe = built.nfe;
    signed = built.signed;
    await prisma.invoice.update({ where: { id: invoiceId }, data: { accessKey, xml: built.xml, signed, environment: ctx.tpAmb, contingency: offline, ...(offline ? {} : { issueDate: now }) } });
    invoice = { ...invoice, accessKey, xml: built.xml, signed, environment: ctx.tpAmb, contingency: offline };
  }
  if (offline) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'CONTINGENCIA', contingency: true, issueDate: now, rejectionCode: null, rejectionReason: null } });
    await prisma.invoiceEvent.create({ data: { invoiceId, type: 'CONTINGENCIA', description: 'NFC-e emitida em contingência offline (tpEmis 9) — transmitir em até 24h' } });
    await emit('invoice.authorized', { companyId: company.id, orgId, invoiceId, salesOrderId: invoice.salesOrderId, serviceOrderId: invoice.serviceOrderId, model: invoice.model, userName });
    return reload(invoiceId);
  }

  const authorizer = tpEmis === 6 || tpEmis === 7 ? svcFor(company.uf).authorizer : undefined;
  await prisma.invoiceEvent.create({ data: { invoiceId, type: 'TRANSMISSAO', description: `Lote enviado à SEFAZ (${authorizer || authorizerFor(company.uf, model)}) — ${ctx.tpAmb === 1 ? 'produção' : 'homologação'}` } });
  let r: AuthResult;
  try {
    r = await autorizar(ctx, model, nfe, { authorizer });
  } catch (e) {
    // Falha de comunicação: se a SEFAZ da UF estiver fora (108/109), NF-e segue pela SVC
    if (model === 55 && tpEmis === 1) {
      const st = await statusServico(ctx, 55).catch(() => null);
      if (st && ['108', '109'].includes(st.cStat)) return transmitSvc(company, invoice, extras, orgId, userName, `${st.cStat} - ${st.xMotivo}`);
    }
    const msg = e instanceof IntegrationError ? e.message : (e as Error).message;
    return rejectLocal(invoiceId, 'COMUNICACAO', `Falha de comunicação com a SEFAZ: ${msg}. Transmita novamente (o mesmo XML será reenviado).`);
  }
  if (model === 55 && tpEmis === 1 && ['108', '109'].includes(r.cStat)) return transmitSvc(company, invoice, extras, orgId, userName, `${r.cStat} - ${r.xMotivo}`);
  // Duplicidade: a nota pode ter sido autorizada num envio anterior sem retorno
  if (['204', '539'].includes(r.cStat) && invoice.accessKey) {
    const q = await consultarProtocolo(ctx, model, invoice.accessKey).catch(() => null);
    const digest = nfe.match(/<DigestValue>([^<]+)</)?.[1];
    if (q?.prot?.status === 'AUTORIZADA' && q.protXml && (!digest || q.protXml.includes(digest))) r = q.prot;
  }
  return applySefazResult(company, invoice, r, nfe, { orgId, userName, signed });
}

/** Consulta uma NF-e em processamento no autorizador em que foi enviada; null = não consta lá (pode reenviar) */
async function consultPending(ctx: ReturnType<typeof sefazCtx>, model: 55 | 65, inv: { receipt: string | null; accessKey: string | null }): Promise<AuthResult | null> {
  const authorizer = model === 55 ? authorizerOfKey(inv.accessKey) : undefined;
  if (inv.receipt) {
    const r = await consultarRecibo(ctx, model, inv.receipt, authorizer);
    // 106 = lote não localizado (recibo expirado): segue para a consulta pela chave
    if (r.status !== 'REJEITADA' || r.cStat !== '106' || !inv.accessKey) return r;
  }
  if (!inv.accessKey) return null;
  const q = await consultarProtocolo(ctx, model, inv.accessKey, authorizer);
  if (q.prot) return q.prot;
  // 217 = NF-e não consta na base do autorizador
  return q.cStat === '217' ? null : { status: 'PROCESSANDO', cStat: q.cStat, xMotivo: q.xMotivo };
}

/** Contingência SVC-AN/SVC-RS (tpEmis 6/7): nova chave, dhCont/xJust e envio ao servidor virtual */
async function transmitSvc(company: Company, invoice: FullInvoice, extras: Awaited<ReturnType<typeof xmlContext>>, orgId: string, userName: string | undefined, why: string) {
  const ctx = sefazCtx(company);
  const svc = svcFor(company.uf);
  const now = new Date();
  const accessKey = buildAccessKey({ uf: company.uf, date: now, cnpj: company.cnpj, model: 55, series: invoice.series, number: invoice.number, tpEmis: svc.tpEmis });
  const built = buildXml({ ...invoice, accessKey, protocol: null, authorizedAt: null, contingency: true }, company, { ...extras, tpAmb: ctx.tpAmb, tpEmis: svc.tpEmis, dhEmi: now, dhCont: now, xJust: `SEFAZ da UF indisponivel (${why}) - emissao em contingencia ${svc.authorizer}`, noProt: true });
  await prisma.invoice.update({ where: { id: invoice.id }, data: { accessKey, xml: built.xml, contingency: true, issueDate: now } });
  await prisma.invoiceEvent.create({ data: { invoiceId: invoice.id, type: 'CONTINGENCIA', description: `SEFAZ-${company.uf} indisponível (${why}) — enviada à ${svc.authorizer} (tpEmis ${svc.tpEmis})` } });
  let r: AuthResult;
  try {
    r = await autorizar(ctx, 55, built.nfe, { authorizer: svc.authorizer });
  } catch (e) {
    return rejectLocal(invoice.id, 'COMUNICACAO', `Falha de comunicação com a ${svc.authorizer}: ${(e as Error).message}`);
  }
  return applySefazResult(company, { ...invoice, accessKey, contingency: true }, r, built.nfe, { orgId, userName, signed: built.signed });
}

/** Aplica o retorno da SEFAZ na nota (autorizada, denegada, rejeitada ou em processamento) */
async function applySefazResult(company: Company, invoice: Invoice, r: AuthResult, nfe: string, o: { orgId: string; userName?: string; signed?: boolean; async?: boolean }) {
  const invoiceId = invoice.id;
  const desc = `${r.cStat} - ${r.xMotivo}`;
  if (r.status === 'AUTORIZADA' || r.status === 'DENEGADA') {
    const proc = buildNfeProc(nfe, r.protXml!);
    const at = r.dhRecbto ? new Date(r.dhRecbto) : new Date();
    if (r.status === 'DENEGADA') {
      await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'DENEGADA', protocol: r.nProt, authorizedAt: at, xml: proc, procXml: proc, receipt: null, rejectionCode: r.cStat, rejectionReason: r.xMotivo } });
      await prisma.invoiceEvent.create({ data: { invoiceId, type: 'DENEGACAO', code: r.cStat, protocol: r.nProt, description: `${desc} (numeração consumida; a nota não pode ser reutilizada)` } });
      return reload(invoiceId);
    }
    return finishAuthorization(company.id, o.orgId, invoice, { protocol: r.nProt || null, authorizedAt: at, xml: proc, procXml: proc, cStat: r.cStat, description: desc + (o.signed !== false ? ' (XML assinado com certificado A1)' : ''), userName: o.userName, async: o.async });
  }
  if (r.status === 'PROCESSANDO') {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'PROCESSANDO', receipt: r.nRec || invoice.receipt } });
    await prisma.invoiceEvent.create({ data: { invoiceId, type: 'TRANSMISSAO', code: r.cStat, description: `${desc} — recibo ${r.nRec || invoice.receipt}. Consulte novamente em instantes (Transmitir).` } });
    return reload(invoiceId);
  }
  return rejectLocal(invoiceId, r.cStat, r.xMotivo, { receipt: null });
}

/** Conclui a autorização (comum a SEFAZ e Focus; também para retornos assíncronos) */
export async function finishAuthorization(companyId: string, orgId: string, invoice: Invoice, d: { protocol: string | null; authorizedAt: Date; xml?: string | null; procXml?: string | null; cStat: string; description: string; userName?: string; async?: boolean; accessKey?: string | null; verificationCode?: string | null; providerRef?: string | null }) {
  const invoiceId = invoice.id;
  const wasContingency = invoice.status === 'CONTINGENCIA';
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: 'AUTORIZADA', protocol: d.protocol, authorizedAt: d.authorizedAt, receipt: null, rejectionCode: null, rejectionReason: null,
      ...(d.xml ? { xml: d.xml } : {}), ...(d.procXml ? { procXml: d.procXml } : {}), ...(d.accessKey ? { accessKey: d.accessKey } : {}),
      ...(d.verificationCode ? { verificationCode: d.verificationCode } : {}), ...(d.providerRef ? { providerRef: d.providerRef } : {}),
    },
  });
  await prisma.invoiceEvent.create({ data: { invoiceId, type: 'AUTORIZACAO', code: d.cStat, protocol: d.protocol, description: d.description } });
  if (!wasContingency) await emit('invoice.authorized', { companyId, orgId, invoiceId, salesOrderId: invoice.salesOrderId, serviceOrderId: invoice.serviceOrderId, model: invoice.model, userName: d.userName });
  // Retorno assíncrono (recibo/gatilho): conclui o faturamento do pedido que ficou aguardando
  if (d.async && invoice.salesOrderId) {
    const o = await prisma.salesOrder.findUnique({ where: { id: invoice.salesOrderId } });
    if (o?.status === 'ABERTO') {
      await prisma.salesOrder.update({ where: { id: o.id }, data: { status: 'FATURADO', invoiceId, invoicedAt: new Date() } });
      await emit('order.invoiced', { companyId, orgId, orderId: o.id, invoiceId, userName: d.userName });
    }
    await afterAuthorized(companyId, orgId, invoiceId);
  }
  return reload(invoiceId);
}

// ---------------------------------------------------------------------------
// Focus NFe
// ---------------------------------------------------------------------------
async function focusAccount(companyId: string) {
  const acc = await getAccount(companyId, 'FOCUS_NFE');
  if (!acc) fail(400, 'Conecte a conta Focus NFe em Integrações → Contas e credenciais (ou troque o modo de emissão na tela do certificado)');
  return acc!;
}
const focusModel = (inv: Pick<Invoice, 'model'>, acc: { settings: Record<string, any> }) => (inv.model === 'NFSE' && acc.settings.nfseNacional ? 'NFSEN' : inv.model);

async function transmitFocus(company: Company, invoice: FullInvoice, orgId: string, userName?: string) {
  const acc = await focusAccount(company.id);
  const ref = invoice.providerRef || invoice.id;
  const model = focusModel(invoice, acc);
  let r: FocusResult;
  if (invoice.status === 'PROCESSANDO') r = await focusGet(acc, model, ref);
  else {
    const rejection = await sefazValidate(prisma, invoice, company);
    if (rejection) return rejectLocal(invoice.id, rejection.code, rejection.reason);
    const extras = await xmlContext(company, invoice, true);
    const payload = invoice.model === 'NFSE'
      ? focusNfsePayload(invoice, company, extras.customer, { nacional: model === 'NFSEN', serviceCode: (await serviceCodeOf(invoice)) || null, cityCode: company.cityCode, customerCityCode: extras.destCityCode })
      : focusNfePayload(invoice, company, extras.customer, { products: extras.products, paymentMethod: extras.paymentMethod });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { providerRef: ref, environment: acc.environment === 'PRODUCAO' ? 1 : 2 } });
    await prisma.invoiceEvent.create({ data: { invoiceId: invoice.id, type: 'TRANSMISSAO', description: `Enviada à Focus NFe (${acc.environment === 'PRODUCAO' ? 'produção' : 'homologação'}) — ref ${ref}` } });
    r = await focusEmit(acc, model, ref, payload);
    // NF-e/NFS-e são assíncronas: algumas consultas rápidas antes de aguardar o gatilho
    for (let i = 0; r.status === 'PROCESSANDO' && i < 3; i++) {
      await new Promise((ok) => setTimeout(ok, Number(process.env.FOCUS_POLL_MS ?? 1500)));
      r = await focusGet(acc, model, ref);
    }
  }
  return applyFocusResult(company, { ...invoice, providerRef: ref }, r, { orgId, userName });
}

async function serviceCodeOf(invoice: FullInvoice) {
  const sid = invoice.items.find((i) => i.serviceId)?.serviceId;
  return sid ? (await prisma.service.findUnique({ where: { id: sid }, select: { serviceCode: true } }))?.serviceCode : null;
}

async function applyFocusResult(company: Company, invoice: Invoice, r: FocusResult, o: { orgId: string; userName?: string; async?: boolean }) {
  const invoiceId = invoice.id;
  if (r.status === 'AUTORIZADA') {
    if (invoice.status === 'AUTORIZADA') return reload(invoiceId);
    const acc = await focusAccount(company.id);
    const xml = r.xmlPath ? await focusDownload(acc, r.xmlPath).catch(() => null) : null;
    return finishAuthorization(company.id, o.orgId, invoice, {
      protocol: r.protocol || tag(xml, 'nProt') || null, authorizedAt: new Date(), xml, procXml: xml, cStat: r.cStat || '100',
      description: `${r.cStat || '100'} - ${r.xMotivo || 'Autorizado o uso'} (via Focus NFe)`, userName: o.userName, async: o.async,
      accessKey: r.accessKey && invoice.model !== 'NFSE' ? r.accessKey : null, verificationCode: invoice.model === 'NFSE' ? r.verificationCode || r.accessKey || null : null, providerRef: invoice.providerRef,
    });
  }
  if (r.status === 'PROCESSANDO') {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'PROCESSANDO' } });
    await prisma.invoiceEvent.create({ data: { invoiceId, type: 'TRANSMISSAO', description: 'Em processamento na Focus NFe — o retorno chega automaticamente pelo gatilho' } });
    return reload(invoiceId);
  }
  if (r.status === 'CANCELADA') {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELADA', cancelledAt: new Date() } });
    return reload(invoiceId);
  }
  if (r.status === 'DENEGADA') {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'DENEGADA', rejectionCode: r.cStat, rejectionReason: r.xMotivo } });
    await prisma.invoiceEvent.create({ data: { invoiceId, type: 'DENEGACAO', code: r.cStat, description: `${r.cStat} - ${r.xMotivo}` } });
    return reload(invoiceId);
  }
  return rejectLocal(invoiceId, r.cStat || 'FOCUS', r.xMotivo);
}

/** Gatilho (webhook) da Focus: atualiza a nota/MDF-e pelo ref */
export async function applyProviderUpdate(companyId: string, ref: string, body: any) {
  if (ref.startsWith('mdfe_')) {
    const { applyMdfeProviderUpdate } = await import('./mdfe');
    return applyMdfeProviderUpdate(companyId, ref.slice(5), body);
  }
  const inv = await prisma.invoice.findFirst({ where: { companyId, OR: [{ providerRef: ref }, { id: ref }] } });
  if (!inv) return `Nota ${ref} não encontrada`;
  const company = (await prisma.company.findUnique({ where: { id: companyId } }))!;
  const org = company.organizationId;
  const { parseFocus } = await import('@/server/integrations/providers/focusnfe');
  const r = parseFocus(body);
  if (r.status === 'CANCELADA' && inv.status === 'AUTORIZADA') {
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'CANCELADA', cancelledAt: new Date() } });
    await emit('invoice.cancelled', { companyId, orgId: org, invoiceId: inv.id, salesOrderId: inv.salesOrderId });
    return 'Nota cancelada';
  }
  if (inv.status !== 'PROCESSANDO') return `Nota já está ${inv.status}`;
  await applyFocusResult(company, inv, r, { orgId: org, async: true });
  return `Nota ${inv.number}: ${r.status}`;
}

/** Consulta documentos em processamento (recibos SEFAZ e Focus) — chamado pela sincronização periódica */
export async function refreshPendingProvider(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return 0;
  const pending = await prisma.invoice.findMany({ where: { companyId, status: 'PROCESSANDO' }, include: { items: true }, take: 20 });
  let n = 0;
  for (const inv of pending) {
    try {
      if (fiscalProviderOf(company) === 'FOCUS_NFE') {
        const acc = await focusAccount(companyId);
        const r = await focusGet(acc, focusModel(inv, acc), inv.providerRef || inv.id);
        if (r.status !== 'PROCESSANDO') { await applyFocusResult(company, inv, r, { orgId: company.organizationId, async: true }); n++; }
      } else if (fiscalProviderOf(company) === 'SEFAZ' && (inv.receipt || inv.accessKey) && inv.model !== 'NFSE') {
        const r = await consultPending(sefazCtx(company), inv.model === 'NFCE' ? 65 : 55, inv);
        if (r && r.status !== 'PROCESSANDO') { await applySefazResult(company, inv, r, block(inv.xml, 'NFe') || '', { orgId: company.organizationId, async: true }); n++; }
      }
    } catch {
      /* tenta na próxima rodada */
    }
  }
  try {
    const { refreshPendingMdfe } = await import('./mdfe');
    n += await refreshPendingMdfe(companyId);
  } catch {
    /* sem MDF-e pendente */
  }
  return n;
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
  const company = (await prisma.company.findUnique({ where: { id: companyId } }))!;
  // O cancelamento segue o caminho por onde a nota foi autorizada
  const via = inv!.providerRef ? 'FOCUS_NFE' : inv!.procXml ? 'SEFAZ' : 'SIMULADO';
  let protocol: string;
  let code = '135';
  let detail = 'Evento registrado e vinculado a NF-e';
  if (via === 'SIMULADO' && !isDemoMode()) {
    // Nota gerada pela simulação (sem valor fiscal): só é descartada no sistema — não há protocolo da SEFAZ
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELADA', cancelReason: reason, cancelProtocol: null, cancelledAt: new Date() } });
    await prisma.invoiceEvent.create({ data: { invoiceId, type: 'CANCELAMENTO', description: `Nota sem valor fiscal (emitida em simulação) cancelada apenas no sistema, sem evento na SEFAZ. Justificativa: ${reason}` } });
    await emit('invoice.cancelled', { companyId, orgId, invoiceId, salesOrderId: inv!.salesOrderId, userName });
    return;
  }
  if (via === 'SIMULADO') {
    const hours = (Date.now() - (inv!.authorizedAt?.getTime() || 0)) / 3600000;
    const limit = inv!.model === 'NFCE' ? 0.5 : inv!.model === 'NFSE' ? 24 * 30 : 24;
    if (hours > limit) {
      await prisma.invoiceEvent.create({ data: { invoiceId, type: 'REJEICAO', code: '501', description: '501 - Rejeição: Prazo de cancelamento superior ao previsto na legislação' } });
      fail(400, `Rejeição 501: Prazo de cancelamento superior ao previsto (${inv!.model === 'NFCE' ? '30 minutos' : '24 horas'}). Emita uma nota de devolução.`);
    }
    protocol = `1${randomDigits(14)}`;
  } else if (via === 'FOCUS_NFE') {
    const acc = await focusAccount(companyId);
    const r = await focusCancel(acc, focusModel(inv!, acc), inv!.providerRef!, reason.trim());
    if (!r.ok) {
      await prisma.invoiceEvent.create({ data: { invoiceId, type: 'REJEICAO', code: r.cStat || null, description: `Cancelamento rejeitado: ${r.xMotivo}` } });
      fail(400, `Cancelamento rejeitado: ${r.xMotivo}`);
    }
    protocol = r.protocol || '';
    code = r.cStat || '135';
    detail = r.xMotivo;
  } else if (inv!.model === 'NFSE') {
    const { cancelNfseNacional } = await import('./nfse');
    const r = await cancelNfseNacional(company, inv!, reason.trim());
    protocol = r.protocol;
    code = r.code;
    detail = r.description;
  } else {
    const ctx = sefazCtx(company, inv!.environment === 1 ? 1 : 2);
    const r = await enviarEvento(ctx, inv!.model === 'NFCE' ? 65 : 55, { chNFe: inv!.accessKey!, tpEvento: '110111', det: detCancelamento(inv!.protocol || '', reason.trim()) });
    if (!r.ok) {
      await prisma.invoiceEvent.create({ data: { invoiceId, type: 'REJEICAO', code: r.cStat, description: `${r.cStat} - ${r.xMotivo}` } });
      fail(400, `Rejeição ${r.cStat}: ${r.xMotivo}`);
    }
    protocol = r.nProt || '';
    code = r.cStat;
    detail = r.xMotivo + (r.authorizer ? ` (${r.authorizer})` : '');
    if (r.procXml) detail += ` — XML do evento: ${await storeXml(orgId, `${inv!.accessKey}-110111-procEventoNFe.xml`, r.procXml)}`;
  }
  await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELADA', cancelReason: reason, cancelProtocol: protocol, cancelledAt: new Date() } });
  await prisma.invoiceEvent.create({ data: { invoiceId, type: 'CANCELAMENTO', code, protocol, description: `${code} - ${detail}. Justificativa: ${reason}` } });
  await emit('invoice.cancelled', { companyId, orgId, invoiceId, salesOrderId: inv!.salesOrderId, userName });
  try {
    const { cancelGnreForInvoice } = await import('./gnre');
    await cancelGnreForInvoice(companyId, invoiceId);
  } catch {
    /* sem GNRE */
  }
}

/** Guarda o XML de um evento (procEventoNFe) como arquivo e devolve a URL de download */
async function storeXml(orgId: string, filename: string, xml: string) {
  const row = await prisma.upload.create({ data: { organizationId: orgId, filename, mime: 'application/xml', size: Buffer.byteLength(xml), data: Buffer.from(xml, 'utf8') } });
  return `/api/files/${row.id}`;
}

/** Carta de correção eletrônica (CC-e, evento 110110) — somente NF-e modelo 55 */
export async function correctionLetter(companyId: string, invoiceId: string, text: string) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId, status: 'AUTORIZADA' } });
  if (!inv) fail(400, 'Carta de correção só para notas autorizadas');
  if (inv!.model !== 'NFE') fail(400, 'Carta de correção disponível apenas para NF-e (modelo 55)');
  const correction = String(text || '').trim();
  if (correction.length < 15) fail(400, 'A correção deve ter no mínimo 15 caracteres');
  if (correction.length > 1000) fail(400, 'A correção deve ter no máximo 1000 caracteres');
  const seq = (await prisma.invoiceEvent.count({ where: { invoiceId, type: 'CCE' } })) + 1;
  if (seq > 20) fail(400, 'Rejeição 580: limite de 20 cartas de correção atingido');
  const company = (await prisma.company.findUnique({ where: { id: companyId } }))!;
  if (inv!.providerRef) {
    const r = await focusCce(await focusAccount(companyId), inv!.providerRef, correction);
    if (!r.ok) fail(400, `CC-e rejeitada: ${r.xMotivo}`);
    return prisma.invoiceEvent.create({ data: { invoiceId, type: 'CCE', code: r.cStat || '135', protocol: r.protocol, description: `Carta de correção nº ${r.seq || seq}: ${correction}` } });
  }
  if (inv!.procXml) {
    const ctx = sefazCtx(company, inv!.environment === 1 ? 1 : 2);
    const r = await enviarEvento(ctx, 55, { chNFe: inv!.accessKey!, tpEvento: '110110', nSeqEvento: seq, det: detCCe(correction) });
    if (!r.ok) {
      await prisma.invoiceEvent.create({ data: { invoiceId, type: 'REJEICAO', code: r.cStat, description: `CC-e: ${r.cStat} - ${r.xMotivo}` } });
      fail(400, `Rejeição ${r.cStat}: ${r.xMotivo}`);
    }
    const url = r.procXml ? await storeXml(company.organizationId, `${inv!.accessKey}-110110-${seq}-procEventoNFe.xml`, r.procXml) : null;
    return prisma.invoiceEvent.create({ data: { invoiceId, type: 'CCE', code: r.cStat, protocol: r.nProt, description: `Carta de correção nº ${seq}${r.authorizer ? ` (${r.authorizer})` : ''}: ${correction}${url ? ` — XML do evento: ${url}` : ''}` } });
  }
  requireRealOrDemo('Carta de correção (CC-e)', `A nota não foi autorizada pela SEFAZ/Focus NFe — a CC-e só pode ser registrada em notas reais. ${FISCAL_HOWTO}`);
  return prisma.invoiceEvent.create({ data: { invoiceId, type: 'CCE', code: '135', protocol: `1${Date.now()}`, description: `Carta de correção: ${correction}` } });
}

/** Inutilização de faixa de numeração (números pulados que não serão usados) */
export async function voidNumbers(companyId: string, input: { model: string; series: number; fromNumber: number; toNumber: number; reason: string }) {
  const { model, series, fromNumber, toNumber, reason } = input;
  if (!['NFE', 'NFCE'].includes(model)) fail(400, 'Inutilização disponível apenas para NF-e e NFC-e');
  if (!(fromNumber > 0) || toNumber < fromNumber) fail(400, 'Faixa de numeração inválida');
  if (toNumber - fromNumber > 9999) fail(400, 'Rejeição 252: faixa de inutilização muito extensa');
  if (!reason || reason.trim().length < 15) fail(400, 'Justificativa deve ter no mínimo 15 caracteres');
  const used = await prisma.invoice.findFirst({ where: { companyId, model, series, number: { gte: fromNumber, lte: toNumber }, status: { in: ['AUTORIZADA', 'CANCELADA', 'CONTINGENCIA', 'DENEGADA', 'PROCESSANDO'] } } });
  if (used) fail(400, `Rejeição 241: número ${used.number} já utilizado em documento autorizado`);
  const overlap = await prisma.numberVoid.findFirst({ where: { companyId, model, series, fromNumber: { lte: toNumber }, toNumber: { gte: fromNumber } } });
  if (overlap) fail(400, 'Rejeição 256: faixa já inutilizada');
  const company = (await prisma.company.findUnique({ where: { id: companyId } }))!;
  const provider = fiscalProviderOf(company);
  if (provider === 'SIMULADO') requireRealFiscal(company, 'Inutilização de numeração');
  // Protocolo fictício apenas na simulação (modo demonstração); nos provedores reais vale o retornado
  let protocol = provider === 'SIMULADO' ? `1${randomDigits(14)}` : '';
  if (provider === 'SEFAZ') {
    const r = await inutilizar(sefazCtx(company), model === 'NFCE' ? 65 : 55, { serie: series, nIni: fromNumber, nFin: toNumber, xJust: reason.trim() });
    if (!r.ok) fail(400, `Rejeição ${r.cStat}: ${r.xMotivo}`);
    protocol = r.nProt || '';
  } else if (provider === 'FOCUS_NFE') {
    const r = await focusInutilizar(await focusAccount(companyId), model as 'NFE' | 'NFCE', { cnpj: onlyDigits(company.cnpj), serie: series, numero_inicial: fromNumber, numero_final: toNumber, justificativa: reason.trim() });
    if (!r.ok) fail(400, `Inutilização rejeitada: ${r.xMotivo}`);
    protocol = r.protocol || '';
  }
  return prisma.numberVoid.create({ data: { companyId, model, series, fromNumber, toNumber, reason, protocol } });
}

/** Configurações fiscais da empresa: modo de emissão, ambiente, CSC da NFC-e e IE de substituto (GNRE) */
export async function updateFiscalSettings(companyId: string, body: { fiscalProvider?: string; nfeEnvironment?: number | string; cscId?: string | null; cscToken?: string | null; ieSt?: Record<string, unknown> }) {
  const data: Record<string, unknown> = {};
  if (body.fiscalProvider !== undefined) {
    if (!['SIMULADO', 'SEFAZ', 'FOCUS_NFE'].includes(body.fiscalProvider)) fail(400, 'Modo de emissão inválido');
    if (body.fiscalProvider === 'SEFAZ' && !(await prisma.company.count({ where: { id: companyId, certPfx: { not: null } } }))) fail(400, 'Instale o certificado digital A1 antes de emitir direto na SEFAZ');
    if (body.fiscalProvider === 'FOCUS_NFE' && !(await getAccount(companyId, 'FOCUS_NFE'))) fail(400, 'Conecte a conta Focus NFe em Integrações → Contas e credenciais antes de escolher este modo');
    data.fiscalProvider = body.fiscalProvider;
  }
  if (body.nfeEnvironment !== undefined) data.nfeEnvironment = Number(body.nfeEnvironment) === 1 ? 1 : 2;
  if (body.cscId !== undefined) data.cscId = String(body.cscId || '').replace(/\D/g, '').slice(0, 6) || null;
  if (body.cscToken) data.cscToken = String(body.cscToken).trim().slice(0, 36);
  if (body.ieSt && typeof body.ieSt === 'object') data.ieSt = Object.fromEntries(Object.entries(body.ieSt).filter(([uf, ie]) => /^[A-Z]{2}$/.test(uf) && ie).map(([uf, ie]) => [uf, String(ie).replace(/\D/g, '')]));
  return prisma.company.update({ where: { id: companyId }, data, select: { fiscalProvider: true, nfeEnvironment: true, cscId: true, ieSt: true, sefazMode: true } });
}

/** Consulta o status dos serviços (NF-e e NFC-e) da SEFAZ da UF da empresa */
export async function sefazServiceStatus(companyId: string) {
  const company = (await prisma.company.findUnique({ where: { id: companyId } }))!;
  const ctx = sefazCtx(company);
  const out = [];
  for (const model of [55, 65] as const) {
    const authorizer = authorizerFor(company.uf, model);
    try {
      const r = await statusServico(ctx, model);
      out.push({ model: model === 55 ? 'NF-e' : 'NFC-e', authorizer, ...r });
    } catch (e) {
      out.push({ model: model === 55 ? 'NF-e' : 'NFC-e', authorizer, ok: false, cStat: '', xMotivo: (e as Error).message });
    }
  }
  return { environment: ctx.tpAmb, uf: company.uf, services: out };
}

// ---------------------------------------------------------------------------
// XML da NF-e / NFC-e (leiaute 4.00)
// ---------------------------------------------------------------------------
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
const n2 = (n: number) => (Number(n) || 0).toFixed(2);
const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const HOMOLOG_DEST = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
const HOMOLOG_ITEM = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
const TPAG: Record<string, string> = { DINHEIRO: '01', CHEQUE: '02', CARTAO_CREDITO: '03', CARTAO_DEBITO: '04', BOLETO: '15', TRANSFERENCIA: '18', PIX: '17' };
const validGtin = (g?: string | null) => {
  const d = onlyDigits(g);
  if (![8, 12, 13, 14].includes(d.length)) return null;
  const body = d.slice(0, -1).padStart(13, '0');
  const sum = body.split('').reduce((a, c, i) => a + Number(c) * (i % 2 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(d.slice(-1)) ? d : null;
};

export type XmlOptions = {
  customer?: Contact | null;
  destCityCode?: string | null;
  products?: Record<string, { origin?: number; gtin?: string | null; cest?: string | null }>;
  paymentMethod?: string | null;
  natureKind?: string;
  tpAmb?: 1 | 2;
  /** 1 normal | 6 SVC-AN | 7 SVC-RS | 9 NFC-e offline */
  tpEmis?: number;
  dhEmi?: Date;
  dhCont?: Date;
  xJust?: string;
  /** não incluir protocolo (envio real: o protNFe vem da SEFAZ) */
  noProt?: boolean;
};

/** Distribui um valor entre os itens proporcionalmente (resíduo no último) */
function spread(total: number, items: InvoiceItem[]) {
  const gross = items.reduce((a, i) => a + i.total, 0);
  let acc = 0;
  return items.map((i, idx) => {
    if (idx === items.length - 1) return round2(total - acc);
    const v = gross ? round2((total * i.total) / gross) : 0;
    acc = round2(acc + v);
    return v;
  });
}

/** Gera o XML (NF-e 4.00 / NFS-e ABRASF). Retorna também se foi assinado com certificado real. */
export function buildXml(inv: Invoice & { items: InvoiceItem[] }, company: Company, opts: XmlOptions = {}): { xml: string; signed: boolean; nfe: string; digest: string | null } {
  if (inv.model === 'NFSE') {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
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
</CompNfse>`;
    return { signed: false, xml, nfe: xml, digest: null };
  }
  const mod = inv.model === 'NFCE' ? 65 : 55;
  const nfce = mod === 65;
  const sn = company.crt === 1;
  const tpAmb = opts.tpAmb ?? 2;
  const tpEmis = opts.tpEmis ?? (inv.contingency ? 9 : 1);
  const uf = company.uf;
  const customer = opts.customer;
  const destUf = customer?.uf || inv.customerUf || uf;
  const idDest = nfce ? 1 : destUf !== uf ? 2 : 1;
  const indIEDest = nfce ? 9 : customer?.ieIndicator === 1 ? 1 : customer?.ieIndicator === 2 ? 2 : 9;
  const indFinal = nfce || indIEDest !== 1 ? 1 : 0;
  const when = opts.dhEmi || (inv.contingency ? inv.issueDate : inv.authorizedAt) || new Date();
  const items = inv.items;
  const freights = spread(inv.freight, items);
  const discounts = spread(inv.discount, items);
  const T = { vBC: 0, vICMS: 0, vBCST: 0, vST: 0, vFCPUFDest: 0, vICMSUFDest: 0, vIPI: 0, vPIS: 0, vCOFINS: 0 };
  const add = (k: keyof typeof T, v: number) => (T[k] = round2(T[k] + (Number(v) || 0)));

  const icmsGroup = (i: InvoiceItem, orig: number) => {
    const cst = String(i.cst || '');
    if (sn) {
      if (i.icmsStValue) {
        add('vBCST', i.icmsStBase); add('vST', i.icmsStValue);
        const pST = ICMS_INTERNAL[destUf] || 18;
        return `<ICMSSN202><orig>${orig}</orig><CSOSN>${cst === '203' ? '203' : '202'}</CSOSN><modBCST>4</modBCST><vBCST>${n2(i.icmsStBase)}</vBCST><pICMSST>${n2(pST)}</pICMSST><vICMSST>${n2(i.icmsStValue)}</vICMSST></ICMSSN202>`;
      }
      if (cst === '101') return `<ICMSSN101><orig>${orig}</orig><CSOSN>101</CSOSN><pCredSN>0.00</pCredSN><vCredICMSSN>0.00</vCredICMSSN></ICMSSN101>`;
      if (cst === '500') return `<ICMSSN500><orig>${orig}</orig><CSOSN>500</CSOSN></ICMSSN500>`;
      if (cst === '900') return `<ICMSSN900><orig>${orig}</orig><CSOSN>900</CSOSN></ICMSSN900>`;
      return `<ICMSSN102><orig>${orig}</orig><CSOSN>${['102', '103', '300', '400'].includes(cst) ? cst : '102'}</CSOSN></ICMSSN102>`;
    }
    if (i.icmsStValue) {
      add('vBC', i.icmsBase); add('vICMS', i.icmsValue); add('vBCST', i.icmsStBase); add('vST', i.icmsStValue);
      const pST = ICMS_INTERNAL[destUf] || 18;
      return `<ICMS10><orig>${orig}</orig><CST>10</CST><modBC>3</modBC><vBC>${n2(i.icmsBase)}</vBC><pICMS>${n2(i.icmsRate)}</pICMS><vICMS>${n2(i.icmsValue)}</vICMS><modBCST>4</modBCST><vBCST>${n2(i.icmsStBase)}</vBCST><pICMSST>${n2(pST)}</pICMSST><vICMSST>${n2(i.icmsStValue)}</vICMSST></ICMS10>`;
    }
    if (['40', '41', '50'].includes(cst)) return `<ICMS40><orig>${orig}</orig><CST>${cst}</CST></ICMS40>`;
    if (cst === '51') return `<ICMS51><orig>${orig}</orig><CST>51</CST></ICMS51>`;
    if (cst === '60') return `<ICMS60><orig>${orig}</orig><CST>60</CST></ICMS60>`;
    if (cst === '90') return `<ICMS90><orig>${orig}</orig><CST>90</CST></ICMS90>`;
    add('vBC', i.icmsBase); add('vICMS', i.icmsValue);
    return `<ICMS00><orig>${orig}</orig><CST>00</CST><modBC>3</modBC><vBC>${n2(i.icmsBase)}</vBC><pICMS>${n2(i.icmsRate)}</pICMS><vICMS>${n2(i.icmsValue)}</vICMS></ICMS00>`;
  };

  const dets = items
    .map((i, idx) => {
      const p = (i.productId && opts.products?.[i.productId]) || {};
      const orig = p.origin ?? 0;
      const gtin = validGtin(p.gtin) || 'SEM GTIN';
      const cest = onlyDigits(p.cest);
      const xProd = tpAmb === 2 && nfce && idx === 0 ? HOMOLOG_ITEM : txt(i.description, 120);
      const q = i.quantity.toFixed(4);
      const vUn = i.unitPrice.toFixed(10);
      const prod = `<prod><cProd>${txt(i.code, 60)}</cProd><cEAN>${gtin}</cEAN><xProd>${xProd}</xProd><NCM>${onlyDigits(i.ncm)}</NCM>${cest.length === 7 ? `<CEST>${cest}</CEST>` : ''}<CFOP>${esc(i.cfop)}</CFOP><uCom>${txt(i.unit, 6)}</uCom><qCom>${q}</qCom><vUnCom>${vUn}</vUnCom><vProd>${n2(i.total)}</vProd><cEANTrib>${gtin}</cEANTrib><uTrib>${txt(i.unit, 6)}</uTrib><qTrib>${q}</qTrib><vUnTrib>${vUn}</vUnTrib>${freights[idx] > 0 ? `<vFrete>${n2(freights[idx])}</vFrete>` : ''}${discounts[idx] > 0 ? `<vDesc>${n2(discounts[idx])}</vDesc>` : ''}<indTot>1</indTot></prod>`;
      const icms = `<ICMS>${icmsGroup(i, orig)}</ICMS>`;
      let ipi = '';
      if (i.ipiValue && !nfce) {
        add('vIPI', i.ipiValue);
        ipi = `<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>${n2(i.total)}</vBC><pIPI>${n2(i.ipiRate)}</pIPI><vIPI>${n2(i.ipiValue)}</vIPI></IPITrib></IPI>`;
      }
      let pis: string, cofins: string;
      if (sn) {
        pis = `<PIS><PISOutr><CST>${inv.direction === 'ENTRADA' ? '99' : '49'}</CST><vBC>0.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>`;
        cofins = `<COFINS><COFINSOutr><CST>${inv.direction === 'ENTRADA' ? '99' : '49'}</CST><vBC>0.00</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>`;
      } else {
        add('vPIS', i.pisValue); add('vCOFINS', i.cofinsValue);
        pis = `<PIS><PISAliq><CST>01</CST><vBC>${n2(i.total)}</vBC><pPIS>${i.pisRate.toFixed(4)}</pPIS><vPIS>${n2(i.pisValue)}</vPIS></PISAliq></PIS>`;
        cofins = `<COFINS><COFINSAliq><CST>01</CST><vBC>${n2(i.total)}</vBC><pCOFINS>${i.cofinsRate.toFixed(4)}</pCOFINS><vCOFINS>${n2(i.cofinsValue)}</vCOFINS></COFINSAliq></COFINS>`;
      }
      let difal = '';
      if ((i.difalValue || i.fcpValue) && idDest === 2 && indFinal === 1 && indIEDest === 9) {
        add('vFCPUFDest', i.fcpValue); add('vICMSUFDest', i.difalValue);
        const pFCP = FCP_RATE[destUf] || (i.icmsBase ? round2((i.fcpValue / i.icmsBase) * 100) : 0);
        const pInter = [4, 7, 12].includes(i.icmsRate) ? i.icmsRate : interstateIcmsRate(uf, destUf, orig);
        difal = `<ICMSUFDest><vBCUFDest>${n2(i.icmsBase)}</vBCUFDest><vBCFCPUFDest>${n2(i.icmsBase)}</vBCFCPUFDest><pFCPUFDest>${pFCP.toFixed(4)}</pFCPUFDest><pICMSUFDest>${(ICMS_INTERNAL[destUf] || 18).toFixed(4)}</pICMSUFDest><pICMSInter>${n2(pInter)}</pICMSInter><pICMSInterPart>100.0000</pICMSInterPart><vFCPUFDest>${n2(i.fcpValue)}</vFCPUFDest><vICMSUFDest>${n2(i.difalValue)}</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet></ICMSUFDest>`;
      }
      // Reforma tributária (NT 2025.002-RTC) — grupo informativo em 2026. Conferir na documentação: obrigatoriedade por UF/ambiente
      const ibscbs = i.cbsValue || i.ibsValue ? `<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>${n2(i.total)}</vBC><gIBSUF><pIBSUF>${i.ibsRate.toFixed(4)}</pIBSUF><vIBSUF>${n2(i.ibsValue)}</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>${n2(i.ibsValue)}</vIBS><gCBS><pCBS>${i.cbsRate.toFixed(4)}</pCBS><vCBS>${n2(i.cbsValue)}</vCBS></gCBS></gIBSCBS></IBSCBS>` : '';
      return `<det nItem="${idx + 1}">${prod}<imposto>${icms}${ipi}${pis}${cofins}${difal}${ibscbs}</imposto></det>`;
    })
    .join('');

  // Destinatário
  const doc = onlyDigits(customer?.document || inv.customerDoc);
  let dest = '';
  if (doc || customer) {
    const id = doc.length === 14 ? `<CNPJ>${doc}</CNPJ>` : doc.length === 11 ? `<CPF>${doc}</CPF>` : '';
    const name = tpAmb === 2 ? HOMOLOG_DEST : txt(customer?.name || inv.customerName, 60);
    const ender = customer?.street && customer.city && opts.destCityCode
      ? `<enderDest><xLgr>${txt(customer.street, 60)}</xLgr><nro>${txt(customer.number || 'S/N', 60)}</nro>${customer.complement ? `<xCpl>${txt(customer.complement, 60)}</xCpl>` : ''}<xBairro>${txt(customer.district || 'NAO INFORMADO', 60)}</xBairro><cMun>${opts.destCityCode}</cMun><xMun>${txt(customer.city, 60)}</xMun><UF>${customer.uf || destUf}</UF>${onlyDigits(customer.zip).length === 8 ? `<CEP>${onlyDigits(customer.zip)}</CEP>` : ''}<cPais>1058</cPais><xPais>Brasil</xPais>${onlyDigits(customer.phone).length >= 6 ? `<fone>${onlyDigits(customer.phone).slice(0, 14)}</fone>` : ''}</enderDest>`
      : '';
    const ie = indIEDest === 1 && customer?.ie ? `<IE>${onlyDigits(customer.ie)}</IE>` : '';
    const email = customer?.email && !nfce ? `<email>${txt(customer.email, 60)}</email>` : '';
    if (id) dest = `<dest>${id}${nfce && !customer ? '' : `<xNome>${name}</xNome>`}${nfce ? '' : ender}<indIEDest>${indIEDest}</indIEDest>${ie}${email}</dest>`;
  }

  // Pagamento
  const noPayment = inv.finalidade === 3 || inv.finalidade === 4 || ['TRANSFERENCIA', 'REMESSA', 'DEVOLUCAO'].includes(opts.natureKind || '');
  const tPag = noPayment ? '90' : TPAG[opts.paymentMethod || ''] || (nfce ? '01' : '99');
  const detPag = `<detPag><tPag>${tPag}</tPag>${tPag === '99' ? '<xPag>Outros</xPag>' : ''}<vPag>${n2(noPayment ? 0 : inv.total)}</vPag>${['03', '04'].includes(tPag) ? '<card><tpIntegra>2</tpIntegra></card>' : ''}</detPag>`;

  const ide = `<ide><cUF>${UF_CODES[uf]}</cUF><cNF>${inv.accessKey?.slice(35, 43)}</cNF><natOp>${txt(inv.natureName, 60)}</natOp><mod>${mod}</mod><serie>${inv.series}</serie><nNF>${inv.number}</nNF><dhEmi>${dhUF(when, uf)}</dhEmi><tpNF>${inv.direction === 'ENTRADA' ? 0 : 1}</tpNF><idDest>${idDest}</idDest><cMunFG>${esc(onlyDigits(company.cityCode) || localCityCode(uf, company.city) || '3550308')}</cMunFG><tpImp>${nfce ? 4 : 1}</tpImp><tpEmis>${tpEmis}</tpEmis><cDV>${inv.accessKey?.slice(-1)}</cDV><tpAmb>${tpAmb}</tpAmb><finNFe>${inv.finalidade || 1}</finNFe><indFinal>${indFinal}</indFinal><indPres>${nfce ? 1 : inv.finalidade === 1 ? 9 : 0}</indPres>${!nfce && inv.finalidade === 1 ? '<indIntermed>0</indIntermed>' : ''}<procEmi>0</procEmi><verProc>GestaoPro 2.0</verProc>${tpEmis !== 1 ? `<dhCont>${dhUF(opts.dhCont || when, uf)}</dhCont><xJust>${txt(opts.xJust || 'SEFAZ indisponivel - emissao em contingencia offline', 256)}</xJust>` : ''}${inv.refAccessKey ? `<NFref><refNFe>${inv.refAccessKey}</refNFe></NFref>` : ''}</ide>`;
  const emitEl = `<emit><CNPJ>${onlyDigits(company.cnpj)}</CNPJ><xNome>${txt(company.name, 60)}</xNome>${company.tradeName ? `<xFant>${txt(company.tradeName, 60)}</xFant>` : ''}<enderEmit><xLgr>${txt(company.street || 'NAO INFORMADO', 60)}</xLgr><nro>${txt(company.number || 'S/N', 60)}</nro><xBairro>${txt(company.district || 'NAO INFORMADO', 60)}</xBairro><cMun>${esc(onlyDigits(company.cityCode) || localCityCode(uf, company.city) || '3550308')}</cMun><xMun>${txt(company.city || 'NAO INFORMADO', 60)}</xMun><UF>${uf}</UF>${onlyDigits(company.zip).length === 8 ? `<CEP>${onlyDigits(company.zip)}</CEP>` : ''}<cPais>1058</cPais><xPais>Brasil</xPais>${onlyDigits(company.phone).length >= 6 ? `<fone>${onlyDigits(company.phone).slice(0, 14)}</fone>` : ''}</enderEmit><IE>${esc(onlyDigits(company.ie))}</IE><CRT>${company.crt}</CRT></emit>`;
  const total = `<total><ICMSTot><vBC>${n2(T.vBC)}</vBC><vICMS>${n2(T.vICMS)}</vICMS><vICMSDeson>0.00</vICMSDeson>${T.vFCPUFDest || T.vICMSUFDest ? `<vFCPUFDest>${n2(T.vFCPUFDest)}</vFCPUFDest><vICMSUFDest>${n2(T.vICMSUFDest)}</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet>` : ''}<vFCP>0.00</vFCP><vBCST>${n2(T.vBCST)}</vBCST><vST>${n2(T.vST)}</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${n2(inv.productsTotal)}</vProd><vFrete>${n2(inv.freight)}</vFrete><vSeg>0.00</vSeg><vDesc>${n2(inv.discount)}</vDesc><vII>0.00</vII><vIPI>${n2(T.vIPI)}</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>${n2(T.vPIS)}</vPIS><vCOFINS>${n2(T.vCOFINS)}</vCOFINS><vOutro>0.00</vOutro><vNF>${n2(inv.total)}</vNF><vTotTrib>${n2(inv.approxTaxes)}</vTotTrib></ICMSTot>${inv.cbsValue || inv.ibsValue ? `<IBSCBSTot><vBCIBSCBS>${n2(inv.productsTotal - inv.discount + inv.freight)}</vBCIBSCBS><gIBS><vIBS>${n2(inv.ibsValue)}</vIBS></gIBS><gCBS><vCBS>${n2(inv.cbsValue)}</vCBS></gCBS></IBSCBSTot>` : ''}</total>`;
  const transp = `<transp><modFrete>${inv.freight && !nfce ? 0 : 9}</modFrete></transp>`;
  const infAdic = inv.additionalInfo ? `<infAdic><infCpl>${txt(inv.additionalInfo, 5000)}</infCpl></infAdic>` : '';
  const respTec = process.env.RESP_TEC_CNPJ ? `<infRespTec><CNPJ>${onlyDigits(process.env.RESP_TEC_CNPJ)}</CNPJ><xContato>${txt(process.env.RESP_TEC_CONTATO || 'Suporte', 60)}</xContato><email>${txt(process.env.RESP_TEC_EMAIL || 'suporte@gestaopro.com.br', 60)}</email><fone>${onlyDigits(process.env.RESP_TEC_FONE || '1140000000')}</fone></infRespTec>` : '';
  const inner = `${ide}${emitEl}${dest}${dets}${total}${transp}<pag>${detPag}</pag>${infAdic}${respTec}`;
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
  const digest = signature.match(/<DigestValue>([^<]+)<\/DigestValue>/)?.[1] || null;
  // NFC-e: QR Code v2 e URL de consulta (fora do infNFe, não entram no digest)
  let supl = '';
  if (nfce && inv.accessKey) {
    const offline = tpEmis === 9 ? { issueDate: when, total: inv.total, digestValue: digest || '', dayUF: dhUF(when, uf).slice(8, 10) } : undefined;
    const qr = nfceQrCode({ uf, accessKey: inv.accessKey, tpAmb, cscId: company.cscId, csc: company.cscToken || 'SIMULADO', offline });
    supl = `<infNFeSupl><qrCode>${esc(qr)}</qrCode><urlChave>${esc(nfceUrlChave(uf, tpAmb))}</urlChave></infNFeSupl>`;
  }
  const prot = inv.protocol && !opts.noProt
    ? `<protNFe versao="4.00"><infProt><tpAmb>${tpAmb}</tpAmb><verAplic>SEFAZ-SIMULADA</verAplic><chNFe>${inv.accessKey}</chNFe><dhRecbto>${dhUF(inv.authorizedAt || new Date(), uf)}</dhRecbto><nProt>${inv.protocol}</nProt>${digest ? `<digVal>${digest}</digVal>` : ''}<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`
    : '';
  const nfe = `<NFe xmlns="${NFE_NS}"><infNFe Id="${id}" versao="4.00">${inner}</infNFe>${supl}${signature}</NFe>`;
  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n${prot ? `<nfeProc xmlns="${NFE_NS}" versao="4.00">${nfe}${prot}</nfeProc>` : nfe}`, signed, nfe, digest };
}

/** Extrai a forma canônica do infNFe e a assinatura de um XML gerado (para conferência) */
export function extractSignedParts(xml: string) {
  const inf = xml.match(/<infNFe Id="([^"]+)" versao="4.00">([\s\S]*?)<\/infNFe>/);
  const sig = xml.match(/<Signature[\s\S]*?<\/Signature>/)?.[0];
  if (!inf || !sig) return null;
  return { canonical: `<infNFe xmlns="${NFE_NS}" Id="${inf[1]}" versao="4.00">${inf[2]}</infNFe>`, signature: sig };
}

/** NF-e assinada (sem protocolo) contida num XML armazenado */
export const nfeOf = (xml: string | null | undefined) => (xml ? block(stripDecl(xml), 'NFe') : null);
