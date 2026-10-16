/**
 * Envelope SOAP 1.2 dos webservices da NF-e 4.00 / MDF-e 3.00 / GNRE e envio
 * com autenticação mútua (certificado A1 do contribuinte).
 */
import { httpRequest, IntegrationError } from '@/server/integrations/http';
import { stripDecl } from './xml';

export const WSDL = 'http://www.portalfiscal.inf.br/nfe/wsdl/';

/** Operação (soapAction) de cada serviço */
export const OPERATION: Record<string, string> = {
  NFeAutorizacao4: 'nfeAutorizacaoLote',
  NFeRetAutorizacao4: 'nfeRetAutorizacaoLote',
  NFeStatusServico4: 'nfeStatusServicoNF',
  NFeConsultaProtocolo4: 'nfeConsultaNF',
  NFeInutilizacao4: 'nfeInutilizacaoNF',
  NFeRecepcaoEvento4: 'nfeRecepcaoEvento',
  NFeDistribuicaoDFe: 'nfeDistDFeInteresse',
  MDFeRecepcaoSinc: 'mdfeRecepcao',
  MDFeRecepcaoEvento: 'mdfeRecepcaoEvento',
  MDFeStatusServico: 'mdfeStatusServicoMDF',
  GnreLoteRecepcao: 'processar',
  GnreResultadoLote: 'consultar',
};

export type SoapOptions = {
  /** namespace do serviço (padrão: wsdl da NF-e + serviço) */
  ns?: string;
  /** elemento de dados (nfeDadosMsg, mdfeDadosMsg, gnreDadosMsg) */
  dataTag?: string;
  /** cabeçalho SOAP (MDF-e e GNRE ainda usam *CabecMsg) */
  header?: string;
  /** a Distribuição DF-e envolve nfeDadosMsg no elemento da operação */
  wrapOperation?: boolean;
};

/** Monta o envelope SOAP 1.2 */
export function soapEnvelope(service: string, payload: string, opts: SoapOptions = {}) {
  const ns = opts.ns || `${WSDL}${service}`;
  const dataTag = opts.dataTag || 'nfeDadosMsg';
  const body = opts.wrapOperation
    ? `<${OPERATION[service]} xmlns="${ns}"><${dataTag}>${stripDecl(payload)}</${dataTag}></${OPERATION[service]}>`
    : `<${dataTag} xmlns="${ns}">${stripDecl(payload)}</${dataTag}>`;
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">${opts.header ? `<soap12:Header>${opts.header}</soap12:Header>` : ''}<soap12:Body>${body}</soap12:Body></soap12:Envelope>`;
}

export const soapContentType = (service: string, ns?: string) => `application/soap+xml; charset=utf-8; action="${ns || `${WSDL}${service}`}/${OPERATION[service]}"`;

export type SoapCall = { provider?: string; companyId: string; url: string; service: string; payload: string; pfx: { data: Buffer; password: string }; timeoutMs?: number } & SoapOptions;

/** Envia ao webservice e devolve o conteúdo do Body (retorno do serviço) */
export async function soapCall(c: SoapCall): Promise<string> {
  const envelope = soapEnvelope(c.service, c.payload, c);
  const res = await httpRequest<string>({
    provider: c.provider || 'SEFAZ', companyId: c.companyId, url: c.url, method: 'POST', body: envelope, pfx: c.pfx, timeoutMs: c.timeoutMs || 45000,
    headers: { 'Content-Type': soapContentType(c.service, c.ns), Accept: 'application/soap+xml, text/xml' },
  });
  const text = typeof res.text === 'string' ? res.text : String(res.data ?? '');
  const fault = text.match(/<(?:\w+:)?Fault[\s>][\s\S]*?<(?:\w+:)?Text[^>]*>([\s\S]*?)<\/(?:\w+:)?Text>/);
  if (fault) throw new IntegrationError(`SEFAZ: ${fault[1].trim()}`, res.status);
  if (!res.ok) throw new IntegrationError(`SEFAZ: HTTP ${res.status}`, res.status, text.slice(0, 500));
  const body = text.match(/<(?:\w+:)?Body[^>]*>([\s\S]*)<\/(?:\w+:)?Body>/)?.[1];
  if (!body) throw new IntegrationError('SEFAZ: resposta sem corpo SOAP', res.status, text.slice(0, 500));
  return body;
}
