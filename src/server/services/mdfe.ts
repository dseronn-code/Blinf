/**
 * MDF-e — Manifesto Eletrônico de Documentos Fiscais (modelo 58, versão 3.00),
 * modal rodoviário, emitente de carga própria (tpEmit 2) a partir de NF-e
 * autorizadas. XML assinado, transmissão síncrona (MDFeRecepcaoSinc na SVRS,
 * XML compactado GZip+Base64), encerramento (110112) e cancelamento (110111).
 * Conforme Company.fiscalProvider: simulação, SEFAZ direta ou Focus NFe.
 */
import type { Company, Mdfe } from '@prisma/client';
import { prisma } from '@/lib/db';
import { onlyDigits, randomDigits, round2 } from '@/lib/utils';
import { UF_CODES, UFS, isValidCPF, isValidAccessKey } from '@/lib/br';
import { fail } from '../errors';
import { nextNumber } from '../sequence';
import { getAccount } from '@/server/integrations/accounts';
import { focusEmit, focusGet, focusCancel, focusMdfeClose, focusMdfePayload, focusDownload, type FocusResult } from '@/server/integrations/providers/focusnfe';
import type { Actor } from './sales';
import { fiscalProviderOf } from './fiscal';
import { sefazCtx, type SefazCtx } from './sefaz/nfe';
import { soapCall } from './sefaz/soap';
import { mdfeUrl } from './sefaz/urls';
import { resolveCityCode, localCityCode } from './sefaz/ibge';
import { NS, block, dUF, dec, dfeKey, dhUF, esc, gzipB64, signInf, stripDecl, tag, txt } from './sefaz/xml';

type MdfeEvent = { type: string; code?: string | null; protocol?: string | null; description: string; at: string };

/**
 * Dados complementares do MDF-e que não têm coluna própria no schema. Ficam num item de Mdfe.events com
 * type 'DADOS' (sempre o primeiro da lista; telas e contagens de eventos o ignoram):
 * - loadCity/loadCityCode e unloadCity/unloadCityCode continuam sendo o PRIMEIRO município;
 * - extraLoads: municípios de carregamento adicionais (infMunCarrega, todos na UFIni);
 * - unloads: lista completa de municípios de descarregamento (o 1º = unloadCity) com as chaves das NF-e
 *   descarregadas em cada um (infMunDescarga/infNFe, todos na UFFim);
 * - veículo: tpRod (01..06), tpCar (00..05), capacidade em kg/m³ e reboques (veicReboque, até 3).
 */
export type MdfeCity = { city: string; code: string };
export type MdfeTrailer = { plate: string; tara: number; capKG: number; capM3?: number | null; tpCar: string; uf: string };
export type MdfeDados = {
  type: 'DADOS'; description: string; at: string;
  extraLoads: MdfeCity[]; unloads: (MdfeCity & { keys: string[] })[];
  tpRod: string; tpCar: string; capKG?: number | null; capM3?: number | null; trailers: MdfeTrailer[];
};
export const TP_ROD: Record<string, string> = { '01': 'Truck', '02': 'Toco', '03': 'Cavalo mecânico', '04': 'VAN', '05': 'Utilitário', '06': 'Outros' };
export const TP_CAR: Record<string, string> = { '00': 'Não aplicável', '01': 'Aberta', '02': 'Fechada/Baú', '03': 'Granelera', '04': 'Porta contêiner', '05': 'Sider' };

/** Dados complementares resolvidos (com padrões para manifestos antigos, sem o item DADOS) */
export function mdfeDados(m: Pick<Mdfe, 'events' | 'loadCity' | 'loadCityCode' | 'unloadCity' | 'unloadCityCode' | 'invoiceKeys'>) {
  const d = ((m.events as any[]) || []).find((e) => e?.type === 'DADOS') as MdfeDados | undefined;
  const loads: MdfeCity[] = [{ city: m.loadCity, code: m.loadCityCode }, ...(d?.extraLoads || [])];
  let unloads = (d?.unloads?.length ? d.unloads : [{ city: m.unloadCity, code: m.unloadCityCode, keys: [] }]).map((u) => ({ ...u, keys: u.keys.filter((k) => m.invoiceKeys.includes(k)) }));
  // NF-e sem município atribuído vão para o primeiro
  const orphan = m.invoiceKeys.filter((k) => !unloads.some((u) => u.keys.includes(k)));
  if (orphan.length) unloads = unloads.map((u, i) => (i === 0 ? { ...u, keys: [...u.keys, ...orphan] } : u));
  return { loads, unloads: unloads.filter((u, i) => i === 0 || u.keys.length), tpRod: d?.tpRod || '06', tpCar: d?.tpCar || '02', capKG: d?.capKG || null, capM3: d?.capM3 || null, trailers: d?.trailers || [] };
}
const realEvents = (m: Pick<Mdfe, 'events'>) => ((m.events as MdfeEvent[]) || []).filter((e) => e?.type !== 'DADOS');
const WS = 'http://www.portalfiscal.inf.br/mdfe/wsdl/';

export const mdfeQrUrl = (key: string, tpAmb: number) => `https://dfe-portal.svrs.rs.gov.br/mdfe/qrCode?chMDFe=${key}&tpAmb=${tpAmb}`;

/** Chave do MDF-e (44 dígitos, modelo 58) */
export const mdfeKey = (company: Pick<Company, 'uf' | 'cnpj'>, m: Pick<Mdfe, 'series' | 'number'>, date: Date, code = randomDigits(8), tpEmis = 1) =>
  dfeKey({ cUF: UF_CODES[company.uf] || '35', date, cnpj: company.cnpj, mod: 58, series: m.series, number: m.number, tpEmis, code });

const plateOk = (p: string) => /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(p.replace(/\W/g, '').toUpperCase());

/** XML do MDF-e (sem protocolo). Assina quando a empresa tem certificado. */
export function buildMdfeXml(m: Mdfe, company: Company, o: { tpAmb: 1 | 2; key: string; dhEmi: Date }) {
  const uf = company.uf;
  const d = mdfeDados(m);
  const carrega = d.loads.map((l) => `<infMunCarrega><cMunCarrega>${l.code}</cMunCarrega><xMunCarrega>${txt(l.city, 60)}</xMunCarrega></infMunCarrega>`).join('');
  const percurso = m.route.filter((u) => u && u !== m.ufStart && u !== m.ufEnd).map((u) => `<infPercurso><UFPer>${u}</UFPer></infPercurso>`).join('');
  const ide = `<ide><cUF>${UF_CODES[uf]}</cUF><tpAmb>${o.tpAmb}</tpAmb><tpEmit>2</tpEmit><mod>58</mod><serie>${m.series}</serie><nMDF>${m.number}</nMDF><cMDF>${o.key.slice(35, 43)}</cMDF><cDV>${o.key.slice(-1)}</cDV><modal>1</modal><dhEmi>${dhUF(o.dhEmi, uf)}</dhEmi><tpEmis>1</tpEmis><procEmi>0</procEmi><verProc>GestaoPro 2.0</verProc><UFIni>${m.ufStart}</UFIni><UFFim>${m.ufEnd}</UFFim>${carrega}${percurso}</ide>`;
  // Conferir na documentação: em homologação o xNome do emitente deve ser o texto padrão de ambiente de testes
  const emit = `<emit><CNPJ>${onlyDigits(company.cnpj)}</CNPJ><IE>${onlyDigits(company.ie)}</IE><xNome>${o.tpAmb === 2 ? 'MDF-E EMITIDO EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : txt(company.name, 60)}</xNome>${company.tradeName ? `<xFant>${txt(company.tradeName, 60)}</xFant>` : ''}<enderEmit><xLgr>${txt(company.street || 'NAO INFORMADO', 60)}</xLgr><nro>${txt(company.number || 'S/N', 60)}</nro><xBairro>${txt(company.district || 'NAO INFORMADO', 60)}</xBairro><cMun>${onlyDigits(company.cityCode) || localCityCode(uf, company.city) || '3550308'}</cMun><xMun>${txt(company.city || 'NAO INFORMADO', 60)}</xMun>${onlyDigits(company.zip).length === 8 ? `<CEP>${onlyDigits(company.zip)}</CEP>` : ''}<UF>${uf}</UF></enderEmit></emit>`;
  const rntrc = onlyDigits(m.rntrc);
  const cap = (kg?: number | null, m3?: number | null) => `${kg ? `<capKG>${Math.round(kg)}</capKG>` : ''}${m3 ? `<capM3>${Math.round(m3)}</capM3>` : ''}`;
  const reboques = d.trailers.slice(0, 3).map((t) => `<veicReboque><placa>${t.plate.replace(/\W/g, '').toUpperCase()}</placa><tara>${Math.round(t.tara)}</tara><capKG>${Math.round(t.capKG || 0)}</capKG>${t.capM3 ? `<capM3>${Math.round(t.capM3)}</capM3>` : ''}<tpCar>${t.tpCar}</tpCar><UF>${t.uf}</UF></veicReboque>`).join('');
  const rodo = `<infModal versaoModal="3.00"><rodo>${rntrc ? `<infANTT><RNTRC>${rntrc.padStart(8, '0').slice(-8)}</RNTRC></infANTT>` : ''}<veicTracao><placa>${m.vehiclePlate.replace(/\W/g, '').toUpperCase()}</placa><tara>${Math.round(m.vehicleTara)}</tara>${cap(d.capKG, d.capM3)}<condutor><xNome>${txt(m.driverName, 60)}</xNome><CPF>${onlyDigits(m.driverCpf)}</CPF></condutor><tpRod>${d.tpRod}</tpRod><tpCar>${d.tpCar}</tpCar><UF>${m.vehicleUf}</UF></veicTracao>${reboques}</rodo></infModal>`;
  const docs = `<infDoc>${d.unloads.map((u) => `<infMunDescarga><cMunDescarga>${u.code}</cMunDescarga><xMunDescarga>${txt(u.city, 60)}</xMunDescarga>${u.keys.map((k) => `<infNFe><chNFe>${k}</chNFe></infNFe>`).join('')}</infMunDescarga>`).join('')}</infDoc>`;
  // Conferir na documentação: grupo prodPred (NT 2021.001) e infLotacao para carga lotação
  const prodPred = '<prodPred><tpCarga>05</tpCarga><xProd>MERCADORIAS DIVERSAS</xProd></prodPred>';
  const tot = `<tot><qNFe>${m.invoiceKeys.length}</qNFe><vCarga>${dec(m.totalValue)}</vCarga><cUnid>01</cUnid><qCarga>${dec(m.totalWeight, 4)}</qCarga></tot>`;
  const id = `MDFe${o.key}`;
  const inf = `<infMDFe Id="${id}" versao="3.00">${ide}${emit}${rodo}${docs}${prodPred}${tot}<infAdic><infCpl>${txt(`MDF-e ${m.number} - ${m.invoiceKeys.length} NF-e`, 5000)}</infCpl></infAdic></infMDFe>`;
  let signature = '';
  if (company.certPfx && company.certPassword) {
    try {
      signature = signInf(inf, 'infMDFe', NS.MDFE, Buffer.from(company.certPfx), company.certPassword);
    } catch (e) {
      console.error('[assinatura MDF-e]', (e as Error).message);
    }
  }
  const supl = `<infMDFeSupl><qrCodMDFe>${esc(mdfeQrUrl(o.key, o.tpAmb))}</qrCodMDFe></infMDFeSupl>`;
  const xml = `<MDFe xmlns="${NS.MDFE}">${inf}${supl}${signature}</MDFe>`;
  return { id, inf, signature, signed: !!signature, xml };
}

/** Evento do MDF-e assinado (encerramento 110112 / cancelamento 110111) */
export function buildMdfeEvent(ctx: Pick<SefazCtx, 'cUF' | 'tpAmb' | 'cnpj' | 'uf' | 'pfx'>, e: { chMDFe: string; tpEvento: '110111' | '110112'; det: string; seq?: number; date?: Date }) {
  const seq = e.seq || 1;
  const id = `ID${e.tpEvento}${e.chMDFe}${String(seq).padStart(2, '0')}`;
  const inf = `<infEvento Id="${id}"><cOrgao>${ctx.cUF}</cOrgao><tpAmb>${ctx.tpAmb}</tpAmb><CNPJ>${ctx.cnpj}</CNPJ><chMDFe>${e.chMDFe}</chMDFe><dhEvento>${dhUF(e.date || new Date(), ctx.uf)}</dhEvento><tpEvento>${e.tpEvento}</tpEvento><nSeqEvento>${seq}</nSeqEvento><detEvento versaoEvento="3.00">${e.det}</detEvento></infEvento>`;
  const signature = signInf(inf, 'infEvento', NS.MDFE, ctx.pfx.data, ctx.pfx.password);
  return { id, xml: `<eventoMDFe xmlns="${NS.MDFE}" versao="3.00">${inf}${signature}</eventoMDFe>` };
}
export const detEncerramento = (nProt: string, dtEnc: string, cUF: string, cMun: string) => `<evEncMDFe><descEvento>Encerramento</descEvento><nProt>${nProt}</nProt><dtEnc>${dtEnc}</dtEnc><cUF>${cUF}</cUF><cMun>${cMun}</cMun></evEncMDFe>`;
export const detCancelamentoMdfe = (nProt: string, xJust: string) => `<evCancMDFe><descEvento>Cancelamento</descEvento><nProt>${nProt}</nProt><xJust>${txt(xJust, 255)}</xJust></evCancMDFe>`;

const cabec = (service: string, cUF: string) => `<mdfeCabecMsg xmlns="${WS}${service}"><cUF>${cUF}</cUF><versaoDados>3.00</versaoDados></mdfeCabecMsg>`;

/** Leitura do retMDFe / retEventoMDFe */
export function parseRetMdfe(body: string) {
  const ret = block(body, 'retMDFe') || body;
  const prot = block(ret, 'protMDFe');
  const inf = prot ? tag(prot, 'infProt') || prot : ret;
  const cStat = tag(inf, 'cStat') || tag(ret, 'cStat') || '';
  return { ok: cStat === '100', cStat, xMotivo: tag(inf, 'xMotivo') || tag(ret, 'xMotivo') || '', nProt: tag(inf, 'nProt'), dhRecbto: tag(inf, 'dhRecbto'), protXml: prot };
}
export function parseRetEventoMdfe(body: string) {
  const ret = block(body, 'retEventoMDFe') || body;
  const cStat = tag(ret, 'cStat') || '';
  return { ok: ['135', '136'].includes(cStat), cStat, xMotivo: tag(ret, 'xMotivo') || '', nProt: tag(ret, 'nProt') };
}

// ---------------------------------------------------------------------------
// Serviço
// ---------------------------------------------------------------------------
export type CreateMdfeInput = {
  invoiceIds?: string[]; invoiceKeys?: string[];
  vehiclePlate: string; vehicleTara: number; vehicleUf: string; rntrc?: string | null;
  driverName: string; driverCpf: string; route?: string[];
  ufStart?: string; ufEnd?: string; loadCity?: string; loadCityCode?: string; unloadCity?: string; unloadCityCode?: string;
  /** Lista completa de municípios de carregamento (o 1º substitui loadCity) */
  loads?: { city: string; code?: string | null }[];
  /** Municípios de descarregamento com as NF-e (ids ou chaves) descarregadas em cada um; vazio = agrupa pela cidade do destinatário */
  unloads?: { city: string; code?: string | null; invoiceIds?: string[]; invoiceKeys?: string[] }[];
  tpRod?: string; tpCar?: string; capKG?: number | null; capM3?: number | null;
  trailers?: { plate: string; tara?: number; capKG?: number; capM3?: number | null; tpCar?: string; uf?: string }[];
};

export async function createMdfe(actor: Actor, input: CreateMdfeInput) {
  const company = (await prisma.company.findUnique({ where: { id: actor.companyId } }))!;
  const or = [...(input.invoiceIds?.length ? [{ id: { in: input.invoiceIds } }] : []), ...(input.invoiceKeys?.length ? [{ accessKey: { in: input.invoiceKeys.map(onlyDigits) } }] : [])];
  if (!or.length) fail(400, 'Selecione ao menos uma NF-e autorizada');
  const invoices = await prisma.invoice.findMany({ where: { companyId: actor.companyId, model: 'NFE', status: 'AUTORIZADA', OR: or }, include: { items: true } });
  if (!invoices.length) fail(400, 'Nenhuma NF-e autorizada encontrada entre as selecionadas');
  const keys = invoices.map((i) => i.accessKey!).filter((k) => k && isValidAccessKey(k));
  // NF-e já vinculada a manifesto não encerrado
  const busy = await prisma.mdfe.findFirst({ where: { companyId: actor.companyId, status: { in: ['RASCUNHO', 'AUTORIZADO', 'PROCESSANDO'] }, invoiceKeys: { hasSome: keys } } });
  if (busy) fail(400, `NF-e já vinculada ao MDF-e nº ${busy.number} (encerre ou cancele o manifesto antes)`);
  const plate = String(input.vehiclePlate || '').replace(/\W/g, '').toUpperCase();
  if (!plateOk(plate)) fail(400, 'Placa inválida (use o padrão AAA9999 ou Mercosul AAA9A99)');
  if (!isValidCPF(input.driverCpf || '')) fail(400, 'CPF do condutor inválido');
  if (!input.driverName?.trim()) fail(400, 'Informe o nome do condutor');
  const vehicleUf = (input.vehicleUf || company.uf).toUpperCase();
  const route = (input.route || []).map((u) => u.toUpperCase()).filter((u) => UFS.includes(u));
  const destUfs = [...new Set(invoices.map((i) => i.customerUf || company.uf))];
  const ufEnd = (input.ufEnd || destUfs[0]).toUpperCase();
  if (!input.ufEnd && destUfs.length > 1) fail(400, `As NF-e têm destinos em UFs diferentes (${destUfs.join(', ')}) — emita um MDF-e por UF de descarregamento`);
  const ufStart = (input.ufStart || company.uf).toUpperCase();
  if (![ufStart, ufEnd, vehicleUf, ...route].every((u) => UFS.includes(u))) fail(400, 'UF inválida');
  const resolve = async (uf: string, city: string, code?: string | null) => onlyDigits(code) || (await resolveCityCode(uf, city, { companyId: company.id, online: true })) || '';
  // Municípios de carregamento (padrão: cidade da empresa), todos na UF de início
  const loadInput = (input.loads || []).filter((l) => l?.city?.trim());
  const loads: MdfeCity[] = [];
  if (loadInput.length) for (const l of loadInput) loads.push({ city: l.city.trim(), code: await resolve(ufStart, l.city.trim(), l.code) });
  else {
    const city = input.loadCity || company.city || '';
    loads.push({ city, code: onlyDigits(input.loadCityCode) || (input.loadCity ? await resolve(ufStart, input.loadCity) : onlyDigits(company.cityCode)) || '' });
  }
  for (const l of loads) if (!l.city || l.code.length !== 7) fail(400, `Informe o código IBGE (7 dígitos) do município de carregamento ${l.city || ''}`.trim());
  if (new Set(loads.map((l) => l.code)).size !== loads.length) fail(400, 'Município de carregamento repetido');
  if (loads.length > 50) fail(400, 'Máximo de 50 municípios de carregamento');
  // Municípios de descarregamento, cada NF-e associada ao seu (infMunDescarga)
  const keyOf = new Map(invoices.map((i) => [i.id, i.accessKey!]));
  const unloads: (MdfeCity & { keys: string[] })[] = [];
  const addUnload = async (city: string, code: string | null | undefined, ks: string[]) => {
    const found = unloads.find((u) => u.city.trim().toLowerCase() === city.trim().toLowerCase());
    if (found) found.keys.push(...ks.filter((k) => !found.keys.includes(k)));
    else unloads.push({ city: city.trim(), code: await resolve(ufEnd, city.trim(), code), keys: [...new Set(ks)] });
  };
  for (const u of (input.unloads || []).filter((u) => u?.city?.trim())) {
    const ks = [...(u.invoiceIds || []).map((id) => keyOf.get(id) || ''), ...(u.invoiceKeys || []).map(onlyDigits)].filter((k) => keys.includes(k));
    const dup = ks.find((k) => unloads.some((x) => x.keys.includes(k)));
    if (dup) fail(400, `A NF-e ${dup} foi associada a mais de um município de descarregamento`);
    await addUnload(u.city, u.code, ks);
  }
  // NF-e sem município informado: município padrão (unloadCity) ou a cidade do destinatário de cada nota
  const rest = keys.filter((k) => !unloads.some((u) => u.keys.includes(k)));
  if (rest.length && (input.unloadCity || input.unloadCityCode)) await addUnload(input.unloadCity || '', input.unloadCityCode, rest);
  else if (rest.length) {
    const contacts = new Map((await prisma.contact.findMany({ where: { id: { in: invoices.map((i) => i.customerId).filter(Boolean) as string[] } }, select: { id: true, city: true } })).map((c) => [c.id, c.city || '']));
    for (const inv of invoices.filter((i) => rest.includes(i.accessKey!))) await addUnload(contacts.get(inv.customerId || '') || '', null, [inv.accessKey!]);
  }
  for (const u of unloads) if (u.keys.length && (!u.city || u.code.length !== 7)) fail(400, u.city ? `Informe o código IBGE (7 dígitos) do município de descarregamento ${u.city}` : 'Informe o município de descarregamento (destinatário sem cidade no cadastro)');
  const unloadList = unloads.filter((u) => u.keys.length);
  if (!unloadList.length) fail(400, 'Nenhuma NF-e com chave de acesso válida');
  if (new Set(unloadList.map((u) => u.code)).size !== unloadList.length) fail(400, 'Município de descarregamento repetido — agrupe as NF-e no mesmo município');
  // Veículo: rodado, carroceria, capacidade e reboques
  const tpRod = input.tpRod || '06', tpCar = input.tpCar || '02';
  if (!TP_ROD[tpRod]) fail(400, 'Tipo de rodado inválido (01 a 06)');
  if (!TP_CAR[tpCar]) fail(400, 'Tipo de carroceria inválido (00 a 05)');
  const trailers: MdfeTrailer[] = (input.trailers || []).filter((t) => t?.plate?.trim()).map((t) => ({ plate: t.plate.replace(/\W/g, '').toUpperCase(), tara: Math.round(Number(t.tara) || 0), capKG: Math.round(Number(t.capKG) || 0), capM3: Number(t.capM3) || null, tpCar: t.tpCar || '02', uf: (t.uf || vehicleUf).toUpperCase() }));
  if (trailers.length > 3) fail(400, 'Máximo de 3 reboques');
  for (const t of trailers) {
    if (!plateOk(t.plate)) fail(400, `Placa do reboque inválida: ${t.plate}`);
    if (!t.capKG) fail(400, `Informe a capacidade (kg) do reboque ${t.plate}`);
    if (!TP_CAR[t.tpCar] || !UFS.includes(t.uf)) fail(400, `Carroceria ou UF do reboque ${t.plate} inválida`);
  }
  // Peso bruto: soma de quantidade × peso do produto (kg)
  const productIds = [...new Set(invoices.flatMap((i) => i.items.map((it) => it.productId).filter(Boolean) as string[]))];
  const weights = new Map((await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, weight: true } })).map((p) => [p.id, p.weight]));
  const totalWeight = Math.round(invoices.reduce((a, i) => a + i.items.reduce((b, it) => b + it.quantity * (weights.get(it.productId || '') || 0), 0), 0) * 10000) / 10000;
  const totalValue = round2(invoices.reduce((a, i) => a + i.total, 0));
  const number = await nextNumber(prisma, actor.companyId, 'MDFE-1', 1);
  const now = new Date().toISOString();
  const dados: MdfeDados = {
    type: 'DADOS', at: now, description: `${loads.length} município(s) de carregamento, ${unloadList.length} de descarregamento, ${trailers.length} reboque(s)`,
    extraLoads: loads.slice(1), unloads: unloadList, tpRod, tpCar, capKG: Number(input.capKG) || null, capM3: Number(input.capM3) || null, trailers,
  };
  const events: (MdfeEvent | MdfeDados)[] = [dados, { type: 'CRIACAO', description: `Manifesto criado por ${actor.userName || 'usuário'} com ${keys.length} NF-e`, at: now }];
  return prisma.mdfe.create({
    data: {
      companyId: actor.companyId, number, series: 1, status: 'RASCUNHO', environment: company.fiscalProvider !== 'SIMULADO' && company.nfeEnvironment === 1 ? 1 : 2,
      ufStart, ufEnd, route, loadCity: loads[0].city, loadCityCode: loads[0].code, unloadCity: unloadList[0].city, unloadCityCode: unloadList[0].code, vehiclePlate: plate, vehicleTara: Math.round(Number(input.vehicleTara) || 0), vehicleUf,
      rntrc: onlyDigits(input.rntrc) || null, driverName: input.driverName.trim(), driverCpf: onlyDigits(input.driverCpf), invoiceKeys: keys, totalValue, totalWeight, events: events as any,
    },
  });
}

async function getMdfe(companyId: string, id: string) {
  const m = await prisma.mdfe.findFirst({ where: { id, companyId } });
  if (!m) fail(404, 'MDF-e não encontrado');
  return m!;
}
async function pushEvent(m: Mdfe, ev: Omit<MdfeEvent, 'at'>, data: Partial<Mdfe> = {}) {
  const events = [...((m.events as MdfeEvent[]) || []), { ...ev, at: new Date().toISOString() }];
  return prisma.mdfe.update({ where: { id: m.id }, data: { ...(data as object), events } });
}

/** Transmite o MDF-e (simulação, SEFAZ/SVRS ou Focus NFe) */
export async function transmitMdfe(actor: Actor, id: string) {
  const m = await getMdfe(actor.companyId, id);
  if (!['RASCUNHO', 'REJEITADO', 'PROCESSANDO'].includes(m.status)) fail(400, `MDF-e está ${m.status}`);
  const company = (await prisma.company.findUnique({ where: { id: actor.companyId } }))!;
  const provider = fiscalProviderOf(company);
  if (provider === 'FOCUS_NFE') return transmitFocusMdfe(company, m);
  const tpAmb: 1 | 2 = provider === 'SEFAZ' && company.nfeEnvironment === 1 ? 1 : 2;
  const now = new Date();
  const key = m.accessKey && m.status === 'REJEITADO' && m.accessKey.slice(2, 6) === mdfeKey(company, m, now).slice(2, 6) ? m.accessKey : mdfeKey(company, m, now);
  const built = buildMdfeXml(m, company, { tpAmb, key, dhEmi: now });
  if (provider === 'SIMULADO') {
    if (!company.ie) return pushEvent(m, { type: 'REJEICAO', code: '209', description: '209 - Rejeição: IE do emitente inválida' }, { status: 'REJEITADO', rejection: 'IE do emitente inválida', accessKey: key });
    const protocol = `9${UF_CODES[company.uf] || '35'}${String(now.getFullYear()).slice(2)}${randomDigits(10)}`;
    const prot = `<protMDFe versao="3.00"><infProt><tpAmb>${tpAmb}</tpAmb><verAplic>SEFAZ-SIMULADA</verAplic><chMDFe>${key}</chMDFe><dhRecbto>${dhUF(now, company.uf)}</dhRecbto><nProt>${protocol}</nProt><cStat>100</cStat><xMotivo>Autorizado o uso do MDF-e</xMotivo></infProt></protMDFe>`;
    return pushEvent(m, { type: 'AUTORIZACAO', code: '100', protocol, description: `100 - Autorizado o uso do MDF-e (simulação${built.signed ? ', XML assinado' : ''})` }, { status: 'AUTORIZADO', accessKey: key, protocol, issueDate: now, environment: tpAmb, rejection: null, xml: mdfeProc(built.xml, prot) });
  }
  const ctx = sefazCtx(company, tpAmb);
  if (!built.signed) fail(400, 'Não foi possível assinar o MDF-e com o certificado instalado');
  await prisma.mdfe.update({ where: { id: m.id }, data: { accessKey: key, environment: tpAmb, xml: built.xml } });
  let r;
  try {
    const body = await soapCall({ provider: 'SEFAZ', companyId: company.id, url: mdfeUrl('MDFeRecepcaoSinc', tpAmb), service: 'MDFeRecepcaoSinc', payload: gzipB64(built.xml), pfx: ctx.pfx, ns: `${WS}MDFeRecepcaoSinc`, dataTag: 'mdfeDadosMsg', header: cabec('MDFeRecepcaoSinc', ctx.cUF) });
    r = parseRetMdfe(body);
  } catch (e) {
    return pushEvent(m, { type: 'REJEICAO', code: 'COMUNICACAO', description: `Falha de comunicação com a SEFAZ: ${(e as Error).message}` }, { status: 'REJEITADO', rejection: (e as Error).message, accessKey: key });
  }
  if (!r.ok || !r.protXml) return pushEvent(m, { type: 'REJEICAO', code: r.cStat, description: `${r.cStat} - ${r.xMotivo}` }, { status: 'REJEITADO', rejection: `${r.cStat} - ${r.xMotivo}`, accessKey: key });
  return pushEvent(m, { type: 'AUTORIZACAO', code: r.cStat, protocol: r.nProt, description: `${r.cStat} - ${r.xMotivo}` }, { status: 'AUTORIZADO', protocol: r.nProt, issueDate: now, rejection: null, xml: mdfeProc(built.xml, r.protXml) });
}

const mdfeProc = (mdfe: string, prot: string) => `<?xml version="1.0" encoding="UTF-8"?><mdfeProc xmlns="${NS.MDFE}" versao="3.00">${stripDecl(mdfe)}${prot}</mdfeProc>`;

async function focusAcc(companyId: string) {
  const acc = await getAccount(companyId, 'FOCUS_NFE');
  if (!acc) fail(400, 'Conecte a conta Focus NFe em Integrações → Contas e credenciais');
  return acc!;
}

/** Payload da Focus com os vários municípios, rodado/carroceria, capacidade e reboques */
function focusPayload(m: Mdfe, company: Company) {
  const p: any = focusMdfePayload(m, company);
  const d = mdfeDados(m);
  p.municipios_carregamento = d.loads.map((l) => ({ codigo: l.code, nome: l.city }));
  p.municipios_descarregamento = d.unloads.map((u) => ({ codigo: u.code, nome: u.city, notas_fiscais: u.keys.map((chave_nfe) => ({ chave_nfe })) }));
  // Conferir na documentação: nomes de capacidade/reboques no MDF-e da Focus
  Object.assign(p.modal_rodoviario.veiculo_tracao, { tipo_rodado: d.tpRod, tipo_carroceria: d.tpCar, ...(d.capKG ? { capacidade_kg: d.capKG } : {}), ...(d.capM3 ? { capacidade_m3: d.capM3 } : {}) });
  if (d.trailers.length) p.modal_rodoviario.veiculos_reboque = d.trailers.map((t) => ({ placa: t.plate, tara: t.tara, capacidade_kg: t.capKG, ...(t.capM3 ? { capacidade_m3: t.capM3 } : {}), tipo_carroceria: t.tpCar, uf: t.uf }));
  return p;
}

async function transmitFocusMdfe(company: Company, m: Mdfe) {
  const acc = await focusAcc(company.id);
  const ref = `mdfe_${m.id}`;
  let r: FocusResult = m.status === 'PROCESSANDO' ? await focusGet(acc, 'MDFE', ref) : await focusEmit(acc, 'MDFE', ref, focusPayload(m, company));
  for (let i = 0; r.status === 'PROCESSANDO' && i < 3; i++) {
    await new Promise((ok) => setTimeout(ok, Number(process.env.FOCUS_POLL_MS ?? 1500)));
    r = await focusGet(acc, 'MDFE', ref);
  }
  return applyFocusMdfe(m, r, acc);
}

async function applyFocusMdfe(m: Mdfe, r: FocusResult, acc: Awaited<ReturnType<typeof focusAcc>>) {
  if (r.status === 'AUTORIZADA') {
    const xml = r.xmlPath ? await focusDownload(acc, r.xmlPath).catch(() => null) : null;
    return pushEvent(m, { type: 'AUTORIZACAO', code: r.cStat || '100', protocol: r.protocol, description: `${r.cStat || '100'} - ${r.xMotivo || 'Autorizado'} (via Focus NFe)` }, { status: 'AUTORIZADO', accessKey: r.accessKey || m.accessKey, protocol: r.protocol || tag(xml, 'nProt'), xml: xml || m.xml, environment: acc.environment === 'PRODUCAO' ? 1 : 2, rejection: null, issueDate: new Date() });
  }
  if (r.status === 'PROCESSANDO') return pushEvent(m, { type: 'TRANSMISSAO', description: 'Em processamento na Focus NFe' }, { status: 'PROCESSANDO' });
  if (r.status === 'CANCELADA') return pushEvent(m, { type: 'CANCELAMENTO', description: 'Cancelado (Focus NFe)' }, { status: 'CANCELADO' });
  return pushEvent(m, { type: 'REJEICAO', code: r.cStat, description: r.xMotivo }, { status: 'REJEITADO', rejection: r.xMotivo });
}

/** Gatilho da Focus para MDF-e */
export async function applyMdfeProviderUpdate(companyId: string, id: string, body: any) {
  const m = await prisma.mdfe.findFirst({ where: { id, companyId } });
  if (!m) return 'MDF-e não encontrado';
  if (m.status !== 'PROCESSANDO') return `MDF-e já está ${m.status}`;
  const { parseFocus } = await import('@/server/integrations/providers/focusnfe');
  await applyFocusMdfe(m, parseFocus(body), await focusAcc(companyId));
  return `MDF-e ${m.number} atualizado`;
}

export async function refreshPendingMdfe(companyId: string) {
  const list = await prisma.mdfe.findMany({ where: { companyId, status: 'PROCESSANDO' }, take: 10 });
  if (!list.length) return 0;
  const acc = await getAccount(companyId, 'FOCUS_NFE');
  if (!acc) return 0;
  let n = 0;
  for (const m of list) {
    const r = await focusGet(acc, 'MDFE', `mdfe_${m.id}`);
    if (r.status !== 'PROCESSANDO') { await applyFocusMdfe(m, r, acc); n++; }
  }
  return n;
}

async function sendMdfeEvent(company: Company, m: Mdfe, tpEvento: '110111' | '110112', det: string) {
  const ctx = sefazCtx(company, m.environment === 1 ? 1 : 2);
  const seq = realEvents(m).filter((e) => e.type === (tpEvento === '110112' ? 'ENCERRAMENTO' : 'CANCELAMENTO')).length + 1;
  const ev = buildMdfeEvent(ctx, { chMDFe: m.accessKey!, tpEvento, det, seq });
  const body = await soapCall({ provider: 'SEFAZ', companyId: company.id, url: mdfeUrl('MDFeRecepcaoEvento', ctx.tpAmb), service: 'MDFeRecepcaoEvento', payload: ev.xml, pfx: ctx.pfx, ns: `${WS}MDFeRecepcaoEvento`, dataTag: 'mdfeDadosMsg', header: cabec('MDFeRecepcaoEvento', ctx.cUF) });
  return parseRetEventoMdfe(body);
}

/** Encerramento (110112) — no destino, ao fim da viagem */
export async function closeMdfe(actor: Actor, id: string, input: { date?: string } = {}) {
  const m = await getMdfe(actor.companyId, id);
  if (m.status !== 'AUTORIZADO') fail(400, 'Somente MDF-e autorizado pode ser encerrado');
  const company = (await prisma.company.findUnique({ where: { id: actor.companyId } }))!;
  const date = input.date ? new Date(input.date) : new Date();
  const dtEnc = dUF(date, company.uf);
  // Encerra no último município de descarregamento (fim da viagem)
  const end = mdfeDados(m).unloads.at(-1)!;
  const how = m.xml?.includes('SEFAZ-SIMULADA') ? 'SIMULADO' : fiscalProviderOf(company);
  let r = { ok: true, cStat: '135', xMotivo: 'Evento registrado e vinculado ao MDF-e', nProt: `9${randomDigits(14)}` as string | null };
  if (how === 'FOCUS_NFE') {
    const f = await focusMdfeClose(await focusAcc(company.id), `mdfe_${m.id}`, { data: dtEnc, uf: m.ufEnd, municipio: end.city, codigoMunicipio: end.code });
    r = { ok: f.ok, cStat: f.cStat, xMotivo: f.xMotivo, nProt: f.protocol };
  } else if (how === 'SEFAZ') {
    r = await sendMdfeEvent(company, m, '110112', detEncerramento(m.protocol || '', dtEnc, UF_CODES[m.ufEnd] || '35', end.code));
  }
  if (!r.ok) {
    await pushEvent(m, { type: 'REJEICAO', code: r.cStat, description: `Encerramento: ${r.cStat} - ${r.xMotivo}` });
    fail(400, `Encerramento rejeitado: ${r.cStat} ${r.xMotivo}`);
  }
  return pushEvent(m, { type: 'ENCERRAMENTO', code: r.cStat, protocol: r.nProt, description: `${r.cStat} - ${r.xMotivo} (encerrado em ${end.city}/${m.ufEnd})` }, { status: 'ENCERRADO', closedAt: date });
}

/** Cancelamento (110111) — antes do início da viagem; rascunhos são apenas descartados */
export async function cancelMdfe(actor: Actor, id: string, reason: string) {
  const m = await getMdfe(actor.companyId, id);
  if (['RASCUNHO', 'REJEITADO'].includes(m.status)) return pushEvent(m, { type: 'CANCELAMENTO', description: `Descartado: ${reason || 'sem justificativa'}` }, { status: 'CANCELADO' });
  if (m.status !== 'AUTORIZADO') fail(400, `MDF-e ${m.status} não pode ser cancelado`);
  if (!reason || reason.trim().length < 15) fail(400, 'A justificativa deve ter no mínimo 15 caracteres');
  const company = (await prisma.company.findUnique({ where: { id: actor.companyId } }))!;
  const how = m.xml?.includes('SEFAZ-SIMULADA') ? 'SIMULADO' : fiscalProviderOf(company);
  let r = { ok: true, cStat: '135', xMotivo: 'Evento registrado e vinculado ao MDF-e', nProt: `9${randomDigits(14)}` as string | null };
  if (how === 'SIMULADO' && Date.now() - (m.issueDate?.getTime() || 0) > 24 * 3600000) fail(400, 'Rejeição 218: prazo de cancelamento (24 h) excedido — encerre o MDF-e');
  if (how === 'FOCUS_NFE') {
    const f = await focusCancel(await focusAcc(company.id), 'MDFE', `mdfe_${m.id}`, reason.trim());
    r = { ok: f.ok, cStat: f.cStat, xMotivo: f.xMotivo, nProt: f.protocol };
  } else if (how === 'SEFAZ') {
    r = await sendMdfeEvent(company, m, '110111', detCancelamentoMdfe(m.protocol || '', reason));
  }
  if (!r.ok) {
    await pushEvent(m, { type: 'REJEICAO', code: r.cStat, description: `Cancelamento: ${r.cStat} - ${r.xMotivo}` });
    fail(400, `Cancelamento rejeitado: ${r.cStat} ${r.xMotivo}`);
  }
  return pushEvent(m, { type: 'CANCELAMENTO', code: r.cStat, protocol: r.nProt, description: `${r.cStat} - ${r.xMotivo}. Justificativa: ${reason}` }, { status: 'CANCELADO' });
}

export async function getMdfeDetail(companyId: string, id: string) {
  const m = await getMdfe(companyId, id);
  const invoices = await prisma.invoice.findMany({ where: { companyId, accessKey: { in: m.invoiceKeys } }, select: { id: true, number: true, series: true, accessKey: true, customerName: true, customerUf: true, total: true, status: true } });
  const dados = mdfeDados(m);
  const cityOf = new Map(dados.unloads.flatMap((u) => u.keys.map((k) => [k, u.city] as const)));
  return { ...m, xml: undefined, hasXml: !!m.xml, events: realEvents(m), dados, invoices: invoices.map((i) => ({ ...i, unloadCity: cityOf.get(i.accessKey || '') || '' })) };
}
