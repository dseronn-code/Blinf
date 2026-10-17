import { describe, it, expect } from 'vitest';
import { generateDemoCertificate, verifySignature } from '@/server/services/cert';
import { isValidAccessKey } from '@/lib/br';
import { mdfeKey, buildMdfeXml, buildMdfeEvent, detEncerramento, detCancelamentoMdfe, parseRetMdfe, parseRetEventoMdfe, mdfeQrUrl } from '@/server/services/mdfe';
import { soapEnvelope } from '@/server/services/sefaz/soap';
import { mdfeUrl } from '@/server/services/sefaz/urls';
import { canonicalOf, NS } from '@/server/services/sefaz/xml';

const CNPJ = '11444777000161';
const pfx = generateDemoCertificate('Empresa Teste Ltda', CNPJ, 'senha123');
const company: any = { id: 'c', uf: 'SP', cnpj: CNPJ, ie: '110042490114', name: 'Empresa Teste Ltda', tradeName: 'Teste', street: 'Av. Paulista', number: '1000', district: 'Bela Vista', city: 'São Paulo', cityCode: '3550308', zip: '01310100', certPfx: pfx, certPassword: 'senha123' };
const NFE1 = '35261011444777000161550010000001231000000010';
const m: any = {
  id: 'm', number: 15, series: 1, status: 'RASCUNHO', environment: 2, ufStart: 'SP', ufEnd: 'GO', route: ['MG'], loadCity: 'São Paulo', loadCityCode: '3550308', unloadCity: 'Goiânia', unloadCityCode: '5208707',
  vehiclePlate: 'ABC1D23', vehicleTara: 5000, vehicleUf: 'SP', rntrc: '12345678', driverName: 'João Motorista', driverCpf: '52998224725', invoiceKeys: [NFE1], totalValue: 1500, totalWeight: 120.5, events: [],
};

describe('MDF-e modelo 58 (3.00)', () => {
  it('chave de acesso com modelo 58 e DV válido', () => {
    const key = mdfeKey(company, m, new Date('2026-10-16T12:00:00Z'), '12345678');
    expect(key).toHaveLength(44);
    expect(key.slice(0, 2)).toBe('35');
    expect(key.slice(2, 6)).toBe('2610');
    expect(key.slice(6, 20)).toBe(CNPJ);
    expect(key.slice(20, 22)).toBe('58');
    expect(key.slice(22, 25)).toBe('001');
    expect(key.slice(25, 34)).toBe('000000015');
    expect(key[34]).toBe('1');
    expect(key.slice(35, 43)).toBe('12345678');
    expect(isValidAccessKey(key)).toBe(true);
  });

  it('XML com os grupos obrigatórios, na ordem, e assinatura verificável', () => {
    const key = mdfeKey(company, m, new Date('2026-10-16T12:00:00Z'), '12345678');
    const r = buildMdfeXml(m, company, { tpAmb: 2, key, dhEmi: new Date('2026-10-16T13:00:00Z') });
    const x = r.xml;
    expect(x.startsWith(`<MDFe xmlns="${NS.MDFE}"><infMDFe Id="MDFe${key}" versao="3.00"><ide><cUF>35</cUF><tpAmb>2</tpAmb><tpEmit>2</tpEmit><mod>58</mod><serie>1</serie><nMDF>15</nMDF><cMDF>12345678</cMDF><cDV>${key.slice(-1)}</cDV><modal>1</modal><dhEmi>2026-10-16T10:00:00-03:00</dhEmi>`)).toBe(true);
    const order = ['<ide>', '<UFIni>SP</UFIni>', '<UFFim>GO</UFFim>', '<infMunCarrega><cMunCarrega>3550308</cMunCarrega>', '<infPercurso><UFPer>MG</UFPer></infPercurso>', '<emit>', '<enderEmit>', '<infModal versaoModal="3.00"><rodo>', '<infANTT><RNTRC>12345678</RNTRC></infANTT>', '<veicTracao><placa>ABC1D23</placa><tara>5000</tara><condutor><xNome>João Motorista</xNome><CPF>52998224725</CPF></condutor>', '<infDoc><infMunDescarga><cMunDescarga>5208707</cMunDescarga>', `<infNFe><chNFe>${NFE1}</chNFe></infNFe>`, '<tot><qNFe>1</qNFe><vCarga>1500.00</vCarga><cUnid>01</cUnid><qCarga>120.5000</qCarga></tot>', '<infAdic>', '</infMDFe><infMDFeSupl><qrCodMDFe>', '<Signature'].map((t) => x.indexOf(t));
    expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]))).toBe(true);
    expect(x).toContain(mdfeQrUrl(key, 2).replace('&', '&amp;'));
    expect(r.signed).toBe(true);
    expect(verifySignature(canonicalOf(r.inf, 'infMDFe', NS.MDFE), r.signature)).toBe(true);
  });

  it('eventos de encerramento e cancelamento assinados; retornos', () => {
    const ctx = { cUF: '35', tpAmb: 2 as const, cnpj: CNPJ, uf: 'SP', pfx: { data: pfx, password: 'senha123' } };
    const key = mdfeKey(company, m, new Date(), '87654321');
    const enc = buildMdfeEvent(ctx, { chMDFe: key, tpEvento: '110112', det: detEncerramento('935260000000001', '2026-10-17', '52', '5208707') });
    expect(enc.id).toBe(`ID110112${key}01`);
    expect(enc.xml).toContain('<detEvento versaoEvento="3.00"><evEncMDFe><descEvento>Encerramento</descEvento><nProt>935260000000001</nProt><dtEnc>2026-10-17</dtEnc><cUF>52</cUF><cMun>5208707</cMun></evEncMDFe></detEvento>');
    const inf = enc.xml.match(/<infEvento[\s\S]*<\/infEvento>/)![0];
    const sig = enc.xml.match(/<Signature[\s\S]*<\/Signature>/)![0];
    expect(verifySignature(canonicalOf(inf, 'infEvento', NS.MDFE), sig)).toBe(true);
    expect(buildMdfeEvent(ctx, { chMDFe: key, tpEvento: '110111', det: detCancelamentoMdfe('935260000000001', 'Viagem nao realizada por problema mecanico') }).xml).toContain('<evCancMDFe><descEvento>Cancelamento</descEvento>');
    expect(parseRetMdfe(`<retMDFe><cStat>104</cStat><protMDFe versao="3.00"><infProt><chMDFe>${key}</chMDFe><nProt>935260000000001</nProt><cStat>100</cStat><xMotivo>Autorizado o uso do MDF-e</xMotivo></infProt></protMDFe></retMDFe>`)).toMatchObject({ ok: true, cStat: '100', nProt: '935260000000001' });
    expect(parseRetEventoMdfe('<retEventoMDFe><infEvento><cStat>135</cStat><xMotivo>Evento registrado</xMotivo><nProt>9352</nProt></infEvento></retEventoMDFe>')).toMatchObject({ ok: true, nProt: '9352' });
    expect(mdfeUrl('MDFeRecepcaoSinc', 2)).toBe('https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeRecepcaoSinc/MDFeRecepcaoSinc.asmx');
    expect(soapEnvelope('MDFeRecepcaoSinc', 'H4sI', { ns: 'http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeRecepcaoSinc', dataTag: 'mdfeDadosMsg' })).toContain('<mdfeDadosMsg xmlns="http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeRecepcaoSinc">H4sI</mdfeDadosMsg>');
  });
});
