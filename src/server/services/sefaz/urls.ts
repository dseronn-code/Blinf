/**
 * Endereços dos webservices oficiais (NF-e 4.00 modelo 55, NFC-e modelo 65,
 * Ambiente Nacional e SVC) por UF e ambiente (1 = produção, 2 = homologação).
 * Autorizadores próprios de NF-e: AM, BA, GO, MG, MS, MT, PE, PR, RS, SP;
 * SVAN: MA; SVRS: demais UFs. Contingência: SVC-AN / SVC-RS.
 * Conferir na documentação: Portal Nacional da NF-e → Serviços → Relação de Serviços Web.
 */
export type NfeService = 'NFeAutorizacao4' | 'NFeRetAutorizacao4' | 'NFeStatusServico4' | 'NFeConsultaProtocolo4' | 'NFeInutilizacao4' | 'NFeRecepcaoEvento4';
export type Authorizer = string;

type Paths = Record<NfeService, string>;
type Server = { prod: string; hom: string; paths: Paths };

// Padrões de caminho mais comuns
const ASMX_DIR: Paths = {
  NFeAutorizacao4: 'NFeAutorizacao4/NFeAutorizacao4.asmx', NFeRetAutorizacao4: 'NFeRetAutorizacao4/NFeRetAutorizacao4.asmx', NFeStatusServico4: 'NFeStatusServico4/NFeStatusServico4.asmx',
  NFeConsultaProtocolo4: 'NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx', NFeInutilizacao4: 'NFeInutilizacao4/NFeInutilizacao4.asmx', NFeRecepcaoEvento4: 'NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
};
const JAVA: Paths = { NFeAutorizacao4: 'NFeAutorizacao4', NFeRetAutorizacao4: 'NFeRetAutorizacao4', NFeStatusServico4: 'NFeStatusServico4', NFeConsultaProtocolo4: 'NFeConsultaProtocolo4', NFeInutilizacao4: 'NFeInutilizacao4', NFeRecepcaoEvento4: 'NFeRecepcaoEvento4' };
const JAVA_OLD: Paths = { NFeAutorizacao4: 'NfeAutorizacao4', NFeRetAutorizacao4: 'NfeRetAutorizacao4', NFeStatusServico4: 'NfeStatusServico4', NFeConsultaProtocolo4: 'NfeConsulta4', NFeInutilizacao4: 'NfeInutilizacao4', NFeRecepcaoEvento4: 'RecepcaoEvento4' };
const RS_STYLE: Paths = {
  NFeAutorizacao4: 'ws/NfeAutorizacao/NFeAutorizacao4.asmx', NFeRetAutorizacao4: 'ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx', NFeStatusServico4: 'ws/NfeStatusServico/NfeStatusServico4.asmx',
  NFeConsultaProtocolo4: 'ws/NfeConsulta/NfeConsulta4.asmx', NFeInutilizacao4: 'ws/nfeinutilizacao/nfeinutilizacao4.asmx', NFeRecepcaoEvento4: 'ws/recepcaoevento/recepcaoevento4.asmx',
};
const SP_STYLE: Paths = {
  NFeAutorizacao4: 'ws/nfeautorizacao4.asmx', NFeRetAutorizacao4: 'ws/nferetautorizacao4.asmx', NFeStatusServico4: 'ws/nfestatusservico4.asmx',
  NFeConsultaProtocolo4: 'ws/nfeconsultaprotocolo4.asmx', NFeInutilizacao4: 'ws/nfeinutilizacao4.asmx', NFeRecepcaoEvento4: 'ws/nferecepcaoevento4.asmx',
};
const SP_NFCE: Paths = {
  NFeAutorizacao4: 'ws/NFeAutorizacao4.asmx', NFeRetAutorizacao4: 'ws/NFeRetAutorizacao4.asmx', NFeStatusServico4: 'ws/NFeStatusServico4.asmx',
  NFeConsultaProtocolo4: 'ws/NFeConsultaProtocolo4.asmx', NFeInutilizacao4: 'ws/NFeInutilizacao4.asmx', NFeRecepcaoEvento4: 'ws/NFeRecepcaoEvento4.asmx',
};
const withBase = (p: Paths, base: string): Paths => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, `${base}${v}`])) as Paths;

/** Servidores de NF-e (modelo 55) */
const NFE: Record<string, Server> = {
  AM: { prod: 'https://nfe.sefaz.am.gov.br/services2/services/', hom: 'https://homnfe.sefaz.am.gov.br/services2/services/', paths: JAVA_OLD },
  BA: { prod: 'https://nfe.sefaz.ba.gov.br/webservices/', hom: 'https://hnfe.sefaz.ba.gov.br/webservices/', paths: ASMX_DIR },
  GO: { prod: 'https://nfe.sefaz.go.gov.br/nfe/services/', hom: 'https://homolog.sefaz.go.gov.br/nfe/services/', paths: JAVA },
  MG: { prod: 'https://nfe.fazenda.mg.gov.br/nfe2/services/', hom: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/', paths: JAVA },
  MS: { prod: 'https://nfe.sefaz.ms.gov.br/ws/', hom: 'https://hom.nfe.sefaz.ms.gov.br/ws/', paths: JAVA },
  MT: { prod: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/', hom: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/', paths: JAVA_OLD },
  PE: { prod: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/', hom: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/', paths: JAVA },
  PR: { prod: 'https://nfe.sefa.pr.gov.br/nfe/', hom: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/', paths: JAVA },
  RS: { prod: 'https://nfe.sefazrs.rs.gov.br/', hom: 'https://nfe-homologacao.sefazrs.rs.gov.br/', paths: RS_STYLE },
  SP: { prod: 'https://nfe.fazenda.sp.gov.br/', hom: 'https://homologacao.nfe.fazenda.sp.gov.br/', paths: SP_STYLE },
  SVRS: { prod: 'https://nfe.svrs.rs.gov.br/', hom: 'https://nfe-homologacao.svrs.rs.gov.br/', paths: RS_STYLE },
  SVAN: { prod: 'https://www.sefazvirtual.fazenda.gov.br/', hom: 'https://hom.sefazvirtual.fazenda.gov.br/', paths: ASMX_DIR },
  'SVC-AN': { prod: 'https://www.svc.fazenda.gov.br/', hom: 'https://hom.svc.fazenda.gov.br/', paths: ASMX_DIR },
  'SVC-RS': { prod: 'https://nfe.svrs.rs.gov.br/', hom: 'https://nfe-homologacao.svrs.rs.gov.br/', paths: RS_STYLE },
};

/** Servidores de NFC-e (modelo 65) */
const NFCE: Record<string, Server> = {
  AM: { prod: 'https://nfce.sefaz.am.gov.br/nfce-services/services/', hom: 'https://homnfce.sefaz.am.gov.br/nfce-services/services/', paths: JAVA_OLD },
  GO: { prod: 'https://nfe.sefaz.go.gov.br/nfe/services/', hom: 'https://homolog.sefaz.go.gov.br/nfe/services/', paths: JAVA },
  MG: { prod: 'https://nfce.fazenda.mg.gov.br/nfce/services/', hom: 'https://hnfce.fazenda.mg.gov.br/nfce/services/', paths: JAVA },
  MS: { prod: 'https://nfce.sefaz.ms.gov.br/ws/', hom: 'https://hom.nfce.sefaz.ms.gov.br/ws/', paths: JAVA },
  MT: { prod: 'https://nfce.sefaz.mt.gov.br/nfcews/services/', hom: 'https://homologacao.sefaz.mt.gov.br/nfcews/services/', paths: JAVA_OLD },
  PR: { prod: 'https://nfce.sefa.pr.gov.br/nfce/', hom: 'https://homologacao.nfce.sefa.pr.gov.br/nfce/', paths: JAVA },
  RS: { prod: 'https://nfce.sefazrs.rs.gov.br/', hom: 'https://nfce-homologacao.sefazrs.rs.gov.br/', paths: RS_STYLE },
  SP: { prod: 'https://nfce.fazenda.sp.gov.br/', hom: 'https://homologacao.nfce.fazenda.sp.gov.br/', paths: SP_NFCE },
  SVRS: { prod: 'https://nfce.svrs.rs.gov.br/', hom: 'https://nfce-homologacao.svrs.rs.gov.br/', paths: RS_STYLE },
};

const OWN_NFE = ['AM', 'BA', 'GO', 'MG', 'MS', 'MT', 'PE', 'PR', 'RS', 'SP'];
const OWN_NFCE = ['AM', 'GO', 'MG', 'MS', 'MT', 'PR', 'RS', 'SP'];
/** UFs atendidas pelo SVC-RS (as demais usam SVC-AN) */
const SVC_RS = ['AM', 'BA', 'GO', 'MA', 'MS', 'MT', 'PE', 'PR'];

/** Autorizador da UF para o modelo */
export function authorizerFor(uf: string, model: 55 | 65): Authorizer {
  if (model === 65) return OWN_NFCE.includes(uf) ? uf : 'SVRS';
  if (OWN_NFE.includes(uf)) return uf;
  return uf === 'MA' ? 'SVAN' : 'SVRS';
}

/** Sefaz Virtual de Contingência da UF: SVC-AN (tpEmis 6) ou SVC-RS (tpEmis 7) */
export function svcFor(uf: string): { authorizer: 'SVC-AN' | 'SVC-RS'; tpEmis: 6 | 7 } {
  return SVC_RS.includes(uf) ? { authorizer: 'SVC-RS', tpEmis: 7 } : { authorizer: 'SVC-AN', tpEmis: 6 };
}

/** URL do serviço. `authorizer` permite forçar SVC-AN/SVC-RS */
export function sefazUrl(uf: string, model: 55 | 65, service: NfeService, tpAmb: 1 | 2, authorizer?: Authorizer) {
  const a = authorizer || authorizerFor(uf, model);
  const server = (model === 65 && !a.startsWith('SVC') ? NFCE : NFE)[a];
  if (!server) throw new Error(`Autorizador ${a} sem webservice de ${model === 65 ? 'NFC-e' : 'NF-e'}`);
  return withBase(server.paths, tpAmb === 1 ? server.prod : server.hom)[service];
}

/** Ambiente Nacional: Distribuição DF-e e eventos de manifestação do destinatário (cOrgao 91) */
export function anUrl(service: 'NFeDistribuicaoDFe' | 'NFeRecepcaoEvento4', tpAmb: 1 | 2) {
  if (service === 'NFeDistribuicaoDFe') return tpAmb === 1 ? 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx' : 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';
  return tpAmb === 1 ? 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx' : 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx';
}

/** MDF-e 3.00 — autorizador único SVRS */
export function mdfeUrl(service: 'MDFeRecepcaoSinc' | 'MDFeRecepcaoEvento' | 'MDFeStatusServico' | 'MDFeConsulta', tpAmb: 1 | 2) {
  return `${tpAmb === 1 ? 'https://mdfe.svrs.rs.gov.br' : 'https://mdfe-homologacao.svrs.rs.gov.br'}/ws/${service}/${service}.asmx`;
}

/** GNRE — Portal GNRE (SEFAZ-PE) */
export function gnreUrl(service: 'GnreLoteRecepcao' | 'GnreResultadoLote', tpAmb: 1 | 2) {
  return `${tpAmb === 1 ? 'https://www.gnre.pe.gov.br' : 'https://www.testegnre.pe.gov.br'}/gnreWS/services/${service}`;
}

/** NFS-e Padrão Nacional (Sefin Nacional) */
export const nfseNacionalBase = (tpAmb: 1 | 2) => (tpAmb === 1 ? 'https://sefin.nfse.gov.br/SefinNacional' : 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional');
