/**
 * NFS-e — Padrão Nacional (Sefin Nacional / ADN, leiaute DPS 1.00).
 * Gera a DPS (Declaração de Prestação de Serviço), assina com o certificado A1
 * e envia em JSON { dpsXmlGZipB64 } para POST /nfse com mTLS. A NFS-e
 * autorizada volta em nfseXmlGZipB64 (chave de acesso de 50 dígitos).
 * Cancelamento: evento e101101 (pedRegEvento) em POST /nfse/{chave}/eventos.
 * Municípios não aderentes ao padrão nacional: use o provedor Focus NFe.
 */
import type { Company, Contact, Invoice, InvoiceItem } from '@prisma/client';
import { prisma } from '@/lib/db';
import { onlyDigits } from '@/lib/utils';
import { fail } from '../errors';
import { httpRequest, IntegrationError } from '@/server/integrations/http';
import { finishAuthorization, rejectLocal, reload } from './fiscal';
import { resolveCityCode } from './sefaz/ibge';
import { nfseNacionalBase } from './sefaz/urls';
import { NS, dUF, dhUF, gzipB64, signInf, tag, txt, unzipB64, dec } from './sefaz/xml';

type Inv = Invoice & { items: InvoiceItem[] };

/** Código de tributação nacional (cTribNac, 6 dígitos) a partir do item da LC 116 (ex.: 14.01 → 140101) */
export function cTribNac(serviceCode?: string | null) {
  const [item, sub = '01'] = String(serviceCode || '01.01').split(/[.\-]/);
  return `${onlyDigits(item).padStart(2, '0').slice(-2)}${onlyDigits(sub).padStart(2, '0').slice(0, 2)}01`;
}

export type DpsInput = {
  tpAmb: 1 | 2; date: Date; cityCode: string; serie?: number; customer?: Contact | null; customerCityCode?: string | null; serviceCode?: string | null;
};

/** Id da DPS: "DPS" + cMun(7) + tipo de inscrição (1 CPF / 2 CNPJ) + inscrição(14) + série(5) + nº DPS(15) */
export const dpsId = (cityCode: string, cnpj: string, serie: number, nDps: number) => `DPS${cityCode.padStart(7, '0')}2${onlyDigits(cnpj).padStart(14, '0')}${String(serie).padStart(5, '0')}${String(nDps).padStart(15, '0')}`;

/** Monta e (havendo certificado) assina a DPS */
export function buildDps(inv: Inv, company: Company, o: DpsInput) {
  const serie = o.serie ?? inv.series ?? 1;
  const id = dpsId(o.cityCode, company.cnpj, serie, inv.number);
  const sn = company.crt === 1;
  const doc = onlyDigits(o.customer?.document || inv.customerDoc);
  const c = o.customer;
  const end = c?.street && o.customerCityCode && onlyDigits(c.zip).length === 8
    ? `<end><endNac><cMun>${o.customerCityCode}</cMun><CEP>${onlyDigits(c.zip)}</CEP></endNac><xLgr>${txt(c.street, 255)}</xLgr><nro>${txt(c.number || 'S/N', 60)}</nro>${c.complement ? `<xCpl>${txt(c.complement, 156)}</xCpl>` : ''}<xBairro>${txt(c.district || 'Centro', 60)}</xBairro></end>`
    : '';
  const toma = doc
    ? `<toma>${doc.length === 14 ? `<CNPJ>${doc}</CNPJ>` : `<CPF>${doc}</CPF>`}<xNome>${txt(c?.name || inv.customerName, 300)}</xNome>${end}${c?.email ? `<email>${txt(c.email, 80)}</email>` : ''}</toma>`
    : '';
  const description = inv.items.map((i) => `${i.description}${i.quantity !== 1 ? ` (${i.quantity} x ${dec(i.unitPrice)})` : ''}`).join('; ');
  const rate = inv.items[0]?.issRate || 0;
  // Conferir na documentação: regras de pAliq/totTrib por regime (Simples Nacional informa a alíquota)
  const trib = `<trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN>${sn && rate ? `<pAliq>${dec(rate)}</pAliq>` : ''}</tribMun><totTrib>${sn ? `<pTotTribSN>${dec(rate)}</pTotTribSN>` : '<indTotTrib>0</indTotTrib>'}</totTrib></trib>`;
  const inf =
    `<infDPS Id="${id}"><tpAmb>${o.tpAmb}</tpAmb><dhEmi>${dhUF(o.date, company.uf)}</dhEmi><verAplic>GestaoPro2.0</verAplic><serie>${serie}</serie><nDPS>${inv.number}</nDPS><dCompet>${dUF(o.date, company.uf)}</dCompet><tpEmit>1</tpEmit><cLocEmi>${o.cityCode}</cLocEmi>` +
    `<prest><CNPJ>${onlyDigits(company.cnpj)}</CNPJ>${onlyDigits(company.im) ? `<IM>${onlyDigits(company.im)}</IM>` : ''}${company.email ? `<email>${txt(company.email, 80)}</email>` : ''}<regTrib><opSimpNac>${sn ? 3 : 1}</opSimpNac>${sn ? '<regApTribSN>1</regApTribSN>' : ''}<regEspTrib>0</regEspTrib></regTrib></prest>` +
    `${toma}<serv><locPrest><cLocPrestacao>${o.cityCode}</cLocPrestacao></locPrest><cServ><cTribNac>${cTribNac(o.serviceCode)}</cTribNac><xDescServ>${txt(description, 2000)}</xDescServ></cServ></serv>` +
    `<valores><vServPrest><vServ>${dec(inv.servicesTotal)}</vServ></vServPrest>${inv.discount ? `<vDescCondIncond><vDescIncond>${dec(inv.discount)}</vDescIncond></vDescCondIncond>` : ''}${trib}</valores></infDPS>`;
  let signature = '';
  if (company.certPfx && company.certPassword) signature = signInf(inf, 'infDPS', NS.NFSE, Buffer.from(company.certPfx), company.certPassword);
  return { id, inf, signature, xml: `<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="${NS.NFSE}" versao="1.00">${inf}${signature}</DPS>` };
}

/** Pedido de registro de evento de cancelamento (e101101). Conferir na documentação: composição do Id (PRE + chave + evento + nº do pedido) */
export function buildCancelEvent(company: Company, chave: string, reason: string, o: { tpAmb: 1 | 2; date?: Date; motivo?: 1 | 2 | 9; seq?: number }) {
  const seq = o.seq || 1;
  const id = `PRE${chave}101101${String(seq).padStart(3, '0')}`;
  const inf = `<infPedReg Id="${id}"><tpAmb>${o.tpAmb}</tpAmb><verAplic>GestaoPro2.0</verAplic><dhEvento>${dhUF(o.date || new Date(), company.uf)}</dhEvento><CNPJAutor>${onlyDigits(company.cnpj)}</CNPJAutor><chNFSe>${chave}</chNFSe><nPedRegEvento>${seq}</nPedRegEvento><e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>${o.motivo || 1}</cMotivo><xMotivo>${txt(reason, 255)}</xMotivo></e101101></infPedReg>`;
  const signature = company.certPfx && company.certPassword ? signInf(inf, 'infPedReg', NS.NFSE, Buffer.from(company.certPfx), company.certPassword) : '';
  return { id, xml: `<?xml version="1.0" encoding="UTF-8"?><pedRegEvento xmlns="${NS.NFSE}" versao="1.00">${inf}${signature}</pedRegEvento>` };
}

/** Mensagens de erro do Sefin ({ erros: [{ Codigo, Descricao, Complemento }] }) */
export function nfseErrors(d: any, status: number) {
  const list = d?.erros || d?.Erros || d?.errors || [];
  if (Array.isArray(list) && list.length) return list.map((e: any) => `${e.Codigo || e.codigo || ''} ${e.Descricao || e.descricao || e.message || ''}${e.Complemento || e.complemento ? ` (${e.Complemento || e.complemento})` : ''}`.trim()).join('; ');
  return typeof d === 'string' && d ? d.slice(0, 300) : d?.message || d?.title || `HTTP ${status}`;
}

const pfxOf = (c: Company) => {
  if (!c.certPfx || !c.certPassword) fail(400, 'Instale o certificado digital A1 para emitir a NFS-e Nacional');
  return { data: Buffer.from(c.certPfx!), password: c.certPassword! };
};

/** Emite a NFS-e no Sefin Nacional */
export async function transmitNfseNacional(company: Company, invoice: Inv, orgId: string, userName?: string) {
  if (!company.certValidUntil || company.certValidUntil < new Date()) return rejectLocal(invoice.id, '280', 'Rejeição: certificado digital A1 ausente ou vencido');
  const cityCode = onlyDigits(company.cityCode);
  if (cityCode.length !== 7) return rejectLocal(invoice.id, 'E0004', 'Cadastre o código IBGE do município da empresa (Configurações → Empresas)');
  const tpAmb: 1 | 2 = company.nfeEnvironment === 1 ? 1 : 2;
  const customer = invoice.customerId ? await prisma.contact.findUnique({ where: { id: invoice.customerId } }) : null;
  const customerCityCode = customer?.city ? await resolveCityCode(customer.uf, customer.city, { companyId: company.id, online: true }) : null;
  const sid = invoice.items.find((i) => i.serviceId)?.serviceId;
  const service = sid ? await prisma.service.findUnique({ where: { id: sid } }) : null;
  const now = new Date();
  const dps = buildDps(invoice, company, { tpAmb, date: now, cityCode, customer, customerCityCode, serviceCode: service?.serviceCode });
  await prisma.invoice.update({ where: { id: invoice.id }, data: { environment: tpAmb, xml: dps.xml, signed: !!dps.signature, issueDate: now } });
  await prisma.invoiceEvent.create({ data: { invoiceId: invoice.id, type: 'TRANSMISSAO', description: `DPS enviada ao Sefin Nacional (${tpAmb === 1 ? 'produção' : 'produção restrita'})` } });
  let res;
  try {
    res = await httpRequest({ provider: 'NFSE_NACIONAL', companyId: company.id, url: `${nfseNacionalBase(tpAmb)}/nfse`, method: 'POST', body: { dpsXmlGZipB64: gzipB64(dps.xml) }, pfx: pfxOf(company), timeoutMs: 60000 });
  } catch (e) {
    return rejectLocal(invoice.id, 'COMUNICACAO', `Falha de comunicação com o Sefin Nacional: ${(e as Error).message}`);
  }
  const d = res.data as any;
  if (!res.ok || !d?.chaveAcesso) return rejectLocal(invoice.id, String(d?.erros?.[0]?.Codigo || d?.erros?.[0]?.codigo || res.status), nfseErrors(d, res.status));
  const xml = d.nfseXmlGZipB64 ? unzipB64(d.nfseXmlGZipB64) : null;
  const nNFSe = tag(xml, 'nNFSe');
  const alerts = Array.isArray(d.alertas) && d.alertas.length ? ` Alertas: ${nfseErrors({ erros: d.alertas }, 200)}` : '';
  return finishAuthorization(company.id, orgId, invoice, {
    protocol: nNFSe || d.chaveAcesso, authorizedAt: d.dataHoraProcessamento ? new Date(d.dataHoraProcessamento) : now, xml, procXml: xml, cStat: '100',
    description: `NFS-e Nacional autorizada nº ${nNFSe || '-'} — chave ${d.chaveAcesso}.${alerts}`, userName, accessKey: d.chaveAcesso, verificationCode: nNFSe || String(d.chaveAcesso).slice(-9),
  });
}

/** Consulta a NFS-e pela chave (GET /nfse/{chave}) */
export async function consultNfseNacional(company: Company, chave: string) {
  const tpAmb: 1 | 2 = company.nfeEnvironment === 1 ? 1 : 2;
  const res = await httpRequest({ provider: 'NFSE_NACIONAL', companyId: company.id, url: `${nfseNacionalBase(tpAmb)}/nfse/${chave}`, method: 'GET', pfx: pfxOf(company) });
  if (!res.ok) throw new IntegrationError(`NFS-e Nacional: ${nfseErrors(res.data, res.status)}`, res.status);
  return { chave, xml: (res.data as any)?.nfseXmlGZipB64 ? unzipB64((res.data as any).nfseXmlGZipB64) : null };
}

/** Cancela a NFS-e (evento e101101) */
export async function cancelNfseNacional(company: Company, invoice: Invoice, reason: string) {
  if (!invoice.accessKey) fail(400, 'NFS-e sem chave de acesso');
  const tpAmb: 1 | 2 = invoice.environment === 1 ? 1 : 2;
  const ev = buildCancelEvent(company, invoice.accessKey!, reason, { tpAmb });
  const res = await httpRequest({ provider: 'NFSE_NACIONAL', companyId: company.id, url: `${nfseNacionalBase(tpAmb)}/nfse/${invoice.accessKey}/eventos`, method: 'POST', body: { pedidoRegistroEventoXmlGZipB64: gzipB64(ev.xml) }, pfx: pfxOf(company), timeoutMs: 60000 });
  const d = res.data as any;
  if (!res.ok) {
    await prisma.invoiceEvent.create({ data: { invoiceId: invoice.id, type: 'REJEICAO', description: `Cancelamento rejeitado: ${nfseErrors(d, res.status)}` } });
    fail(400, `Cancelamento rejeitado: ${nfseErrors(d, res.status)}`);
  }
  const evXml = d?.eventoXmlGZipB64 ? unzipB64(d.eventoXmlGZipB64) : '';
  return { protocol: tag(evXml, 'nDFe') || tag(evXml, 'nSeqEvento') || '', code: '135', description: 'Evento de cancelamento da NFS-e registrado no ADN' };
}

export { reload as reloadInvoice };
