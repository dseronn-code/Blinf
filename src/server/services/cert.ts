/**
 * Certificado digital A1 (PKCS#12 / .pfx) e assinatura XML (XMLDSig) no
 * padrão exigido pela NF-e: enveloped signature, C14N, RSA-SHA1.
 * A leitura do certificado e a assinatura são REAIS (node-forge); apenas a
 * transmissão à SEFAZ continua simulada.
 */
import crypto from 'crypto';
import forge from 'node-forge';

export type CertInfo = { cn: string; issuer: string; serial: string; notBefore: Date; notAfter: Date; cnpj: string | null };

function load(pfx: Buffer, password: string) {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch {
    throw new Error('Não foi possível abrir o certificado: arquivo inválido ou senha incorreta');
  }
  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0];
  const keyBag =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ||
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];
  if (!certBag?.cert || !keyBag?.key) throw new Error('Certificado sem chave privada');
  return { cert: certBag.cert, key: keyBag.key as forge.pki.rsa.PrivateKey };
}

export function readCertificate(pfx: Buffer, password: string): CertInfo {
  const { cert } = load(pfx, password);
  const cn = String(cert.subject.getField('CN')?.value || '');
  return {
    cn,
    issuer: String(cert.issuer.getField('CN')?.value || cert.issuer.getField('O')?.value || ''),
    serial: cert.serialNumber,
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
    cnpj: cn.match(/(\d{14})/)?.[1] || null,
  };
}

/** Gera um certificado A1 autoassinado (demonstração) no formato e-CNPJ "RAZAO:CNPJ" */
export function generateDemoCertificate(name: string, cnpj: string, password: string, days = 365): Buffer {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + days * 86400000);
  const subject = [{ name: 'commonName', value: `${name.slice(0, 40)}:${cnpj}` }, { name: 'countryName', value: 'BR' }, { name: 'organizationName', value: 'ICP-Brasil (demonstração)' }];
  cert.setSubject(subject);
  cert.setIssuer([{ name: 'commonName', value: 'AC GestaoPro Demonstracao' }, { name: 'countryName', value: 'BR' }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}

const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

function signedInfoXml(uri: string, digest: string) {
  // Forma canônica (C14N): elementos vazios expandidos e namespace no elemento raiz
  return `<SignedInfo xmlns="${DSIG}"><CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod><SignatureMethod Algorithm="${DSIG}rsa-sha1"></SignatureMethod><Reference URI="#${uri}"><Transforms><Transform Algorithm="${DSIG}enveloped-signature"></Transform><Transform Algorithm="${C14N}"></Transform></Transforms><DigestMethod Algorithm="${DSIG}sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
}

/**
 * Assina o elemento identificado por `id` (ex.: infNFe Id="NFe...").
 * `canonicalElement` deve ser o elemento já em forma canônica, incluindo o
 * namespace herdado (ex.: <infNFe xmlns="http://www.portalfiscal.inf.br/nfe" Id=".." versao="4.00">…</infNFe>).
 * Retorna o bloco <Signature> para inserir após o elemento.
 */
export function signElement(canonicalElement: string, id: string, pfx: Buffer, password: string) {
  const { cert, key } = load(pfx, password);
  const digest = crypto.createHash('sha1').update(canonicalElement, 'utf8').digest('base64');
  const signedInfo = signedInfoXml(id, digest);
  const md = forge.md.sha1.create();
  md.update(signedInfo, 'utf8');
  const signature = forge.util.encode64(key.sign(md));
  const x509 = forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
  return `<Signature xmlns="${DSIG}">${signedInfo.replace(` xmlns="${DSIG}"`, '')}<SignatureValue>${signature}</SignatureValue><KeyInfo><X509Data><X509Certificate>${x509}</X509Certificate></X509Data></KeyInfo></Signature>`;
}

/** Verifica digest e assinatura de um XML assinado por signElement */
export function verifySignature(canonicalElement: string, signatureXml: string) {
  const digest = signatureXml.match(/<DigestValue>([^<]+)<\/DigestValue>/)?.[1];
  const sigValue = signatureXml.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)?.[1];
  const certB64 = signatureXml.match(/<X509Certificate>([^<]+)<\/X509Certificate>/)?.[1];
  const uri = signatureXml.match(/URI="#([^"]+)"/)?.[1];
  if (!digest || !sigValue || !certB64 || !uri) return false;
  const expected = crypto.createHash('sha1').update(canonicalElement, 'utf8').digest('base64');
  if (expected !== digest) return false;
  const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.decode64(certB64)));
  const md = forge.md.sha1.create();
  md.update(signedInfoXml(uri, digest), 'utf8');
  return (cert.publicKey as forge.pki.rsa.PublicKey).verify(md.digest().bytes(), forge.util.decode64(sigValue));
}
