/**
 * QR Code da NFC-e — versão 2 (NT 2015.002 / NT 2016.002):
 * - online:  URL?p=chNFe|2|tpAmb|cIdToken|cHashQRCode
 * - offline: URL?p=chNFe|2|tpAmb|dia|vNF|digVal|cIdToken|cHashQRCode
 * cHashQRCode = SHA-1 (hex maiúsculo) dos parâmetros concatenados ao CSC.
 * Também a URL de consulta pela chave (urlChave) por UF.
 * Conferir na documentação: Portal NFC-e → URLs de consulta por UF.
 */
import crypto from 'crypto';

/** [produção, homologação] — URL do QR Code */
const QR: Record<string, [string, string]> = {
  AC: ['http://www.sefaznet.ac.gov.br/nfce/qrcode', 'http://www.hml.sefaznet.ac.gov.br/nfce/qrcode'],
  AL: ['http://nfce.sefaz.al.gov.br/QRCode/consultarNFCe.jsp', 'http://nfce.sefaz.al.gov.br/QRCode/consultarNFCe.jsp'],
  AM: ['https://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp', 'https://sistemas.sefaz.am.gov.br/nfceweb-hom/consultarNFCe.jsp'],
  AP: ['https://www.sefaz.ap.gov.br/nfce/nfcep.php', 'https://www.sefaz.ap.gov.br/nfcehml/nfce.php'],
  BA: ['http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx', 'http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx'],
  CE: ['http://nfce.sefaz.ce.gov.br/pages/ShowNFCe.html', 'http://nfceh.sefaz.ce.gov.br/pages/ShowNFCe.html'],
  DF: ['http://www.fazenda.df.gov.br/nfce/qrcode', 'http://www.fazenda.df.gov.br/nfce/qrcode'],
  ES: ['http://app.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx', 'http://homologacao.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx'],
  GO: ['https://nfeweb.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe', 'https://nfewebhomolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe'],
  MA: ['http://nfce.sefaz.ma.gov.br/portal/consultarNFCe.jsp', 'http://homologacao.sefaz.ma.gov.br/portal/consultarNFCe.jsp'],
  MG: ['https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml', 'https://hportalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml'],
  MS: ['http://www.dfe.ms.gov.br/nfce/qrcode', 'http://www.dfe.ms.gov.br/nfce/qrcode'],
  MT: ['http://www.sefaz.mt.gov.br/nfce/consultanfce', 'http://homologacao.sefaz.mt.gov.br/nfce/consultanfce'],
  PA: ['https://appnfc.sefa.pa.gov.br/portal/view/consultas/nfce/nfceForm.seam', 'https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/nfceForm.seam'],
  PB: ['http://www.sefaz.pb.gov.br/nfce', 'http://www.sefaz.pb.gov.br/nfcehom'],
  PE: ['http://nfce.sefaz.pe.gov.br/nfce/consulta', 'http://nfcehomolog.sefaz.pe.gov.br/nfce/consulta'],
  PI: ['http://www.sefaz.pi.gov.br/nfce/qrcode', 'http://www.sefaz.pi.gov.br/nfce/qrcode'],
  PR: ['http://www.fazenda.pr.gov.br/nfce/qrcode', 'http://www.fazenda.pr.gov.br/nfce/qrcode'],
  RJ: ['https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode', 'https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode'],
  RN: ['http://nfce.set.rn.gov.br/consultarNFCe.aspx', 'http://hom.nfce.set.rn.gov.br/consultarNFCe.aspx'],
  RO: ['http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp', 'http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp'],
  RR: ['https://www.sefaz.rr.gov.br/servlet/qrcode', 'http://200.174.88.103:8080/nfce/servlet/qrcode'],
  RS: ['https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx', 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx'],
  SC: ['https://sat.sef.sc.gov.br/nfce/consulta', 'https://hom.sat.sef.sc.gov.br/nfce/consulta'],
  SE: ['http://www.nfce.se.gov.br/nfce/qrcode', 'http://www.hom.nfe.se.gov.br/nfce/qrcode'],
  SP: ['https://www.nfce.fazenda.sp.gov.br/qrcode', 'https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode'],
  TO: ['http://www.sefaz.to.gov.br/nfce/qrcode', 'http://homologacao.sefaz.to.gov.br/nfce/qrcode'],
};

/** [produção, homologação] — URL de consulta pela chave (urlChave / impressa no DANFE NFC-e) */
const CHAVE: Record<string, [string, string]> = {
  AC: ['www.sefaznet.ac.gov.br/nfce/consulta', 'www.sefaznet.ac.gov.br/nfce/consulta'],
  AL: ['www.sefaz.al.gov.br/nfce/consulta', 'www.sefaz.al.gov.br/nfce/consulta'],
  AM: ['www.sefaz.am.gov.br/nfce/consulta', 'www.sefaz.am.gov.br/nfce/consulta'],
  AP: ['www.sefaz.ap.gov.br/nfce/consulta', 'www.sefaz.ap.gov.br/nfce/consulta'],
  BA: ['www.sefaz.ba.gov.br/nfce/consulta', 'http://hinternet.sefaz.ba.gov.br/nfce/consulta'],
  CE: ['www.sefaz.ce.gov.br/nfce/consulta', 'www.sefaz.ce.gov.br/nfce/consulta'],
  DF: ['www.fazenda.df.gov.br/nfce/consulta', 'www.fazenda.df.gov.br/nfce/consulta'],
  ES: ['www.sefaz.es.gov.br/nfce/consulta', 'www.sefaz.es.gov.br/nfce/consulta'],
  GO: ['www.sefaz.go.gov.br/nfce/consulta', 'www.sefaz.go.gov.br/nfce/consulta'],
  MA: ['www.sefaz.ma.gov.br/nfce/consulta', 'www.sefaz.ma.gov.br/nfce/consulta'],
  MG: ['https://portalsped.fazenda.mg.gov.br/portalnfce', 'https://hportalsped.fazenda.mg.gov.br/portalnfce'],
  MS: ['www.dfe.ms.gov.br/nfce/consulta', 'www.dfe.ms.gov.br/nfce/consulta'],
  MT: ['www.sefaz.mt.gov.br/nfce/consulta', 'http://homologacao.sefaz.mt.gov.br/nfce/consulta'],
  PA: ['www.sefa.pa.gov.br/nfce/consulta', 'www.sefa.pa.gov.br/nfce/consulta'],
  PB: ['www.sefaz.pb.gov.br/nfce/consulta', 'www.sefaz.pb.gov.br/nfcehom'],
  PE: ['nfce.sefaz.pe.gov.br/nfce/consulta', 'nfce.sefaz.pe.gov.br/nfce/consulta'],
  PI: ['www.sefaz.pi.gov.br/nfce/consulta', 'www.sefaz.pi.gov.br/nfce/consulta'],
  PR: ['http://www.fazenda.pr.gov.br/nfce/consulta', 'http://www.fazenda.pr.gov.br/nfce/consulta'],
  RJ: ['www.fazenda.rj.gov.br/nfce/consulta', 'www.fazenda.rj.gov.br/nfce/consulta'],
  RN: ['www.set.rn.gov.br/nfce/consulta', 'www.set.rn.gov.br/nfce/consulta'],
  RO: ['www.sefin.ro.gov.br/nfce/consulta', 'www.sefin.ro.gov.br/nfce/consulta'],
  RR: ['www.sefaz.rr.gov.br/nfce/consulta', 'www.sefaz.rr.gov.br/nfce/consulta'],
  RS: ['www.sefaz.rs.gov.br/nfce/consulta', 'www.sefaz.rs.gov.br/nfce/consulta'],
  SC: ['https://sat.sef.sc.gov.br/nfce/consulta', 'https://hom.sat.sef.sc.gov.br/nfce/consulta'],
  SE: ['http://www.nfce.se.gov.br/nfce/consulta', 'http://www.hom.nfe.se.gov.br/nfce/consulta'],
  SP: ['https://www.nfce.fazenda.sp.gov.br/consulta', 'https://www.homologacao.nfce.fazenda.sp.gov.br/consulta'],
  TO: ['www.sefaz.to.gov.br/nfce/consulta', 'http://homologacao.sefaz.to.gov.br/nfce/consulta'],
};

export const nfceQrBaseUrl = (uf: string, tpAmb: 1 | 2) => (QR[uf] || QR.SP)[tpAmb === 1 ? 0 : 1];
export const nfceUrlChave = (uf: string, tpAmb: 1 | 2) => (CHAVE[uf] || CHAVE.SP)[tpAmb === 1 ? 0 : 1];

/** cIdToken: identificador do CSC sem zeros não significativos */
export const cscIdToken = (cscId: string | null | undefined) => String(Number(String(cscId || '1').replace(/\D/g, '')) || 1);

/** Converte o DigestValue (Base64) em hexadecimal, como exigido no QR Code offline */
export const digValHex = (digestB64: string) => Buffer.from(digestB64, 'utf8').toString('hex');

export type QrInput = { uf: string; accessKey: string; tpAmb: 1 | 2; cscId: string | null | undefined; csc: string; offline?: { issueDate: Date; total: number; digestValue: string; dayUF?: string } };

/** Parâmetro `p` do QR Code v2 com o hash */
export function nfceQrParam(q: QrInput) {
  const id = cscIdToken(q.cscId);
  let base: string;
  if (q.offline) {
    const day = q.offline.dayUF || String(q.offline.issueDate.getDate()).padStart(2, '0');
    base = `${q.accessKey}|2|${q.tpAmb}|${day}|${q.offline.total.toFixed(2)}|${digValHex(q.offline.digestValue)}|${id}`;
  } else base = `${q.accessKey}|2|${q.tpAmb}|${id}`;
  const hash = crypto.createHash('sha1').update(base + q.csc, 'utf8').digest('hex').toUpperCase();
  return `${base}|${hash}`;
}

export const nfceQrCode = (q: QrInput) => `${nfceQrBaseUrl(q.uf, q.tpAmb)}?p=${nfceQrParam(q)}`;
