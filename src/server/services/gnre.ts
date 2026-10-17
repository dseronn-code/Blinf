/**
 * GNRE — Guia Nacional de Recolhimento de Tributos Estaduais.
 * Ao autorizar NF-e interestadual com ICMS-ST, DIFAL ou FCP para UF onde a
 * empresa NÃO tem inscrição de substituto tributário (Company.ieSt), gera as
 * guias por UF/receita (100099 ST, 100102 DIFAL, 100129 FCP), o lote XML
 * (versão 2.00) e uma conta a pagar ligada à guia (origem GNRE).
 * Com fiscalProvider = SEFAZ o lote é enviado ao Portal GNRE (GnreLoteRecepcao
 * + GnreResultadoLote, com o certificado A1) e o código de barras vem do
 * retorno; nos demais casos o código de barras (padrão de arrecadação
 * FEBRABAN, iniciado por 8) é SIMULADO.
 */
import type { Company, Gnre, Invoice } from '@prisma/client';
import { prisma } from '@/lib/db';
import { onlyDigits, round2, randomDigits } from '@/lib/utils';
import { UF_CODES } from '@/lib/br';
import { fail } from '../errors';
import { onEvent } from '../events';
import { createEntries, payEntry, cancelEntriesByOrigin } from './finance';
import type { Actor } from './sales';
import { fiscalProviderOf } from './fiscal';
import { sefazCtx } from './sefaz/nfe';
import { soapCall } from './sefaz/soap';
import { gnreUrl } from './sefaz/urls';
import { localCityCode, resolveCityCode } from './sefaz/ibge';
import { NS, blocks, dUF, dec, tag, txt } from './sefaz/xml';

export const REVENUE: Record<string, string> = { '100099': 'ICMS Substituição Tributária por Operação', '100102': 'ICMS Consumidor Final Não Contribuinte (DIFAL - EC 87/15)', '100129': 'ICMS Fundo de Combate à Pobreza (FCP)' };

/** Guias devidas pela nota (uma por receita) */
export function gnreDue(company: Pick<Company, 'uf' | 'crt' | 'ieSt'>, inv: Pick<Invoice, 'customerUf' | 'icmsStValue' | 'difalValue' | 'fcpValue' | 'direction' | 'finalidade' | 'model'>) {
  const uf = inv.customerUf || company.uf;
  if (uf === company.uf || inv.direction !== 'SAIDA' || inv.finalidade !== 1 || inv.model !== 'NFE') return [];
  const ieSt = (company.ieSt || {}) as Record<string, string>;
  if (ieSt[uf]) return [];
  return [
    { revenueCode: '100099', amount: round2(inv.icmsStValue) },
    { revenueCode: '100102', amount: round2(inv.difalValue) },
    { revenueCode: '100129', amount: round2(inv.fcpValue) },
  ].filter((g) => g.amount > 0).map((g) => ({ ...g, uf }));
}

// ---------------------------------------------------------------------------
// Código de barras de arrecadação (FEBRABAN): 8 + segmento + id. valor + DV + valor(11) + órgão(4) + livre(25)
// ---------------------------------------------------------------------------
export function mod10Arrecadacao(s: string) {
  let sum = 0;
  let w = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    let p = Number(s[i]) * w;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    sum += p;
    w = w === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

/** Código de barras (44) e linha digitável (48) — segmento 5 (órgãos governamentais), valor efetivo com DV módulo 10 */
export function arrecadacaoBarcode(p: { amount: number; uf: string; dueDate: Date; revenueCode: string; ref: string }) {
  const value = String(Math.round(p.amount * 100)).padStart(11, '0').slice(-11);
  const org = `00${UF_CODES[p.uf] || '00'}`.slice(-4);
  const ymd = p.dueDate.toISOString().slice(0, 10).replace(/-/g, '');
  const free = `${ymd}${p.revenueCode.padStart(6, '0')}${onlyDigits(p.ref).padStart(11, '0').slice(-11)}`.slice(0, 25).padEnd(25, '0');
  const noDv = `856${value}${org}${free}`;
  const dv = mod10Arrecadacao(noDv);
  const barcode = `856${dv}${value}${org}${free}`;
  const parts = [0, 11, 22, 33].map((i) => barcode.slice(i, i + 11));
  const line = parts.map((b) => `${b}${mod10Arrecadacao(b)}`).join('');
  return { barcode, line, formatted: parts.map((b) => `${b}-${mod10Arrecadacao(b)}`).join(' ') };
}

export function validArrecadacao(barcode: string) {
  return barcode.length === 44 && barcode[0] === '8' && mod10Arrecadacao(barcode.slice(0, 3) + barcode.slice(4)) === Number(barcode[3]);
}

// ---------------------------------------------------------------------------
// Lote XML (TLote_GNRE versão 2.00)
// ---------------------------------------------------------------------------
type LoteGuia = { revenueCode: string; amount: number; uf: string; dueDate: Date };
/** Conferir na documentação: campos extras exigidos por UF (ex.: chave da NF-e) e tipo de documento de origem por receita */
export function buildGnreLote(company: Company, inv: Pick<Invoice, 'number' | 'accessKey' | 'customerName' | 'customerDoc'>, guias: LoteGuia[], o: { cityCode?: string | null; destCityCode?: string | null; destCity?: string | null } = {}) {
  const ibge5 = (c?: string | null) => (onlyDigits(c).length === 7 ? onlyDigits(c).slice(2) : '');
  const doc = onlyDigits(inv.customerDoc);
  const items = guias.map((g) => {
    const ref = `<referencia><periodo>0</periodo><mes>${String(g.dueDate.getMonth() + 1).padStart(2, '0')}</mes><ano>${g.dueDate.getFullYear()}</ano></referencia>`;
    const dest = doc ? `<contribuinteDestinatario><identificacao>${doc.length === 14 ? `<CNPJ>${doc}</CNPJ>` : `<CPF>${doc}</CPF>`}</identificacao><razaoSocial>${txt(inv.customerName, 60)}</razaoSocial>${ibge5(o.destCityCode) ? `<municipio>${ibge5(o.destCityCode)}</municipio>` : ''}</contribuinteDestinatario>` : '';
    // O código do campo extra "chave da NF-e" varia por UF (tabela do Portal GNRE): configure GNRE_CAMPO_CHAVE_<UF>
    const extraCode = process.env[`GNRE_CAMPO_CHAVE_${g.uf}`];
    const extra = inv.accessKey && extraCode ? `<camposExtras><campoExtra><codigo>${extraCode}</codigo><valor>${inv.accessKey}</valor></campoExtra></camposExtras>` : '';
    return `<item><receita>${g.revenueCode}</receita><documentoOrigem tipo="10">${inv.number}</documentoOrigem>${ref}<dataVencimento>${dUF(g.dueDate, company.uf)}</dataVencimento><valor tipo="11">${dec(g.amount)}</valor>${dest}${extra}</item>`;
  });
  const total = round2(guias.reduce((a, g) => a + g.amount, 0));
  const uf = guias[0]?.uf;
  const emitente = `<contribuinteEmitente><identificacao><CNPJ>${onlyDigits(company.cnpj)}</CNPJ></identificacao><razaoSocial>${txt(company.name, 60)}</razaoSocial><endereco>${txt(`${company.street || ''} ${company.number || ''}`.trim() || 'NAO INFORMADO', 60)}</endereco><municipio>${ibge5(o.cityCode || company.cityCode)}</municipio><uf>${company.uf}</uf>${onlyDigits(company.zip).length === 8 ? `<cep>${onlyDigits(company.zip)}</cep>` : ''}${onlyDigits(company.phone).length >= 10 ? `<telefone>${onlyDigits(company.phone).slice(0, 11)}</telefone>` : ''}</contribuinteEmitente>`;
  const dados = `<TDadosGNRE versao="2.00"><ufFavorecida>${uf}</ufFavorecida><tipoGnre>0</tipoGnre>${emitente}<itensGNRE>${items.join('')}</itensGNRE><valorGNRE>${dec(total)}</valorGNRE><dataPagamento>${dUF(guias[0]?.dueDate || new Date(), company.uf)}</dataPagamento></TDadosGNRE>`;
  return `<?xml version="1.0" encoding="UTF-8"?><TLote_GNRE xmlns="${NS.GNRE}" versao="2.00"><guias>${dados}</guias></TLote_GNRE>`;
}

const WS = 'http://www.gnre.pe.gov.br/webservice/';
const cabec = (service: string) => `<gnreCabecMsg xmlns="${WS}${service}"><versaoDados>2.00</versaoDados></gnreCabecMsg>`;

/** Envia o lote e consulta o resultado (código de barras/linha digitável) */
async function sendLote(company: Company, xml: string) {
  const ctx = sefazCtx(company);
  const recep = await soapCall({ provider: 'GNRE', companyId: company.id, url: gnreUrl('GnreLoteRecepcao', ctx.tpAmb), service: 'GnreLoteRecepcao', payload: xml, pfx: ctx.pfx, ns: `${WS}GnreLoteRecepcao`, dataTag: 'gnreDadosMsg', header: cabec('GnreLoteRecepcao') });
  const recibo = tag(tag(recep, 'recibo'), 'numero') || tag(recep, 'numeroRecibo');
  const sit = tag(tag(recep, 'situacaoRecepcao'), 'codigo') || '';
  if (!recibo) return { ok: false as const, message: `${sit} ${tag(tag(recep, 'situacaoRecepcao'), 'descricao') || 'Lote não recebido'}`.trim() };
  return consultLote(company, recibo);
}

export async function consultLote(company: Company, recibo: string) {
  const ctx = sefazCtx(company);
  const cons = `<TConsLote_GNRE xmlns="${NS.GNRE}"><ambiente>${ctx.tpAmb}</ambiente><numeroRecibo>${recibo}</numeroRecibo><incluirPDFGuias>N</incluirPDFGuias><incluirArquivoPagamento>N</incluirArquivoPagamento></TConsLote_GNRE>`;
  const body = await soapCall({ provider: 'GNRE', companyId: company.id, url: gnreUrl('GnreResultadoLote', ctx.tpAmb), service: 'GnreResultadoLote', payload: cons, pfx: ctx.pfx, ns: `${WS}GnreResultadoLote`, dataTag: 'gnreDadosMsg', header: cabec('GnreResultadoLote') });
  const code = tag(tag(body, 'situacaoProcess'), 'codigo') || '';
  const guias = blocks(body, 'guia').map((g) => ({ barcode: onlyDigits(tag(g, 'codigoBarras')), line: onlyDigits(tag(g, 'linhaDigitavel')), status: tag(g, 'situacaoGuia'), errors: blocks(g, 'motivosRejeicao').map((m) => tag(m, 'descricao')).filter(Boolean).join('; ') }));
  return { ok: true as const, recibo, processing: code === '400' || (!guias.length && code !== '402'), code, message: tag(tag(body, 'situacaoProcess'), 'descricao') || '', guias };
}

// ---------------------------------------------------------------------------
// Serviço
// ---------------------------------------------------------------------------
async function createGuias(company: Company, inv: Invoice, due: ReturnType<typeof gnreDue>, userName?: string) {
  const dueDate = new Date();
  const customer = inv.customerId ? await prisma.contact.findUnique({ where: { id: inv.customerId } }) : null;
  const destCityCode = customer?.city ? localCityCode(customer.uf, customer.city) || (await resolveCityCode(customer.uf, customer.city, { companyId: company.id, online: fiscalProviderOf(company) === 'SEFAZ' })) : null;
  const xml = buildGnreLote(company, inv, due.map((d) => ({ ...d, dueDate })), { destCityCode });
  const real = fiscalProviderOf(company) === 'SEFAZ';
  let result: Awaited<ReturnType<typeof sendLote>> | null = null;
  if (real) {
    try {
      result = await sendLote(company, xml);
    } catch (e) {
      result = { ok: false, message: (e as Error).message };
    }
  }
  const created: Gnre[] = [];
  for (const [idx, d] of due.entries()) {
    const ret = result?.ok ? result.guias[idx] : undefined;
    const sim = arrecadacaoBarcode({ amount: d.amount, uf: d.uf, dueDate, revenueCode: d.revenueCode, ref: `${inv.number}${randomDigits(3)}` });
    const barcode = real ? ret?.barcode || null : sim.barcode;
    const line = real ? ret?.line || null : sim.formatted;
    const reference = real ? (result?.ok ? `Recibo ${result.recibo}${ret?.errors ? ` — ${ret.errors}` : ''}` : `Falha no envio: ${result?.message}`) : 'Código de barras SIMULADO (sem envio ao Portal GNRE)';
    const g = await prisma.gnre.create({ data: { companyId: company.id, invoiceId: inv.id, uf: d.uf, revenueCode: d.revenueCode, amount: d.amount, dueDate, reference, barcode, line, status: barcode ? 'GERADA' : 'PENDENTE', xml } });
    await createEntries(prisma, {
      companyId: company.id, type: 'PAGAR', description: `GNRE ${d.uf} ${d.revenueCode} - NF-e ${inv.number}`, contactName: `SEFAZ-${d.uf}`, total: d.amount, firstDueDate: dueDate,
      origin: 'GNRE', originId: g.id, chartAccountCode: '2.6.01', paymentMethod: 'BOLETO', documentNumber: `GNRE-${inv.number}`, notes: `${REVENUE[d.revenueCode]}${line ? ` — linha digitável ${line}` : ''}`,
    });
    created.push(g);
  }
  await prisma.invoiceEvent.create({ data: { invoiceId: inv.id, type: 'GNRE', description: `GNRE gerada para ${due[0].uf}: ${due.map((d) => `${d.revenueCode} R$ ${d.amount.toFixed(2).replace('.', ',')}`).join(', ')}${real ? (result?.ok ? ` (recibo ${result.recibo})` : ` — envio ao Portal GNRE falhou: ${result?.message}`) : ' (código de barras simulado)'}${userName ? ` por ${userName}` : ''}` } });
  return created;
}

/** Chamado após a autorização da NF-e: só regime normal, sem IE de substituto na UF de destino */
export async function autoGnreForInvoice(companyId: string, _orgId: string, invoiceId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId } });
  if (!company || !inv || company.crt === 1) return [];
  const due = gnreDue(company, inv);
  if (!due.length) return [];
  if (await prisma.gnre.count({ where: { invoiceId, status: { not: 'CANCELADA' } } })) return [];
  return createGuias(company, inv, due);
}

/** Geração manual para uma nota (rota POST /api/gnre) */
export async function generateGnreForInvoice(actor: Actor, invoiceId: string) {
  const company = (await prisma.company.findUnique({ where: { id: actor.companyId } }))!;
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId: actor.companyId } });
  if (!inv) fail(404, 'Nota não encontrada');
  if (inv!.status !== 'AUTORIZADA') fail(400, 'Gere a GNRE de notas autorizadas');
  const ieSt = (company.ieSt || {}) as Record<string, string>;
  if (inv!.customerUf && ieSt[inv!.customerUf]) fail(400, `A empresa possui IE de substituto em ${inv!.customerUf} (${ieSt[inv!.customerUf]}) — o imposto é apurado e recolhido no mês, sem GNRE por operação`);
  const due = gnreDue(company, inv!);
  if (!due.length) fail(400, 'Esta nota não tem ICMS-ST, DIFAL ou FCP interestadual a recolher');
  if (await prisma.gnre.count({ where: { invoiceId, status: { not: 'CANCELADA' } } })) fail(400, 'Já existe GNRE para esta nota');
  return createGuias(company, inv!, due, actor.userName);
}

/** Consulta novamente o resultado do lote (guias pendentes no envio real) */
export async function refreshGnre(actor: Actor, id: string) {
  const g = await prisma.gnre.findFirst({ where: { id, companyId: actor.companyId } });
  if (!g) fail(404, 'Guia não encontrada');
  const recibo = g!.reference?.match(/Recibo (\d+)/)?.[1];
  if (!recibo) fail(400, 'Guia sem recibo do Portal GNRE');
  const company = (await prisma.company.findUnique({ where: { id: actor.companyId } }))!;
  const r = await consultLote(company, recibo!);
  if (r.processing) fail(400, 'Lote ainda em processamento no Portal GNRE — tente em alguns instantes');
  const siblings = await prisma.gnre.findMany({ where: { invoiceId: g!.invoiceId, reference: { contains: recibo! } }, orderBy: { createdAt: 'asc' } });
  for (const [i, s] of siblings.entries()) {
    const ret = r.guias[i];
    if (ret?.barcode) await prisma.gnre.update({ where: { id: s.id }, data: { barcode: ret.barcode, line: ret.line, status: s.status === 'PAGA' ? 'PAGA' : 'GERADA', reference: `Recibo ${recibo}` } });
    else if (ret?.errors) await prisma.gnre.update({ where: { id: s.id }, data: { reference: `Recibo ${recibo} — ${ret.errors}` } });
  }
  return prisma.gnre.findUnique({ where: { id } });
}

/** Baixa da guia (paga a conta a pagar vinculada) */
export async function payGnre(actor: Actor, id: string, input: { bankAccountId?: string | null; date?: string } = {}) {
  const g = await prisma.gnre.findFirst({ where: { id, companyId: actor.companyId } });
  if (!g) fail(404, 'Guia não encontrada');
  if (g!.status === 'PAGA') fail(400, 'Guia já paga');
  if (g!.status === 'CANCELADA') fail(400, 'Guia cancelada');
  const entry = await prisma.financialEntry.findFirst({ where: { companyId: actor.companyId, origin: 'GNRE', originId: id, status: { in: ['ABERTO', 'PARCIAL'] } } });
  const date = input.date ? new Date(input.date) : new Date();
  if (entry) await payEntry(actor.companyId, actor.orgId, entry.id, { bankAccountId: input.bankAccountId || null, date, method: 'BOLETO', userName: actor.userName });
  return prisma.gnre.update({ where: { id }, data: { status: 'PAGA', paidAt: date } });
}

/** Nota cancelada: cancela guias não pagas e as contas a pagar */
export async function cancelGnreForInvoice(companyId: string, invoiceId: string) {
  const list = await prisma.gnre.findMany({ where: { companyId, invoiceId, status: { in: ['PENDENTE', 'GERADA'] } } });
  for (const g of list) {
    await prisma.gnre.update({ where: { id: g.id }, data: { status: 'CANCELADA' } });
    await cancelEntriesByOrigin(prisma, companyId, ['GNRE'], g.id);
  }
  return list.length;
}

// Conta a pagar da GNRE baixada pelo financeiro → guia paga
onEvent(async (event, p) => {
  if (event !== 'payable.paid' || p.origin !== 'GNRE' || !p.originId) return;
  await prisma.gnre.updateMany({ where: { id: String(p.originId), status: { in: ['PENDENTE', 'GERADA'] } }, data: { status: 'PAGA', paidAt: new Date() } });
});
