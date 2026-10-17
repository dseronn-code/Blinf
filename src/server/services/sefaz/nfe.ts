/**
 * Webservices da NF-e 4.00 / NFC-e: status do serviço, autorização (lote
 * síncrono com 1 NF-e, consulta de recibo), consulta de protocolo, eventos
 * (cancelamento 110111, CC-e 110110, manifestação 2102xx no Ambiente
 * Nacional), inutilização e Distribuição DF-e (distNSU / consChNFe).
 * Montagem e leitura são funções puras (testáveis); o envio usa mTLS com o
 * certificado A1 da empresa.
 */
import type { Company } from '@prisma/client';
import { onlyDigits, randomDigits } from '@/lib/utils';
import { UF_CODES } from '@/lib/br';
import { fail } from '../../errors';
import { soapCall } from './soap';
import { sefazUrl, anUrl, type Authorizer } from './urls';
import { NS, attr, block, dhUF, signInf, stripDecl, tag, txt, unzipB64 } from './xml';

export type SefazCtx = { companyId: string; uf: string; cUF: string; cnpj: string; tpAmb: 1 | 2; pfx: { data: Buffer; password: string } };

/** Contexto de comunicação a partir da empresa (exige o certificado A1 instalado) */
export function sefazCtx(company: Pick<Company, 'id' | 'uf' | 'cnpj' | 'nfeEnvironment' | 'certPfx' | 'certPassword'>, tpAmb?: 1 | 2): SefazCtx {
  if (!company.certPfx || !company.certPassword) fail(400, 'Instale o certificado digital A1 da empresa (Notas fiscais → Certificado digital) para transmitir à SEFAZ');
  return {
    companyId: company.id, uf: company.uf, cUF: UF_CODES[company.uf] || '35', cnpj: onlyDigits(company.cnpj),
    tpAmb: tpAmb || (company.nfeEnvironment === 1 ? 1 : 2), pfx: { data: Buffer.from(company.certPfx!), password: company.certPassword! },
  };
}

export type AuthStatus = 'AUTORIZADA' | 'DENEGADA' | 'REJEITADA' | 'PROCESSANDO';
export type AuthResult = { status: AuthStatus; cStat: string; xMotivo: string; nProt?: string | null; dhRecbto?: string | null; protXml?: string | null; nRec?: string | null; tMed?: number; chNFe?: string | null };

export const DENIED = ['110', '301', '302', '303'];

// ---------------------------------------------------------------------------
// Montagem das mensagens
// ---------------------------------------------------------------------------
export const buildConsStatServ = (tpAmb: 1 | 2, cUF: string) => `<consStatServ xmlns="${NS.NFE}" versao="4.00"><tpAmb>${tpAmb}</tpAmb><cUF>${cUF}</cUF><xServ>STATUS</xServ></consStatServ>`;

/** Lote de envio (indSinc 1 = síncrono, uma única NF-e) */
export const buildEnviNFe = (nfe: string, idLote: string, sync = true) => `<enviNFe xmlns="${NS.NFE}" versao="4.00"><idLote>${idLote}</idLote><indSinc>${sync ? 1 : 0}</indSinc>${stripDecl(nfe)}</enviNFe>`;

export const buildConsReciNFe = (tpAmb: 1 | 2, nRec: string) => `<consReciNFe xmlns="${NS.NFE}" versao="4.00"><tpAmb>${tpAmb}</tpAmb><nRec>${nRec}</nRec></consReciNFe>`;

export const buildConsSitNFe = (tpAmb: 1 | 2, chNFe: string) => `<consSitNFe xmlns="${NS.NFE}" versao="4.00"><tpAmb>${tpAmb}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chNFe}</chNFe></consSitNFe>`;

/** Monta o nfeProc (NF-e assinada + protocolo de autorização) */
export const buildNfeProc = (nfe: string, protNFe: string) => `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="${NS.NFE}" versao="4.00">${stripDecl(nfe)}${protNFe}</nfeProc>`;

export const EVENT_DESC: Record<string, string> = {
  '110110': 'Carta de Correcao', '110111': 'Cancelamento', '110112': 'Encerramento',
  '210200': 'Confirmacao da Operacao', '210210': 'Ciencia da Operacao', '210220': 'Desconhecimento da Operacao', '210240': 'Operacao nao Realizada',
};

export const CCE_COND =
  'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.';

export const detCancelamento = (nProt: string, xJust: string) => `<descEvento>Cancelamento</descEvento><nProt>${nProt}</nProt><xJust>${txt(xJust, 255)}</xJust>`;
export const detCCe = (xCorrecao: string) => `<descEvento>Carta de Correcao</descEvento><xCorrecao>${txt(xCorrecao, 1000)}</xCorrecao><xCondUso>${CCE_COND}</xCondUso>`;
export const detManifestacao = (tpEvento: string, xJust?: string) => `<descEvento>${EVENT_DESC[tpEvento]}</descEvento>${tpEvento === '210240' && xJust ? `<xJust>${txt(xJust, 255)}</xJust>` : ''}`;

export type EventInput = { chNFe: string; tpEvento: string; nSeqEvento?: number; det: string; cOrgao?: string; date?: Date; idLote?: string };

/** Evento assinado + lote envEvento. cOrgao 91 = Ambiente Nacional (manifestação). */
export function buildEvento(ctx: SefazCtx, e: EventInput) {
  const seq = e.nSeqEvento || 1;
  const id = `ID${e.tpEvento}${e.chNFe}${String(seq).padStart(2, '0')}`;
  const inf = `<infEvento Id="${id}"><cOrgao>${e.cOrgao || ctx.cUF}</cOrgao><tpAmb>${ctx.tpAmb}</tpAmb><CNPJ>${ctx.cnpj}</CNPJ><chNFe>${e.chNFe}</chNFe><dhEvento>${dhUF(e.date || new Date(), ctx.uf)}</dhEvento><tpEvento>${e.tpEvento}</tpEvento><nSeqEvento>${seq}</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00">${e.det}</detEvento></infEvento>`;
  const signature = signInf(inf, 'infEvento', NS.NFE, ctx.pfx.data, ctx.pfx.password);
  const evento = `<evento xmlns="${NS.NFE}" versao="1.00">${inf}${signature}</evento>`;
  return { id, inf, signature, evento, xml: `<envEvento xmlns="${NS.NFE}" versao="1.00"><idLote>${e.idLote || randomDigits(15)}</idLote>${evento}</envEvento>` };
}

/** Pedido de inutilização assinado */
export function buildInutNFe(ctx: SefazCtx, p: { mod: 55 | 65; serie: number; nIni: number; nFin: number; xJust: string; ano?: number }) {
  const ano = String(p.ano ?? new Date().getFullYear()).slice(-2);
  const id = `ID${ctx.cUF}${ano}${ctx.cnpj}${p.mod}${String(p.serie).padStart(3, '0')}${String(p.nIni).padStart(9, '0')}${String(p.nFin).padStart(9, '0')}`;
  const inf = `<infInut Id="${id}"><tpAmb>${ctx.tpAmb}</tpAmb><xServ>INUTILIZAR</xServ><cUF>${ctx.cUF}</cUF><ano>${ano}</ano><CNPJ>${ctx.cnpj}</CNPJ><mod>${p.mod}</mod><serie>${p.serie}</serie><nNFIni>${p.nIni}</nNFIni><nNFFin>${p.nFin}</nNFFin><xJust>${txt(p.xJust, 255)}</xJust></infInut>`;
  const signature = signInf(inf, 'infInut', NS.NFE, ctx.pfx.data, ctx.pfx.password);
  return { id, inf, signature, xml: `<inutNFe xmlns="${NS.NFE}" versao="4.00">${inf}${signature}</inutNFe>` };
}

/** Distribuição DF-e: por NSU (ultNSU) ou por chave (consChNFe) */
export function buildDistDFeInt(ctx: Pick<SefazCtx, 'tpAmb' | 'cUF' | 'cnpj'>, q: { ultNSU?: string; chNFe?: string }) {
  const sel = q.chNFe ? `<consChNFe><chNFe>${q.chNFe}</chNFe></consChNFe>` : `<distNSU><ultNSU>${String(q.ultNSU || '0').padStart(15, '0')}</ultNSU></distNSU>`;
  return `<distDFeInt xmlns="${NS.NFE}" versao="1.01"><tpAmb>${ctx.tpAmb}</tpAmb><cUFAutor>${ctx.cUF}</cUFAutor><CNPJ>${ctx.cnpj}</CNPJ>${sel}</distDFeInt>`;
}

// ---------------------------------------------------------------------------
// Leitura dos retornos
// ---------------------------------------------------------------------------
/** Retorno de NFeAutorizacao4 (retEnviNFe) ou NFeRetAutorizacao4 (retConsReciNFe) */
export function parseAutorizacao(body: string): AuthResult {
  const ret = block(body, 'retEnviNFe') || block(body, 'retConsReciNFe') || body;
  const prot = block(ret, 'protNFe');
  const loteStat = tag(ret.replace(prot || '', ''), 'cStat') || '';
  const loteMotivo = tag(ret.replace(prot || '', ''), 'xMotivo') || '';
  const nRec = tag(ret, 'nRec');
  const tMed = Number(tag(ret, 'tMed') || 1);
  if (prot) {
    const inf = tag(prot, 'infProt') || prot;
    const cStat = tag(inf, 'cStat') || '';
    const xMotivo = tag(inf, 'xMotivo') || '';
    const base = { cStat, xMotivo, nProt: tag(inf, 'nProt'), dhRecbto: tag(inf, 'dhRecbto'), protXml: prot, chNFe: tag(inf, 'chNFe'), nRec };
    if (['100', '150'].includes(cStat)) return { status: 'AUTORIZADA', ...base };
    if (DENIED.includes(cStat)) return { status: 'DENEGADA', ...base };
    return { status: 'REJEITADA', ...base, protXml: null };
  }
  if (['103', '105'].includes(loteStat)) return { status: 'PROCESSANDO', cStat: loteStat, xMotivo: loteMotivo, nRec, tMed };
  return { status: 'REJEITADA', cStat: loteStat || '999', xMotivo: loteMotivo || 'Retorno da SEFAZ não reconhecido', nRec };
}

export type EventResult = { ok: boolean; cStat: string; xMotivo: string; nProt?: string | null; dhRegEvento?: string | null; retEvento?: string | null; loteStat?: string };

export function parseEvento(body: string): EventResult {
  const ret = block(body, 'retEnvEvento') || body;
  const re = block(ret, 'retEvento');
  if (!re) return { ok: false, cStat: tag(ret, 'cStat') || '999', xMotivo: tag(ret, 'xMotivo') || 'Retorno não reconhecido', loteStat: tag(ret, 'cStat') || undefined };
  const cStat = tag(re, 'cStat') || '';
  // 135 registrado e vinculado | 136 registrado sem vínculo | 155 cancelamento homologado fora de prazo
  return { ok: ['135', '136', '155'].includes(cStat), cStat, xMotivo: tag(re, 'xMotivo') || '', nProt: tag(re, 'nProt'), dhRegEvento: tag(re, 'dhRegEvento'), retEvento: re, loteStat: tag(ret.replace(re, ''), 'cStat') || undefined };
}

export const buildProcEvento = (evento: string, retEvento: string) => `<?xml version="1.0" encoding="UTF-8"?><procEventoNFe xmlns="${NS.NFE}" versao="1.00">${evento}${retEvento}</procEventoNFe>`;

export function parseInutilizacao(body: string) {
  const ret = block(body, 'retInutNFe') || body;
  const cStat = tag(ret, 'cStat') || '';
  return { ok: cStat === '102', cStat, xMotivo: tag(ret, 'xMotivo') || '', nProt: tag(ret, 'nProt'), dhRecbto: tag(ret, 'dhRecbto'), retXml: ret };
}

export function parseStatus(body: string) {
  const ret = block(body, 'retConsStatServ') || body;
  const cStat = tag(ret, 'cStat') || '';
  return { ok: cStat === '107', cStat, xMotivo: tag(ret, 'xMotivo') || '', tMed: Number(tag(ret, 'tMed') || 0), dhRecbto: tag(ret, 'dhRecbto'), dhRetorno: tag(ret, 'dhRetorno'), xObs: tag(ret, 'xObs') };
}

export type DistDoc = { nsu: string; schema: string; xml: string };
export function parseDistDFe(body: string) {
  const ret = block(body, 'retDistDFeInt') || body;
  const docs: DistDoc[] = [];
  for (const m of ret.matchAll(/<(?:\w+:)?docZip([^>]*)>([^<]+)<\/(?:\w+:)?docZip>/g)) {
    try {
      docs.push({ nsu: attr(m[1], 'NSU') || '', schema: attr(m[1], 'schema') || '', xml: unzipB64(m[2]) });
    } catch {
      /* documento corrompido: ignora */
    }
  }
  return { cStat: tag(ret, 'cStat') || '', xMotivo: tag(ret, 'xMotivo') || '', ultNSU: tag(ret, 'ultNSU') || '0', maxNSU: tag(ret, 'maxNSU') || '0', docs };
}

// ---------------------------------------------------------------------------
// Chamadas
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const call = (ctx: SefazCtx, url: string, service: string, payload: string, opts: { wrapOperation?: boolean } = {}) => soapCall({ companyId: ctx.companyId, url, service, payload, pfx: ctx.pfx, ...opts });

export async function statusServico(ctx: SefazCtx, model: 55 | 65 = 55, authorizer?: Authorizer) {
  const body = await call(ctx, sefazUrl(ctx.uf, model, 'NFeStatusServico4', ctx.tpAmb, authorizer), 'NFeStatusServico4', buildConsStatServ(ctx.tpAmb, ctx.cUF));
  return parseStatus(body);
}

export async function consultarRecibo(ctx: SefazCtx, model: 55 | 65, nRec: string, authorizer?: Authorizer) {
  const body = await call(ctx, sefazUrl(ctx.uf, model, 'NFeRetAutorizacao4', ctx.tpAmb, authorizer), 'NFeRetAutorizacao4', buildConsReciNFe(ctx.tpAmb, nRec));
  return parseAutorizacao(body);
}

/**
 * Envia a NF-e assinada (lote síncrono). Se a SEFAZ responder 103/105 (lote em
 * processamento), consulta o recibo algumas vezes antes de devolver PROCESSANDO.
 */
export async function autorizar(ctx: SefazCtx, model: 55 | 65, nfeXml: string, opts: { authorizer?: Authorizer; idLote?: string; pollMs?: number; attempts?: number } = {}): Promise<AuthResult> {
  const body = await call(ctx, sefazUrl(ctx.uf, model, 'NFeAutorizacao4', ctx.tpAmb, opts.authorizer), 'NFeAutorizacao4', buildEnviNFe(nfeXml, opts.idLote || randomDigits(15)));
  let r = parseAutorizacao(body);
  for (let i = 0; r.status === 'PROCESSANDO' && r.nRec && i < (opts.attempts ?? 3); i++) {
    await sleep(opts.pollMs ?? Math.min(Math.max(r.tMed || 1, 1), 5) * 1000);
    const nRec = r.nRec;
    r = await consultarRecibo(ctx, model, nRec, opts.authorizer);
    r.nRec ||= nRec;
  }
  return r;
}

/** Autorizador em que a NF-e foi emitida, pela chave: tpEmis 6 = SVC-AN, 7 = SVC-RS; demais = SEFAZ da UF (undefined) */
export function authorizerOfKey(chNFe: string | null | undefined): Authorizer | undefined {
  const tpEmis = chNFe?.length === 44 ? chNFe[34] : '';
  return tpEmis === '6' ? 'SVC-AN' : tpEmis === '7' ? 'SVC-RS' : undefined;
}

/** 114 = SVC desabilitada pela SEFAZ de origem (contingência encerrada) */
export const SVC_DISABLED = '114';

export async function consultarProtocolo(ctx: SefazCtx, model: 55 | 65, chNFe: string, authorizer?: Authorizer) {
  const body = await call(ctx, sefazUrl(ctx.uf, model, 'NFeConsultaProtocolo4', ctx.tpAmb, authorizer), 'NFeConsultaProtocolo4', buildConsSitNFe(ctx.tpAmb, chNFe));
  const ret = block(body, 'retConsSitNFe') || body;
  const prot = block(ret, 'protNFe');
  return { cStat: tag(ret.replace(prot || '', ''), 'cStat') || '', xMotivo: tag(ret.replace(prot || '', ''), 'xMotivo') || '', protXml: prot, prot: prot ? parseAutorizacao(`<retConsReciNFe>${prot}</retConsReciNFe>`) : null };
}

/**
 * Registra um evento. `nacional` envia ao Ambiente Nacional (manifestação do destinatário, cOrgao 91).
 * NF-e autorizada pela SVC (tpEmis 6/7 na chave): o evento (cancelamento, CC-e) vai para a mesma SVC
 * enquanto a contingência estiver ativa; se a SVC responder 114 (desabilitada pela SEFAZ de origem,
 * contingência encerrada), reenvia à SEFAZ da UF, que já recebeu a nota sincronizada.
 */
export async function enviarEvento(ctx: SefazCtx, model: 55 | 65, e: EventInput & { nacional?: boolean; authorizer?: Authorizer | null }) {
  const send = async (authorizer?: Authorizer) => {
    // Conferir na documentação: cOrgao dos eventos enviados à SVC (usa-se o cUF do emitente)
    const ev = buildEvento(ctx, { ...e, cOrgao: e.nacional ? '91' : e.cOrgao });
    const url = e.nacional ? anUrl('NFeRecepcaoEvento4', ctx.tpAmb) : sefazUrl(ctx.uf, model, 'NFeRecepcaoEvento4', ctx.tpAmb, authorizer);
    const r = parseEvento(await call(ctx, url, 'NFeRecepcaoEvento4', ev.xml));
    return { ...r, authorizer: authorizer || null, procXml: r.ok && r.retEvento ? buildProcEvento(ev.evento, r.retEvento) : null };
  };
  const svc = e.nacional || e.authorizer === null ? undefined : e.authorizer || (model === 55 ? authorizerOfKey(e.chNFe) : undefined);
  if (!svc) return send();
  const r = await send(svc);
  if (r.cStat === SVC_DISABLED || r.loteStat === SVC_DISABLED) return send();
  return r;
}

export async function inutilizar(ctx: SefazCtx, model: 55 | 65, p: { serie: number; nIni: number; nFin: number; xJust: string }) {
  const inut = buildInutNFe(ctx, { mod: model, ...p });
  const r = parseInutilizacao(await call(ctx, sefazUrl(ctx.uf, model, 'NFeInutilizacao4', ctx.tpAmb), 'NFeInutilizacao4', inut.xml));
  return { ...r, procXml: r.ok ? `<?xml version="1.0" encoding="UTF-8"?><ProcInutNFe xmlns="${NS.NFE}" versao="4.00">${inut.xml.replace(` xmlns="${NS.NFE}"`, '')}${r.retXml}</ProcInutNFe>` : null };
}

/** Distribuição DF-e (Ambiente Nacional). cStat 137 = nenhum documento; 138 = documentos localizados; 656 = consumo indevido (aguarde 1h). */
export async function distribuicaoDFe(ctx: SefazCtx, q: { ultNSU?: string; chNFe?: string }) {
  const body = await call(ctx, anUrl('NFeDistribuicaoDFe', ctx.tpAmb), 'NFeDistribuicaoDFe', buildDistDFeInt(ctx, q), { wrapOperation: true });
  return parseDistDFe(body);
}

/** Lê um resumo (resNFe) ou NF-e completa (nfeProc) distribuída */
export function readDistributedNfe(xml: string) {
  const full = xml.includes('<infNFe');
  const key = full ? xml.match(/Id="NFe(\d{44})"/)?.[1] : tag(xml, 'chNFe');
  const emit = full ? block(xml, 'emit') : xml;
  return {
    full,
    accessKey: key || '',
    number: key ? String(Number(key.slice(25, 34))) : '',
    issuerCnpj: tag(emit, 'CNPJ') || tag(emit, 'CPF') || '',
    issuerName: tag(emit, 'xNome') || 'Emitente',
    issueDate: new Date(tag(xml, 'dhEmi') || Date.now()),
    total: Number(tag(xml, 'vNF') || 0),
  };
}

