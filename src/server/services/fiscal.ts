/**
 * Módulo fiscal (SIMULADO): NF-e (55), NFC-e (65) e NFS-e.
 * - Cálculo de ICMS, IPI, PIS, COFINS e ISS conforme regime tributário
 * - CFOP por natureza de operação (intra/interestadual)
 * - Chave de acesso real (mod 11), XML no layout da NF-e 4.00
 * - "SEFAZ" simulada: validações com códigos de rejeição reais, protocolo,
 *   cancelamento com prazo de 24h e justificativa mínima de 15 caracteres.
 * Nenhuma comunicação real com a SEFAZ ou prefeituras é realizada.
 */
import type { Db } from '@/lib/db';
import { prisma } from '@/lib/db';
import { round2, onlyDigits, randomDigits } from '@/lib/utils';
import { buildAccessKey, ICMS_INTERNAL, interstateIcmsRate, isValidCNPJ, isValidCPF, UF_CODES } from '@/lib/br';
import { fail } from '../errors';
import { nextNumber } from '../sequence';
import { emit } from '../events';
import type { Company, Invoice, InvoiceItem, OperationNature } from '@prisma/client';

export type InvoiceModel = 'NFE' | 'NFCE' | 'NFSE';

type TaxInputItem = { total: number; ipiRate: number; origin: number; isService: boolean; issRate?: number };

/** Calcula impostos de um item (após rateio de frete/desconto) */
export function calcItemTaxes(company: Company, nature: OperationNature, destUf: string, finalConsumer: boolean, item: TaxInputItem, freightShare = 0, discountShare = 0) {
  const base = round2(item.total + freightShare - discountShare);
  const intra = !destUf || destUf === company.uf;
  const out = {
    cfop: intra ? nature.cfopIntra : nature.cfopInter,
    cst: company.crt === 1 ? nature.csosn : nature.icmsCst,
    icmsBase: 0, icmsRate: 0, icmsValue: 0,
    ipiRate: 0, ipiValue: 0,
    pisRate: 0, pisValue: 0, cofinsRate: 0, cofinsValue: 0,
    issRate: 0, issValue: 0,
  };
  if (item.isService) {
    out.cfop = '';
    out.cst = '';
    out.issRate = item.issRate ?? nature.issRate;
    out.issValue = round2((base * out.issRate) / 100);
    if (company.crt !== 1) {
      const [pis, cofins] = company.taxRegime === 'REAL' ? [1.65, 7.6] : [0.65, 3];
      out.pisRate = pis; out.pisValue = round2((base * pis) / 100);
      out.cofinsRate = cofins; out.cofinsValue = round2((base * cofins) / 100);
    }
    return out;
  }
  if (company.crt === 1) {
    // Simples Nacional: ICMS/PIS/COFINS recolhidos no DAS, sem destaque (CSOSN 102 / CST 49)
    return out;
  }
  out.ipiRate = item.ipiRate || 0;
  out.ipiValue = round2((item.total * out.ipiRate) / 100);
  out.icmsRate = intra ? nature.icmsRateIntra || ICMS_INTERNAL[company.uf] || 18 : interstateIcmsRate(company.uf, destUf, item.origin);
  out.icmsBase = round2(base + (finalConsumer ? out.ipiValue : 0));
  out.icmsValue = round2((out.icmsBase * out.icmsRate) / 100);
  const [pis, cofins] = company.taxRegime === 'REAL' ? [nature.pisRate || 1.65, nature.cofinsRate || 7.6] : [0.65, 3];
  out.pisRate = pis; out.pisValue = round2((base * pis) / 100);
  out.cofinsRate = cofins; out.cofinsValue = round2((base * cofins) / 100);
  return out;
}

export async function natureFor(db: Db, companyId: string, model: InvoiceModel, natureId?: string | null) {
  if (natureId) {
    const n = await db.operationNature.findFirst({ where: { id: natureId, companyId } });
    if (n) return n;
  }
  const kind = model === 'NFCE' ? 'NFCE' : model === 'NFSE' ? 'SERVICO' : 'VENDA';
  const n =
    (await db.operationNature.findFirst({ where: { companyId, kind, isDefault: true } })) ||
    (await db.operationNature.findFirst({ where: { companyId, kind } })) ||
    (await db.operationNature.findFirst({ where: { companyId } }));
  if (!n) fail(400, 'Cadastre uma natureza de operação em Notas Fiscais > Naturezas de operação');
  return n!;
}

export type BuildInvoiceInput = {
  companyId: string;
  model: InvoiceModel;
  natureId?: string | null;
  customerId?: string | null;
  items: { productId?: string | null; serviceId?: string | null; description?: string; quantity: number; unitPrice: number }[];
  freight?: number;
  discount?: number;
  salesOrderId?: string | null;
  serviceOrderId?: string | null;
  additionalInfo?: string | null;
  consumerDoc?: string | null;
};

/** Monta a nota (status RASCUNHO) com itens e impostos calculados */
export async function buildInvoice(db: Db, input: BuildInvoiceInput) {
  const company = await db.company.findUnique({ where: { id: input.companyId } });
  if (!company) fail(404, 'Empresa não encontrada');
  const c = company!;
  const nature = await natureFor(db, c.id, input.model, input.natureId);
  const customer = input.customerId ? await db.contact.findUnique({ where: { id: input.customerId } }) : null;
  const destUf = customer?.uf || c.uf;
  const finalConsumer = !customer || customer.ieIndicator !== 1;

  const rawItems = [];
  for (const it of input.items) {
    if (it.serviceId) {
      const s = await db.service.findUnique({ where: { id: it.serviceId } });
      if (!s) continue;
      rawItems.push({ productId: null, serviceId: s.id, code: s.code, description: it.description || s.name, ncm: null as string | null, unit: s.unit, quantity: it.quantity, unitPrice: it.unitPrice, total: round2(it.quantity * it.unitPrice), ipiRate: 0, origin: 0, isService: true, issRate: s.issRate });
    } else if (it.productId) {
      const p = await db.product.findUnique({ where: { id: it.productId } });
      if (!p) continue;
      rawItems.push({ productId: p.id, serviceId: null, code: p.sku, description: it.description || p.name, ncm: p.ncm, unit: p.unit, quantity: it.quantity, unitPrice: it.unitPrice, total: round2(it.quantity * it.unitPrice), ipiRate: p.ipiRate, origin: p.origin, isService: false, issRate: undefined });
    }
  }
  const relevant = rawItems.filter((i) => (input.model === 'NFSE' ? i.isService : !i.isService));
  if (!relevant.length) fail(400, input.model === 'NFSE' ? 'Nenhum serviço para emitir NFS-e' : 'Nenhum produto para emitir a nota');

  const gross = round2(relevant.reduce((a, i) => a + i.total, 0));
  const freight = round2(input.model === 'NFSE' ? 0 : input.freight || 0);
  const discount = round2(input.discount || 0);
  const items = relevant.map((i) => {
    const share = gross ? i.total / gross : 0;
    const taxes = calcItemTaxes(c, nature, destUf, finalConsumer, i, round2(freight * share), round2(discount * share));
    return { ...i, ...taxes };
  });
  const sum = (k: keyof (typeof items)[number]) => round2(items.reduce((a, i) => a + Number(i[k] || 0), 0));
  const productsTotal = input.model === 'NFSE' ? 0 : gross;
  const servicesTotal = input.model === 'NFSE' ? gross : 0;
  const ipiValue = sum('ipiValue');
  const total = round2(gross + freight - discount + ipiValue);
  const key = input.model === 'NFCE' ? 'NFCE' : input.model === 'NFSE' ? 'NFSE' : 'NFE';
  const series = input.model === 'NFCE' ? c.nfceSeries : input.model === 'NFSE' ? 1 : c.nfeSeries;
  const number = await nextNumber(db, c.id, `${key}-${series}`, 1);
  // Tributos aproximados (Lei 12.741/2012 — tabela IBPT simulada)
  const approxTaxes = round2(total * (input.model === 'NFSE' ? 0.1615 : 0.3145));

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
      customerId: customer?.id || null,
      customerName: customer?.name || 'CONSUMIDOR NÃO IDENTIFICADO',
      customerDoc: customer?.document || input.consumerDoc || null,
      customerUf: destUf,
      salesOrderId: input.salesOrderId || null,
      serviceOrderId: input.serviceOrderId || null,
      productsTotal,
      servicesTotal,
      freight,
      discount,
      icmsBase: sum('icmsBase'),
      icmsValue: sum('icmsValue'),
      ipiValue,
      pisValue: sum('pisValue'),
      cofinsValue: sum('cofinsValue'),
      issValue: sum('issValue'),
      approxTaxes,
      total,
      additionalInfo:
        input.additionalInfo ||
        [
          c.crt === 1 ? 'DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL. NÃO GERA DIREITO A CRÉDITO FISCAL DE IPI.' : null,
          `Val. aprox. tributos R$ ${approxTaxes.toFixed(2).replace('.', ',')} Fonte: IBPT (simulado).`,
          'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO / SIMULAÇÃO - SEM VALOR FISCAL',
        ]
          .filter(Boolean)
          .join(' '),
      items: {
        create: items.map((i) => ({
          productId: i.productId,
          serviceId: i.serviceId,
          code: i.code,
          description: i.description,
          ncm: i.ncm,
          cfop: i.cfop,
          cst: i.cst,
          unit: i.unit,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          total: i.total,
          icmsBase: i.icmsBase, icmsRate: i.icmsRate, icmsValue: i.icmsValue,
          ipiRate: i.ipiRate, ipiValue: i.ipiValue,
          pisRate: i.pisRate, pisValue: i.pisValue,
          cofinsRate: i.cofinsRate, cofinsValue: i.cofinsValue,
          issRate: i.issRate, issValue: i.issValue,
        })),
      },
      events: { create: { type: 'CRIACAO', description: 'Nota criada (rascunho)' } },
    },
    include: { items: true },
  });
}

/** Validações equivalentes às regras de negócio da SEFAZ (subconjunto) */
async function sefazValidate(db: Db, inv: Invoice & { items: InvoiceItem[] }, company: Company): Promise<{ code: string; reason: string } | null> {
  if (!company.certValidUntil) return { code: '280', reason: 'Rejeição: Certificado Transmissor inválido (nenhum certificado digital A1 instalado)' };
  if (company.certValidUntil < new Date()) return { code: '284', reason: 'Rejeição: Certificado Transmissor vencido' };
  if (!isValidCNPJ(company.cnpj)) return { code: '207', reason: 'Rejeição: CNPJ do emitente inválido' };
  if (inv.model !== 'NFSE' && !company.ie) return { code: '209', reason: 'Rejeição: IE do emitente inválida' };
  if (inv.total <= 0) return { code: '610', reason: 'Rejeição: Total da NF difere do somatório dos valores' };
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
 * Transmite a nota para a "SEFAZ simulada". Em caso de autorização, gera
 * chave, protocolo e XML e dispara o evento `invoice.authorized`.
 */
export async function transmitInvoice(companyId: string, orgId: string, invoiceId: string, userName?: string) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId }, include: { items: true } });
  if (!inv) fail(404, 'Nota fiscal não encontrada');
  const invoice = inv!;
  if (invoice.status === 'AUTORIZADA') fail(400, 'Nota já autorizada');
  if (invoice.status === 'CANCELADA') fail(400, 'Nota cancelada');
  const company = (await prisma.company.findUnique({ where: { id: companyId } }))!;
  await prisma.invoiceEvent.create({ data: { invoiceId, type: 'TRANSMISSAO', description: `Lote enviado à ${invoice.model === 'NFSE' ? 'prefeitura' : 'SEFAZ-' + company.uf} (ambiente de homologação simulado)` } });

  const rejection = await sefazValidate(prisma, invoice, company);
  if (rejection) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'REJEITADA', rejectionCode: rejection.code, rejectionReason: rejection.reason } });
    await prisma.invoiceEvent.create({ data: { invoiceId, type: 'REJEICAO', code: rejection.code, description: `${rejection.code} - ${rejection.reason}` } });
    return prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, events: true } });
  }

  const now = new Date();
  let accessKey: string | null = null;
  let verificationCode: string | null = null;
  let protocol: string;
  if (invoice.model === 'NFSE') {
    verificationCode = Math.random().toString(36).slice(2, 10).toUpperCase();
    protocol = `${now.getFullYear()}${randomDigits(9)}`;
  } else {
    accessKey = buildAccessKey({ uf: company.uf, date: now, cnpj: company.cnpj, model: invoice.model === 'NFCE' ? 65 : 55, series: invoice.series, number: invoice.number });
    protocol = `${UF_CODES[company.uf] === '35' ? '1' : '3'}${UF_CODES[company.uf] || '35'}${String(now.getFullYear()).slice(2)}${randomDigits(10)}`;
  }
  const xml = buildXml({ ...invoice, accessKey, protocol, authorizedAt: now }, company);
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: 'AUTORIZADA', accessKey, protocol, verificationCode, authorizedAt: now, issueDate: now, xml, rejectionCode: null, rejectionReason: null },
  });
  await prisma.invoiceEvent.create({ data: { invoiceId, type: 'AUTORIZACAO', code: '100', protocol, description: '100 - Autorizado o uso da NF-e' } });
  await emit('invoice.authorized', { companyId, orgId, invoiceId, salesOrderId: invoice.salesOrderId, serviceOrderId: invoice.serviceOrderId, model: invoice.model, userName });
  return prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, events: true } });
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
    fail(400, `Rejeição 501: Prazo de cancelamento superior ao previsto (${inv!.model === 'NFCE' ? '30 minutos' : '24 horas'}). Emita uma nota de devolução/estorno.`);
  }
  const protocol = `1${randomDigits(14)}`;
  await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELADA', cancelReason: reason, cancelProtocol: protocol, cancelledAt: new Date() } });
  await prisma.invoiceEvent.create({ data: { invoiceId, type: 'CANCELAMENTO', code: '135', protocol, description: `135 - Evento registrado e vinculado a NF-e. Justificativa: ${reason}` } });
  await emit('invoice.cancelled', { companyId, orgId, invoiceId, salesOrderId: inv!.salesOrderId, userName });
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n2 = (n: number) => (Number(n) || 0).toFixed(2);

/** XML no layout NF-e 4.00 (nfeProc) — assinatura digital simulada */
export function buildXml(inv: Invoice & { items: InvoiceItem[] }, company: Company) {
  if (inv.model === 'NFSE') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse versao="2.04"><InfNfse Id="NFSe${inv.number}">
    <Numero>${inv.number}</Numero><CodigoVerificacao>${esc(inv.verificationCode)}</CodigoVerificacao>
    <DataEmissao>${(inv.authorizedAt || new Date()).toISOString()}</DataEmissao>
    <ValoresNfse><BaseCalculo>${n2(inv.servicesTotal)}</BaseCalculo><ValorIss>${n2(inv.issValue)}</ValorIss><ValorLiquidoNfse>${n2(inv.total - inv.issValue)}</ValorLiquidoNfse></ValoresNfse>
    <PrestadorServico><IdentificacaoPrestador><CpfCnpj><Cnpj>${onlyDigits(company.cnpj)}</Cnpj></CpfCnpj><InscricaoMunicipal>${esc(company.im)}</InscricaoMunicipal></IdentificacaoPrestador><RazaoSocial>${esc(company.name)}</RazaoSocial></PrestadorServico>
    <TomadorServico><RazaoSocial>${esc(inv.customerName)}</RazaoSocial><CpfCnpj>${esc(onlyDigits(inv.customerDoc))}</CpfCnpj></TomadorServico>
    <Servico>${inv.items.map((i) => `<Item><Discriminacao>${esc(i.description)}</Discriminacao><Quantidade>${i.quantity}</Quantidade><ValorUnitario>${n2(i.unitPrice)}</ValorUnitario><Aliquota>${n2(i.issRate)}</Aliquota></Item>`).join('')}</Servico>
  </InfNfse></Nfse>
</CompNfse>`;
  }
  const mod = inv.model === 'NFCE' ? 65 : 55;
  const dets = inv.items
    .map(
      (i, idx) => `<det nItem="${idx + 1}"><prod><cProd>${esc(i.code)}</cProd><cEAN>SEM GTIN</cEAN><xProd>${esc(i.description)}</xProd><NCM>${esc(onlyDigits(i.ncm))}</NCM><CFOP>${esc(i.cfop)}</CFOP><uCom>${esc(i.unit)}</uCom><qCom>${i.quantity.toFixed(4)}</qCom><vUnCom>${i.unitPrice.toFixed(10)}</vUnCom><vProd>${n2(i.total)}</vProd><indTot>1</indTot></prod><imposto><ICMS>${
        company.crt === 1 ? `<ICMSSN102><orig>0</orig><CSOSN>${esc(i.cst)}</CSOSN></ICMSSN102>` : `<ICMS00><orig>0</orig><CST>${esc(i.cst)}</CST><modBC>3</modBC><vBC>${n2(i.icmsBase)}</vBC><pICMS>${n2(i.icmsRate)}</pICMS><vICMS>${n2(i.icmsValue)}</vICMS></ICMS00>`
      }</ICMS>${i.ipiValue ? `<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>${n2(i.total)}</vBC><pIPI>${n2(i.ipiRate)}</pIPI><vIPI>${n2(i.ipiValue)}</vIPI></IPITrib></IPI>` : ''}<PIS><PISAliq><CST>01</CST><vBC>${n2(i.total)}</vBC><pPIS>${n2(i.pisRate)}</pPIS><vPIS>${n2(i.pisValue)}</vPIS></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST><vBC>${n2(i.total)}</vBC><pCOFINS>${n2(i.cofinsRate)}</pCOFINS><vCOFINS>${n2(i.cofinsValue)}</vCOFINS></COFINSAliq></COFINS></imposto></det>`,
    )
    .join('');
  const doc = onlyDigits(inv.customerDoc);
  const dest = inv.customerDoc
    ? `<dest>${doc.length === 14 ? `<CNPJ>${doc}</CNPJ>` : `<CPF>${doc}</CPF>`}<xNome>${esc(inv.customerName)}</xNome><indIEDest>9</indIEDest></dest>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${inv.accessKey}" versao="4.00"><ide><cUF>${UF_CODES[company.uf]}</cUF><cNF>${inv.accessKey?.slice(35, 43)}</cNF><natOp>${esc(inv.natureName)}</natOp><mod>${mod}</mod><serie>${inv.series}</serie><nNF>${inv.number}</nNF><dhEmi>${(inv.authorizedAt || new Date()).toISOString()}</dhEmi><tpNF>${inv.direction === 'ENTRADA' ? 0 : 1}</tpNF><idDest>${inv.customerUf && inv.customerUf !== company.uf ? 2 : 1}</idDest><cMunFG>${esc(company.cityCode || '3550308')}</cMunFG><tpImp>${mod === 65 ? 4 : 1}</tpImp><tpEmis>1</tpEmis><cDV>${inv.accessKey?.slice(-1)}</cDV><tpAmb>2</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>${mod === 65 ? 1 : 2}</indPres><procEmi>0</procEmi><verProc>GestaoPro 1.0</verProc></ide><emit><CNPJ>${onlyDigits(company.cnpj)}</CNPJ><xNome>${esc(company.name)}</xNome><xFant>${esc(company.tradeName)}</xFant><enderEmit><xLgr>${esc(company.street)}</xLgr><nro>${esc(company.number)}</nro><xBairro>${esc(company.district)}</xBairro><xMun>${esc(company.city)}</xMun><UF>${company.uf}</UF><CEP>${onlyDigits(company.zip)}</CEP></enderEmit><IE>${esc(onlyDigits(company.ie))}</IE><CRT>${company.crt}</CRT></emit>${dest}${dets}<total><ICMSTot><vBC>${n2(inv.icmsBase)}</vBC><vICMS>${n2(inv.icmsValue)}</vICMS><vProd>${n2(inv.productsTotal)}</vProd><vFrete>${n2(inv.freight)}</vFrete><vDesc>${n2(inv.discount)}</vDesc><vIPI>${n2(inv.ipiValue)}</vIPI><vPIS>${n2(inv.pisValue)}</vPIS><vCOFINS>${n2(inv.cofinsValue)}</vCOFINS><vNF>${n2(inv.total)}</vNF><vTotTrib>${n2(inv.approxTaxes)}</vTotTrib></ICMSTot></total><transp><modFrete>${inv.freight ? 0 : 9}</modFrete></transp><pag><detPag><tPag>01</tPag><vPag>${n2(inv.total)}</vPag></detPag></pag><infAdic><infCpl>${esc(inv.additionalInfo)}</infCpl></infAdic></infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/><SignatureValue>SIMULADO</SignatureValue></Signature></NFe><protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SEFAZ-SIMULADA</verAplic><chNFe>${inv.accessKey}</chNFe><dhRecbto>${(inv.authorizedAt || new Date()).toISOString()}</dhRecbto><nProt>${inv.protocol}</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>`;
}
