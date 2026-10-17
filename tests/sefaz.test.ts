import { describe, it, expect, afterEach } from 'vitest';
import { generateDemoCertificate, verifySignature } from '@/server/services/cert';
import { setHttpMock } from '@/server/integrations/http';
import { soapEnvelope, soapContentType } from '@/server/services/sefaz/soap';
import { sefazUrl, authorizerFor, svcFor, anUrl, nfseNacionalBase } from '@/server/services/sefaz/urls';
import { nfceQrParam, nfceQrCode, cscIdToken } from '@/server/services/sefaz/qrcode';
import { buildEvento, buildInutNFe, buildEnviNFe, buildDistDFeInt, parseAutorizacao, parseEvento, parseDistDFe, autorizar, detCancelamento, detCCe, CCE_COND, buildNfeProc, type SefazCtx } from '@/server/services/sefaz/nfe';
import { canonicalOf, gzipB64, NS, dhUF } from '@/server/services/sefaz/xml';
import { buildXml, extractSignedParts } from '@/server/services/fiscal';
import { buildDps, cTribNac, dpsId } from '@/server/services/nfse';
import { arrecadacaoBarcode, validArrecadacao, buildGnreLote } from '@/server/services/gnre';


const CNPJ = '11444777000161';
const pfx = generateDemoCertificate('Empresa Teste Ltda', CNPJ, 'senha123');
const ctx: SefazCtx = { companyId: 'teste', uf: 'SP', cUF: '35', cnpj: CNPJ, tpAmb: 2, pfx: { data: pfx, password: 'senha123' } };
const KEY = '35261011444777000161550010000001231000000010';

const prot = (cStat: string, xMotivo: string, nProt = '135260000000001') =>
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SP_NFE_PL009_V4</verAplic><chNFe>${KEY}</chNFe><dhRecbto>2026-10-16T10:00:00-03:00</dhRecbto><nProt>${nProt}</nProt><digVal>abc=</digVal><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;
const soapResp = (inner: string, op = 'NFeAutorizacao4') =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${op}">${inner}</nfeResultMsg></soap:Body></soap:Envelope>`;

afterEach(() => setHttpMock(null));

describe('SEFAZ — envelope SOAP 1.2', () => {
  it('monta o envelope com nfeDadosMsg no namespace do serviço e sem declaração XML interna', () => {
    const env = soapEnvelope('NFeAutorizacao4', `<?xml version="1.0" encoding="UTF-8"?>${buildEnviNFe('<NFe xmlns="http://www.portalfiscal.inf.br/nfe"></NFe>', '1')}`);
    expect(env.startsWith('<?xml version="1.0" encoding="utf-8"?><soap12:Envelope')).toBe(true);
    expect(env).toContain('xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"');
    expect(env).toContain('<soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>1</idLote><indSinc>1</indSinc>');
    expect(env.match(/<\?xml/g)).toHaveLength(1);
    expect(soapContentType('NFeAutorizacao4')).toBe('application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote"');
  });

  it('Distribuição DF-e envolve nfeDadosMsg em nfeDistDFeInteresse', () => {
    const env = soapEnvelope('NFeDistribuicaoDFe', buildDistDFeInt(ctx, { ultNSU: '15' }), { wrapOperation: true });
    expect(env).toContain('<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg><distDFeInt');
    expect(env).toContain('<distNSU><ultNSU>000000000000015</ultNSU></distNSU>');
    expect(buildDistDFeInt(ctx, { chNFe: KEY })).toContain(`<consChNFe><chNFe>${KEY}</chNFe></consChNFe>`);
  });
});

describe('SEFAZ — URLs por UF e ambiente', () => {
  it('autorizadores próprios, SVRS e SVAN', () => {
    expect(sefazUrl('SP', 55, 'NFeAutorizacao4', 2)).toBe('https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx');
    expect(sefazUrl('SP', 55, 'NFeAutorizacao4', 1)).toBe('https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx');
    expect(sefazUrl('MG', 55, 'NFeStatusServico4', 1)).toBe('https://nfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4');
    expect(sefazUrl('RS', 55, 'NFeRecepcaoEvento4', 2)).toBe('https://nfe-homologacao.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx');
    expect(authorizerFor('CE', 55)).toBe('SVRS');
    expect(sefazUrl('RJ', 55, 'NFeAutorizacao4', 1)).toBe('https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx');
    expect(authorizerFor('MA', 55)).toBe('SVAN');
    expect(sefazUrl('MA', 55, 'NFeInutilizacao4', 2)).toBe('https://hom.sefazvirtual.fazenda.gov.br/NFeInutilizacao4/NFeInutilizacao4.asmx');
    for (const uf of ['AM', 'BA', 'GO', 'MG', 'MS', 'MT', 'PE', 'PR', 'RS', 'SP']) expect(authorizerFor(uf, 55)).toBe(uf);
  });

  it('NFC-e, contingência SVC e Ambiente Nacional', () => {
    expect(authorizerFor('BA', 65)).toBe('SVRS');
    expect(sefazUrl('BA', 65, 'NFeAutorizacao4', 2)).toBe('https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx');
    expect(sefazUrl('SP', 65, 'NFeAutorizacao4', 1)).toBe('https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx');
    expect(svcFor('SP')).toEqual({ authorizer: 'SVC-AN', tpEmis: 6 });
    expect(svcFor('PR')).toEqual({ authorizer: 'SVC-RS', tpEmis: 7 });
    expect(sefazUrl('SP', 55, 'NFeAutorizacao4', 1, 'SVC-AN')).toBe('https://www.svc.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx');
    expect(anUrl('NFeDistribuicaoDFe', 1)).toBe('https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx');
    expect(anUrl('NFeRecepcaoEvento4', 2)).toBe('https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx');
    expect(nfseNacionalBase(2)).toBe('https://sefin.producaorestrita.nfse.gov.br/SefinNacional');
  });
});

describe('SEFAZ — leitura dos retornos', () => {
  it('100 autorizado (lote 104 com protNFe)', () => {
    const r = parseAutorizacao(soapResp(`<retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>35</cUF>${prot('100', 'Autorizado o uso da NF-e')}</retEnviNFe>`));
    expect(r.status).toBe('AUTORIZADA');
    expect(r.cStat).toBe('100');
    expect(r.nProt).toBe('135260000000001');
    expect(buildNfeProc('<NFe xmlns="http://www.portalfiscal.inf.br/nfe"></NFe>', r.protXml!)).toContain('<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe');
  });

  it('539 duplicidade com chave diferente → rejeição com motivo; 302 → denegada', () => {
    const r = parseAutorizacao(`<retEnviNFe><cStat>104</cStat><xMotivo>Lote processado</xMotivo>${prot('539', 'Rejeicao: Duplicidade de NF-e com diferenca na Chave de Acesso [chNFe:35261011444777000161550010000001231999999999]')}</retEnviNFe>`);
    expect(r.status).toBe('REJEITADA');
    expect(r.cStat).toBe('539');
    expect(r.xMotivo).toContain('Duplicidade');
    expect(parseAutorizacao(`<retEnviNFe><cStat>104</cStat>${prot('302', 'Uso Denegado: Irregularidade fiscal do destinatario')}</retEnviNFe>`).status).toBe('DENEGADA');
    expect(parseAutorizacao('<retEnviNFe><cStat>225</cStat><xMotivo>Rejeicao: Falha no Schema XML</xMotivo></retEnviNFe>')).toMatchObject({ status: 'REJEITADA', cStat: '225' });
  });

  it('103 (lote recebido) → consulta o recibo (NFeRetAutorizacao4) → 104 com protocolo 100', async () => {
    const calls: string[] = [];
    setHttpMock((req) => {
      calls.push(req.url);
      expect(req.headers?.['Content-Type']).toContain('application/soap+xml; charset=utf-8');
      expect(req.pfx?.password).toBe('senha123');
      if (req.url.includes('nfeautorizacao4')) return { status: 200, text: soapResp('<retEnviNFe versao="4.00"><tpAmb>2</tpAmb><cStat>103</cStat><xMotivo>Lote recebido com sucesso</xMotivo><infRec><nRec>351000000000123</nRec><tMed>1</tMed></infRec></retEnviNFe>') };
      expect(String(req.body)).toContain('<consReciNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><nRec>351000000000123</nRec></consReciNFe>');
      return { status: 200, text: soapResp(`<retConsReciNFe versao="4.00"><tpAmb>2</tpAmb><nRec>351000000000123</nRec><cStat>104</cStat><xMotivo>Lote processado</xMotivo>${prot('100', 'Autorizado o uso da NF-e')}</retConsReciNFe>`, 'NFeRetAutorizacao4') };
    });
    const r = await autorizar(ctx, 55, '<NFe xmlns="http://www.portalfiscal.inf.br/nfe"></NFe>', { pollMs: 0 });
    expect(calls).toEqual(['https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx']);
    expect(r).toMatchObject({ status: 'AUTORIZADA', cStat: '100', nProt: '135260000000001' });
  });

  it('103 → 105 persistente fica PROCESSANDO com o recibo', async () => {
    setHttpMock((req) => ({ status: 200, text: req.url.includes('nfeautorizacao4') ? soapResp('<retEnviNFe><cStat>103</cStat><xMotivo>Lote recebido</xMotivo><infRec><nRec>351000000000999</nRec></infRec></retEnviNFe>') : soapResp('<retConsReciNFe><cStat>105</cStat><xMotivo>Lote em processamento</xMotivo><nRec>351000000000999</nRec></retConsReciNFe>') }));
    const r = await autorizar(ctx, 55, '<NFe></NFe>', { pollMs: 0, attempts: 2 });
    expect(r).toMatchObject({ status: 'PROCESSANDO', nRec: '351000000000999' });
  });

  it('SOAP Fault vira erro de integração', async () => {
    setHttpMock(() => ({ status: 500, text: '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><soap:Fault><soap:Reason><soap:Text xml:lang="pt">Certificado nao confiavel</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>' }));
    await expect(autorizar(ctx, 55, '<NFe></NFe>')).rejects.toThrow('Certificado nao confiavel');
  });

  it('eventos (135) e Distribuição DF-e (docZip base64+gzip)', () => {
    const ev = parseEvento('<retEnvEvento><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo><retEvento versao="1.00"><infEvento><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><nProt>135260000000777</nProt></infEvento></retEvento></retEnvEvento>');
    expect(ev).toMatchObject({ ok: true, cStat: '135', nProt: '135260000000777', loteStat: '128' });
    const res = `<resNFe xmlns="${NS.NFE}" versao="1.01"><chNFe>${KEY}</chNFe><CNPJ>04252011000110</CNPJ><xNome>Fornecedor SA</xNome><IE>123</IE><dhEmi>2026-10-10T10:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>1500.00</vNF><cSitNFe>1</cSitNFe></resNFe>`;
    const d = parseDistDFe(`<retDistDFeInt versao="1.01"><tpAmb>1</tpAmb><cStat>138</cStat><xMotivo>Documento localizado</xMotivo><ultNSU>000000000000201</ultNSU><maxNSU>000000000000205</maxNSU><loteDistDFeInt><docZip NSU="000000000000201" schema="resNFe_v1.01.xsd">${gzipB64(res)}</docZip></loteDistDFeInt></retDistDFeInt>`);
    expect(d.cStat).toBe('138');
    expect(d.ultNSU).toBe('000000000000201');
    expect(d.docs[0]).toMatchObject({ nsu: '000000000000201', schema: 'resNFe_v1.01.xsd' });
    expect(d.docs[0].xml).toContain('<xNome>Fornecedor SA</xNome>');
  });
});

describe('NFC-e — QR Code v2', () => {
  const key = '35200505730928000145650010000001421000001006';
  const csc = 'G8063VRTNDMO886SFNK5LDUDEI24XJ22YIPO';
  it('online: hash SHA-1 com o CSC (valor de referência)', () => {
    expect(cscIdToken('000001')).toBe('1');
    expect(nfceQrParam({ uf: 'SP', accessKey: key, tpAmb: 2, cscId: '000001', csc })).toBe(`${key}|2|2|1|65AF011D30299E3E1DCCE12BA8D24A4359DB433B`);
    expect(nfceQrCode({ uf: 'SP', accessKey: key, tpAmb: 2, cscId: '000001', csc })).toBe(`https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode?p=${key}|2|2|1|65AF011D30299E3E1DCCE12BA8D24A4359DB433B`);
  });
  it('offline (tpEmis 9): dia, valor e DigestValue em hexadecimal', () => {
    const p = nfceQrParam({ uf: 'SP', accessKey: key, tpAmb: 2, cscId: '1', csc, offline: { issueDate: new Date(), total: 150, digestValue: 'Kq6ehpZbqYZ7vVfB4hJ3dSq9G3M=', dayUF: '16' } });
    expect(p).toBe(`${key}|2|2|16|150.00|4b71366568705a6271595a377656664234684a336453713947334d3d|1|ABA2E1336430528EEE98393383D8245C316484F5`);
  });
});

describe('Eventos e inutilização assinados (XMLDSig verificável)', () => {
  it('cancelamento 110111', () => {
    const ev = buildEvento(ctx, { chNFe: KEY, tpEvento: '110111', det: detCancelamento('135260000000001', 'Pedido cancelado pelo cliente antes do envio'), idLote: '1', date: new Date('2026-10-16T13:00:00Z') });
    expect(ev.id).toBe(`ID110111${KEY}01`);
    expect(ev.xml).toContain(`<envEvento xmlns="${NS.NFE}" versao="1.00"><idLote>1</idLote><evento xmlns="${NS.NFE}" versao="1.00"><infEvento Id="ID110111${KEY}01"><cOrgao>35</cOrgao><tpAmb>2</tpAmb><CNPJ>${CNPJ}</CNPJ><chNFe>${KEY}</chNFe><dhEvento>2026-10-16T10:00:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>135260000000001</nProt>`);
    expect(verifySignature(canonicalOf(ev.inf, 'infEvento', NS.NFE), ev.signature)).toBe(true);
    expect(verifySignature(canonicalOf(ev.inf.replace('135260000000001', '135260000000002'), 'infEvento', NS.NFE), ev.signature)).toBe(false);
  });
  it('CC-e com a condição de uso oficial e inutilização', () => {
    const cce = buildEvento(ctx, { chNFe: KEY, tpEvento: '110110', nSeqEvento: 2, det: detCCe('Corrigir o endereco de entrega para Rua B, 100') });
    expect(cce.id).toBe(`ID110110${KEY}02`);
    expect(cce.inf).toContain(`<xCondUso>${CCE_COND}</xCondUso>`);
    expect(verifySignature(canonicalOf(cce.inf, 'infEvento', NS.NFE), cce.signature)).toBe(true);
    const inut = buildInutNFe(ctx, { mod: 55, serie: 1, nIni: 10, nFin: 12, xJust: 'Falha no sistema pulou a numeracao', ano: 2026 });
    expect(inut.id).toBe(`ID3526${CNPJ}55001000000010000000012`);
    expect(verifySignature(canonicalOf(inut.inf, 'infInut', NS.NFE), inut.signature)).toBe(true);
  });
});

describe('XML da NF-e/NFC-e (leiaute 4.00)', () => {
  const company: any = { id: 'c', uf: 'SP', cnpj: CNPJ, ie: '110042490114', name: 'Empresa Teste Ltda', tradeName: 'Teste', crt: 3, street: 'Av. Paulista', number: '1000', district: 'Bela Vista', city: 'São Paulo', cityCode: '3550308', zip: '01310100', phone: '1130000000', certPfx: pfx, certPassword: 'senha123', cscId: '000001', cscToken: 'G8063VRTNDMO886SFNK5LDUDEI24XJ22YIPO' };
  const item: any = { id: 'i', productId: 'p', code: 'P1', description: 'Produto teste', ncm: '61091000', cfop: '6102', cst: '00', unit: 'UN', quantity: 2, unitPrice: 50, total: 100, icmsBase: 100, icmsRate: 12, icmsValue: 12, ipiRate: 0, ipiValue: 0, pisRate: 0.65, pisValue: 0.65, cofinsRate: 3, cofinsValue: 3, icmsStBase: 0, icmsStValue: 0, difalValue: 10, fcpValue: 2, ibsRate: 0, ibsValue: 0, cbsRate: 0, cbsValue: 0, issRate: 0, issValue: 0 };
  const inv: any = { id: 'n', model: 'NFE', number: 123, series: 1, accessKey: KEY, natureName: 'Venda de mercadoria', direction: 'SAIDA', finalidade: 1, customerName: 'Cliente', customerDoc: '52998224725', customerUf: 'RJ', productsTotal: 100, freight: 10, discount: 0, total: 110, approxTaxes: 30, cbsValue: 0, ibsValue: 0, contingency: false, protocol: null, authorizedAt: null, issueDate: new Date(), additionalInfo: 'Teste', refAccessKey: null, items: [item] };
  const customer: any = { name: 'Cliente', document: '52998224725', ieIndicator: 9, street: 'Rua A', number: '10', district: 'Centro', city: 'Rio de Janeiro', uf: 'RJ', zip: '20000000', email: 'c@x.com' };

  it('ordem dos grupos, homologação no destinatário, DIFAL e totais; assinatura válida', () => {
    const r = buildXml(inv, company, { customer, destCityCode: '3304557', tpAmb: 2, dhEmi: new Date('2026-10-16T13:00:00Z'), noProt: true, paymentMethod: 'PIX' });
    const x = r.nfe;
    const order = ['<ide>', '<emit>', '<dest>', '<det nItem="1">', '<total>', '<transp>', '<pag>', '<infAdic>'].map((t) => x.indexOf(t));
    expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]))).toBe(true);
    expect(x).toContain('<dhEmi>2026-10-16T10:00:00-03:00</dhEmi>');
    expect(x).toContain('<idDest>2</idDest>');
    expect(x).toContain('<indPres>9</indPres><indIntermed>0</indIntermed>');
    expect(x).toContain('<xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xNome><enderDest><xLgr>Rua A</xLgr><nro>10</nro><xBairro>Centro</xBairro><cMun>3304557</cMun>');
    expect(x).toContain('<vFrete>10.00</vFrete><indTot>1</indTot>');
    expect(x).toContain('<pICMSInter>12.00</pICMSInter><pICMSInterPart>100.0000</pICMSInterPart>');
    expect(x).toContain('<vICMSDeson>0.00</vICMSDeson><vFCPUFDest>2.00</vFCPUFDest><vICMSUFDest>10.00</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet><vFCP>0.00</vFCP>');
    expect(x).toContain('<vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.65</vPIS><vCOFINS>3.00</vCOFINS><vOutro>0.00</vOutro><vNF>110.00</vNF>');
    expect(x).toContain('<detPag><tPag>17</tPag><vPag>110.00</vPag></detPag>');
    expect(x).not.toContain('<protNFe');
    expect(r.signed).toBe(true);
    const parts = extractSignedParts(r.xml)!;
    expect(verifySignature(parts.canonical, parts.signature)).toBe(true);
  });

  it('NFC-e: infNFeSupl com QR Code v2 e urlChave; 1º item com texto de homologação', () => {
    const nfceKey = '35261011444777000161650010000000451000000452';
    const r = buildXml({ ...inv, model: 'NFCE', accessKey: nfceKey, customerUf: 'SP', total: 100, freight: 0 }, company, { tpAmb: 2, noProt: true, dhEmi: new Date('2026-10-16T13:00:00Z') });
    expect(r.nfe).toMatch(/<\/infNFe><infNFeSupl><qrCode>https:\/\/www\.homologacao\.nfce\.fazenda\.sp\.gov\.br\/qrcode\?p=35261011444777000161650010000000451000000452\|2\|2\|1\|[0-9A-F]{40}<\/qrCode><urlChave>https:\/\/www\.homologacao\.nfce\.fazenda\.sp\.gov\.br\/consulta<\/urlChave><\/infNFeSupl><Signature/);
    expect(r.nfe).toContain('<xProd>NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xProd>');
    expect(r.nfe).toContain('<tpImp>4</tpImp>');
    expect(r.nfe).not.toContain('<indIntermed>');
    expect(dhUF(new Date('2026-10-16T13:00:00Z'), 'AM')).toBe('2026-10-16T09:00:00-04:00');
  });
});

describe('NFS-e Nacional (DPS) e GNRE', () => {
  it('DPS 1.00 assinada com Id no padrão nacional', () => {
    const company: any = { cnpj: CNPJ, uf: 'SP', crt: 1, im: '12345', email: 'a@b.com', certPfx: pfx, certPassword: 'senha123' };
    const inv: any = { number: 7, series: 1, customerName: 'Tomador', customerDoc: '52998224725', servicesTotal: 300, discount: 0, items: [{ description: 'Consultoria', quantity: 1, unitPrice: 300, issRate: 2 }] };
    const dps = buildDps(inv, company, { tpAmb: 2, date: new Date('2026-10-16T13:00:00Z'), cityCode: '3550308', serviceCode: '17.01' });
    expect(dps.id).toBe(dpsId('3550308', CNPJ, 1, 7));
    expect(dps.id).toBe(`DPS35503082${CNPJ}00001000000000000007`);
    expect(dps.xml).toContain(`<DPS xmlns="${NS.NFSE}" versao="1.00"><infDPS Id="${dps.id}"><tpAmb>2</tpAmb><dhEmi>2026-10-16T10:00:00-03:00</dhEmi>`);
    expect(dps.xml).toContain('<cTribNac>170101</cTribNac>');
    expect(cTribNac('14.01')).toBe('140101');
    expect(verifySignature(canonicalOf(dps.inf, 'infDPS', NS.NFSE), dps.signature)).toBe(true);
  });

  it('código de barras de arrecadação (8…) com DV módulo 10 e lote TLote_GNRE 2.00', () => {
    const b = arrecadacaoBarcode({ amount: 123.45, uf: 'RJ', dueDate: new Date('2026-10-16T12:00:00Z'), revenueCode: '100102', ref: '123' });
    expect(b.barcode).toHaveLength(44);
    expect(b.barcode.startsWith('856')).toBe(true);
    expect(b.barcode.slice(4, 15)).toBe('00000012345');
    expect(validArrecadacao(b.barcode)).toBe(true);
    expect(b.line).toHaveLength(48);
    const lote = buildGnreLote({ cnpj: CNPJ, name: 'Empresa', uf: 'SP', cityCode: '3550308', street: 'Rua', number: '1', zip: '01310100' } as any, { number: 10, accessKey: KEY, customerName: 'Cliente', customerDoc: '52998224725' }, [{ revenueCode: '100102', amount: 123.45, uf: 'RJ', dueDate: new Date('2026-10-16T12:00:00Z') }]);
    expect(lote).toContain('<TLote_GNRE xmlns="http://www.gnre.pe.gov.br" versao="2.00"><guias><TDadosGNRE versao="2.00"><ufFavorecida>RJ</ufFavorecida>');
    expect(lote).toContain('<receita>100102</receita>');
    expect(lote).toContain('<valor tipo="11">123.45</valor>');
    expect(lote).toContain('<municipio>50308</municipio>');
  });
});
