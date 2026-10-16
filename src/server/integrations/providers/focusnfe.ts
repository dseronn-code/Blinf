/**
 * Focus NFe — API fiscal (alternativa à comunicação direta com a SEFAZ).
 * Autenticação: token da empresa em Basic Auth ("token:" sem senha).
 * Homologação: https://homologacao.focusnfe.com.br | Produção: https://api.focusnfe.com.br
 * NF-e (/v2/nfe, assíncrona), NFC-e (/v2/nfce, síncrona), NFS-e municipal
 * (/v2/nfse) e Padrão Nacional (/v2/nfsen), MDF-e (/v2/mdfe), CC-e,
 * cancelamento, inutilização, NF-e recebidas/manifestação e gatilhos (webhooks).
 * O certificado A1 e a numeração ficam cadastrados no painel da Focus.
 */
import type { Company, Contact, Invoice, InvoiceItem, Mdfe } from '@prisma/client';
import { registerProvider } from '../registry';
import { httpRequest, IntegrationError, type HttpResponse } from '../http';
import { updateAccount, webhookUrl } from '../accounts';
import type { AccountCtx } from '../types';
import { onlyDigits } from '@/lib/utils';

export const focusBase = (acc: Pick<AccountCtx, 'environment'>) => (acc.environment === 'PRODUCAO' ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br');

export async function focusRequest<T = any>(acc: AccountCtx, method: 'GET' | 'POST' | 'DELETE' | 'PUT', path: string, body?: unknown): Promise<HttpResponse<T>> {
  const token = acc.secrets.token;
  if (!token) throw new IntegrationError('Focus NFe: informe o token da API em Integrações → Contas e credenciais');
  return httpRequest<T>({ provider: 'FOCUS_NFE', companyId: acc.companyId, url: `${focusBase(acc)}${path}`, method, body, headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}` } });
}

/** Mensagem de erro da Focus ({ codigo, mensagem, erros: [{ mensagem, campo }] }) */
export function focusError(d: any, status?: number) {
  if (!d || typeof d !== 'object') return typeof d === 'string' && d ? d.slice(0, 300) : `HTTP ${status}`;
  const errs = Array.isArray(d.erros) ? d.erros.map((e: any) => `${e.campo ? `${e.campo}: ` : ''}${e.mensagem || e.message}`).join('; ') : '';
  return [d.mensagem_sefaz ? `${d.status_sefaz || ''} ${d.mensagem_sefaz}`.trim() : d.mensagem, errs].filter(Boolean).join(' — ') || `HTTP ${status}`;
}

export type FocusResult = {
  status: 'AUTORIZADA' | 'PROCESSANDO' | 'REJEITADA' | 'DENEGADA' | 'CANCELADA';
  cStat: string; xMotivo: string; accessKey?: string | null; protocol?: string | null; number?: number | null; series?: number | null;
  xmlPath?: string | null; danfePath?: string | null; verificationCode?: string | null; url?: string | null; raw: any;
};

/** Converte a resposta de consulta/emissão da Focus no nosso status */
export function parseFocus(d: any, httpStatus = 200): FocusResult {
  const s = String(d?.status || '');
  const base = {
    cStat: String(d?.status_sefaz || d?.codigo || ''), xMotivo: String(d?.mensagem_sefaz || d?.mensagem || focusError(d, httpStatus)),
    accessKey: d?.chave_nfe || d?.chave_nfce || d?.chave || d?.chave_mdfe || d?.codigo_verificacao_nfsen || null,
    protocol: d?.protocolo || d?.protocolo_nota_fiscal?.numero_protocolo || d?.numero_protocolo || null,
    number: d?.numero ? Number(d.numero) : null, series: d?.serie ? Number(d.serie) : null,
    xmlPath: d?.caminho_xml_nota_fiscal || d?.caminho_xml || null, danfePath: d?.caminho_danfe || d?.caminho_damdfe || null,
    verificationCode: d?.codigo_verificacao || null, url: d?.url || d?.url_danfse || null, raw: d,
  };
  if (s === 'autorizado') return { status: 'AUTORIZADA', ...base, cStat: base.cStat || '100' };
  if (s === 'cancelado') return { status: 'CANCELADA', ...base };
  if (s === 'denegado') return { status: 'DENEGADA', ...base };
  if (s.startsWith('processando') || s === 'em_processamento') return { status: 'PROCESSANDO', ...base };
  return { status: 'REJEITADA', ...base, xMotivo: focusError(d, httpStatus) };
}

// ---------------------------------------------------------------------------
// Mapeamento Invoice/InvoiceItem → JSON da Focus
// ---------------------------------------------------------------------------
const PAG: Record<string, string> = { DINHEIRO: '01', CHEQUE: '02', CARTAO_CREDITO: '03', CARTAO_DEBITO: '04', BOLETO: '15', TRANSFERENCIA: '18', PIX: '17' };
export const focusPayment = (method?: string | null) => PAG[method || ''] || '99';

type Inv = Invoice & { items: InvoiceItem[] };
type ProdInfo = Record<string, { origin?: number; gtin?: string | null; cest?: string | null }>;

export function focusNfePayload(inv: Inv, company: Company, customer: Contact | null, opts: { products?: ProdInfo; paymentMethod?: string | null; issueDate?: Date } = {}) {
  const doc = onlyDigits(customer?.document || inv.customerDoc);
  const nfce = inv.model === 'NFCE';
  const normal = company.crt !== 1;
  const intra = !inv.customerUf || inv.customerUf === company.uf;
  const payload: Record<string, unknown> = {
    natureza_operacao: inv.natureName,
    data_emissao: (opts.issueDate || new Date()).toISOString(),
    tipo_documento: inv.direction === 'ENTRADA' ? 0 : 1,
    local_destino: nfce || intra ? 1 : 2,
    finalidade_emissao: inv.finalidade || 1,
    consumidor_final: customer?.ieIndicator === 1 ? 0 : 1,
    presenca_comprador: nfce ? 1 : 9,
    numero: inv.number, serie: inv.series,
    cnpj_emitente: onlyDigits(company.cnpj),
    inscricao_estadual_emitente: onlyDigits(company.ie),
    modalidade_frete: inv.freight && !nfce ? 0 : 9,
    valor_frete: inv.freight || 0, valor_desconto: inv.discount || 0,
    valor_produtos: inv.productsTotal, valor_total: inv.total,
    informacoes_adicionais_contribuinte: inv.additionalInfo || undefined,
    formas_pagamento: [{ forma_pagamento: inv.finalidade === 4 ? '90' : focusPayment(opts.paymentMethod), valor_pagamento: inv.finalidade === 4 ? 0 : inv.total }],
    notas_referenciadas: inv.refAccessKey ? [{ chave_nfe: inv.refAccessKey }] : undefined,
    items: inv.items.map((i, idx) => {
      const p = (i.productId && opts.products?.[i.productId]) || {};
      return {
        numero_item: idx + 1, codigo_produto: i.code, descricao: i.description, cfop: i.cfop, codigo_ncm: onlyDigits(i.ncm), cest: p.cest || undefined,
        codigo_barras_comercial: p.gtin || 'SEM GTIN', codigo_barras_tributavel: p.gtin || 'SEM GTIN',
        unidade_comercial: i.unit, quantidade_comercial: i.quantity, valor_unitario_comercial: i.unitPrice,
        unidade_tributavel: i.unit, quantidade_tributavel: i.quantity, valor_unitario_tributavel: i.unitPrice, valor_bruto: i.total,
        icms_origem: p.origin ?? 0, icms_situacao_tributaria: i.cst,
        ...(normal ? { icms_modalidade_base_calculo: 3, icms_base_calculo: i.icmsBase, icms_aliquota: i.icmsRate, icms_valor: i.icmsValue } : {}),
        ...(i.icmsStValue ? { icms_modalidade_base_calculo_st: 4, icms_base_calculo_st: i.icmsStBase, icms_valor_st: i.icmsStValue } : {}),
        ...(i.ipiValue && !nfce ? { ipi_situacao_tributaria: '50', ipi_codigo_enquadramento_legal: '999', ipi_base_calculo: i.total, ipi_aliquota: i.ipiRate, ipi_valor: i.ipiValue } : {}),
        ...(i.difalValue ? { icms_base_calculo_uf_destino: i.icmsBase, icms_aliquota_interestadual: i.icmsRate, icms_percentual_partilha: 100, icms_valor_uf_destino: i.difalValue, fcp_valor_uf_destino: i.fcpValue } : {}),
        pis_situacao_tributaria: normal ? '01' : '49', ...(normal ? { pis_base_calculo: i.total, pis_aliquota_porcentual: i.pisRate, pis_valor: i.pisValue } : {}),
        cofins_situacao_tributaria: normal ? '01' : '49', ...(normal ? { cofins_base_calculo: i.total, cofins_aliquota_porcentual: i.cofinsRate, cofins_valor: i.cofinsValue } : {}),
      };
    }),
  };
  if (customer || doc) {
    Object.assign(payload, {
      nome_destinatario: customer?.name || inv.customerName,
      ...(doc.length === 14 ? { cnpj_destinatario: doc } : doc ? { cpf_destinatario: doc } : {}),
      indicador_inscricao_estadual_destinatario: nfce ? 9 : customer?.ieIndicator ?? 9,
      inscricao_estadual_destinatario: customer?.ieIndicator === 1 ? onlyDigits(customer.ie) : undefined,
      ...(customer?.street ? { logradouro_destinatario: customer.street, numero_destinatario: customer.number || 'S/N', bairro_destinatario: customer.district || 'Centro', municipio_destinatario: customer.city, uf_destinatario: customer.uf, cep_destinatario: onlyDigits(customer.zip) } : {}),
      email_destinatario: customer?.email || undefined,
    });
  }
  return payload;
}

/** NFS-e (padrão municipal ABRASF) ou Padrão Nacional (/v2/nfsen) */
export function focusNfsePayload(inv: Inv, company: Company, customer: Contact | null, opts: { nacional?: boolean; serviceCode?: string | null; cityCode?: string | null; customerCityCode?: string | null } = {}) {
  const doc = onlyDigits(customer?.document || inv.customerDoc);
  const item = (opts.serviceCode || '01.01').replace(/\D/g, '').padStart(4, '0');
  const description = inv.items.map((i) => `${i.description} (${i.quantity} x ${i.unitPrice.toFixed(2)})`).join('; ');
  const rate = inv.items[0]?.issRate || 0;
  if (opts.nacional) {
    // Conferir na documentação: campos da NFS-e Nacional (/v2/nfsen) na Focus
    return {
      data_emissao: new Date().toISOString(), data_competencia: new Date().toISOString().slice(0, 10), codigo_municipio_emissora: opts.cityCode || company.cityCode,
      cnpj_prestador: onlyDigits(company.cnpj), inscricao_municipal_prestador: onlyDigits(company.im) || undefined,
      codigo_opcao_simples_nacional: company.crt === 1 ? 3 : 1, regime_especial_tributacao: 0,
      ...(doc.length === 14 ? { cnpj_tomador: doc } : doc ? { cpf_tomador: doc } : {}), razao_social_tomador: inv.customerName,
      codigo_municipio_tomador: opts.customerCityCode || undefined, cep_tomador: onlyDigits(customer?.zip) || undefined, logradouro_tomador: customer?.street || undefined,
      numero_tomador: customer?.number || undefined, bairro_tomador: customer?.district || undefined, email_tomador: customer?.email || undefined,
      codigo_municipio_prestacao: opts.cityCode || company.cityCode, codigo_tributacao_nacional_iss: `${item}01`, descricao_servico: description,
      valor_servico: inv.servicesTotal, tributacao_iss: 1, tipo_retencao_iss: 1, ...(company.crt === 1 ? {} : { aliquota_iss: rate }),
    };
  }
  return {
    data_emissao: new Date().toISOString(),
    prestador: { cnpj: onlyDigits(company.cnpj), inscricao_municipal: onlyDigits(company.im), codigo_municipio: company.cityCode },
    tomador: {
      ...(doc.length === 14 ? { cnpj: doc } : doc ? { cpf: doc } : {}), razao_social: inv.customerName, email: customer?.email || undefined,
      ...(customer?.street ? { endereco: { logradouro: customer.street, numero: customer.number || 'S/N', bairro: customer.district || 'Centro', codigo_municipio: opts.customerCityCode || undefined, uf: customer.uf, cep: onlyDigits(customer.zip) } } : {}),
    },
    servico: { aliquota: rate, discriminacao: description, iss_retido: false, item_lista_servico: item, valor_servicos: inv.servicesTotal, valor_iss: inv.issValue },
  };
}

/** MDF-e (/v2/mdfe). Conferir na documentação: nomes dos campos do MDF-e na Focus */
export function focusMdfePayload(m: Mdfe, company: Company) {
  return {
    tipo_emitente: 2, cnpj_emitente: onlyDigits(company.cnpj), serie: m.series, numero: m.number, modal: 1, data_emissao: new Date().toISOString(),
    uf_inicio: m.ufStart, uf_fim: m.ufEnd,
    municipios_carregamento: [{ codigo: m.loadCityCode, nome: m.loadCity }],
    percursos: m.route.map((uf) => ({ uf })),
    modal_rodoviario: {
      rntrc: m.rntrc || undefined,
      veiculo_tracao: { placa: m.vehiclePlate.replace(/\W/g, '').toUpperCase(), tara: m.vehicleTara, tipo_rodado: '02', tipo_carroceria: '02', uf: m.vehicleUf, condutores: [{ nome: m.driverName, cpf: onlyDigits(m.driverCpf) }] },
    },
    municipios_descarregamento: [{ codigo: m.unloadCityCode, nome: m.unloadCity, notas_fiscais: m.invoiceKeys.map((chave_nfe) => ({ chave_nfe })) }],
    quantidade_total_nfe: m.invoiceKeys.length, valor_total_carga: m.totalValue, codigo_unidade_medida_peso_bruto: '01', peso_bruto: m.totalWeight,
  };
}

const PATH: Record<string, string> = { NFE: 'nfe', NFCE: 'nfce', NFSE: 'nfse', NFSEN: 'nfsen', MDFE: 'mdfe' };
export const focusPath = (model: string) => PATH[model] || 'nfe';

/** Emite (POST /v2/{tipo}?ref=) e devolve o resultado (NFC-e é síncrona; NF-e/NFS-e/MDF-e assíncronas) */
export async function focusEmit(acc: AccountCtx, model: string, ref: string, payload: unknown) {
  const res = await focusRequest(acc, 'POST', `/v2/${focusPath(model)}?ref=${encodeURIComponent(ref)}`, payload);
  if (res.status >= 400 && res.data?.codigo !== 'already_processed') return parseFocus({ ...res.data, status: 'erro_autorizacao' }, res.status);
  return parseFocus(res.data, res.status);
}

export async function focusGet(acc: AccountCtx, model: string, ref: string) {
  const res = await focusRequest(acc, 'GET', `/v2/${focusPath(model)}/${encodeURIComponent(ref)}?completo=1`);
  if (res.status === 404) return parseFocus({ status: 'erro_autorizacao', mensagem: 'Documento não encontrado na Focus NFe' }, 404);
  return parseFocus(res.data, res.status);
}

/** Baixa um arquivo da Focus (caminho_xml_nota_fiscal etc.) */
export async function focusDownload(acc: AccountCtx, path: string) {
  const res = await focusRequest<string>(acc, 'GET', path.startsWith('http') ? path.replace(focusBase(acc), '') : path);
  return res.ok ? (typeof res.data === 'string' ? res.data : res.text) : null;
}

export async function focusCancel(acc: AccountCtx, model: string, ref: string, justificativa: string) {
  const res = await focusRequest(acc, 'DELETE', `/v2/${focusPath(model)}/${encodeURIComponent(ref)}`, { justificativa });
  const d = res.data || {};
  return { ok: d.status === 'cancelado', cStat: String(d.status_sefaz || ''), xMotivo: focusError(d, res.status), protocol: d.protocolo || d.numero_protocolo || null, xmlPath: d.caminho_xml_cancelamento || null };
}

export async function focusCce(acc: AccountCtx, ref: string, correcao: string) {
  const res = await focusRequest(acc, 'POST', `/v2/nfe/${encodeURIComponent(ref)}/carta_correcao`, { correcao });
  const d = res.data || {};
  return { ok: d.status === 'autorizado', cStat: String(d.status_sefaz || ''), xMotivo: focusError(d, res.status), protocol: d.protocolo || null, seq: d.numero_carta_correcao || null };
}

export async function focusInutilizar(acc: AccountCtx, model: 'NFE' | 'NFCE', p: { cnpj: string; serie: number; numero_inicial: number; numero_final: number; justificativa: string }) {
  const res = await focusRequest(acc, 'POST', `/v2/${focusPath(model)}/inutilizacao`, p);
  const d = res.data || {};
  return { ok: d.status === 'autorizado', cStat: String(d.status_sefaz || ''), xMotivo: focusError(d, res.status), protocol: d.protocolo_sefaz || d.protocolo || null };
}

export async function focusMdfeClose(acc: AccountCtx, ref: string, p: { data: string; uf: string; municipio: string; codigoMunicipio: string }) {
  const res = await focusRequest(acc, 'POST', `/v2/mdfe/${encodeURIComponent(ref)}/encerrar`, { data_encerramento: p.data, sigla_uf_encerramento: p.uf, nome_municipio_encerramento: p.municipio, codigo_municipio_encerramento: p.codigoMunicipio });
  const d = res.data || {};
  return { ok: ['encerrado', 'autorizado'].includes(d.status) || d.status_sefaz === '135', cStat: String(d.status_sefaz || ''), xMotivo: focusError(d, res.status), protocol: d.protocolo || null };
}

/** NF-e recebidas (Distribuição DF-e pela Focus) — paginação por versão */
export async function focusReceived(acc: AccountCtx, cnpj: string, versao: number) {
  const res = await focusRequest<any[]>(acc, 'GET', `/v2/nfes_recebidas?cnpj=${cnpj}&versao=${versao}`);
  if (!res.ok) throw new IntegrationError(`Focus NFe: ${focusError(res.data, res.status)}`);
  return { items: Array.isArray(res.data) ? res.data : [], maxVersion: Number(res.headers['x-max-version'] || versao) };
}

const MANIFEST: Record<string, string> = { CIENCIA: 'ciencia', CONFIRMADA: 'confirmacao', DESCONHECIDA: 'desconhecimento', NAO_REALIZADA: 'nao_realizada' };
export async function focusManifest(acc: AccountCtx, chave: string, status: string, justificativa?: string) {
  const res = await focusRequest(acc, 'POST', `/v2/nfes_recebidas/${chave}/manifesto`, { tipo: MANIFEST[status], justificativa });
  const d = res.data || {};
  return { ok: res.ok && (!d.status_sefaz || ['135', '136'].includes(String(d.status_sefaz))), cStat: String(d.status_sefaz || ''), xMotivo: focusError(d, res.status), protocol: d.protocolo || null };
}

const HOOK_EVENTS = ['nfe', 'nfse', 'mdfe'];

registerProvider({
  key: 'FOCUS_NFE',
  name: 'Focus NFe',
  category: 'FISCAL',
  description: 'Emissão de NF-e, NFC-e, NFS-e (municipal e Padrão Nacional) e MDF-e pela API da Focus NFe. Use quando preferir não transmitir direto à SEFAZ.',
  color: '#0f766e',
  docsUrl: 'https://focusnfe.com.br/doc/',
  auth: 'API_KEY',
  sandbox: true,
  fields: [
    { key: 'token', label: 'Token da API', secret: true, required: true, help: 'Painel Focus NFe → Minha conta → Tokens. Homologação e produção têm tokens diferentes.' },
    { key: 'nfseNacional', label: 'NFS-e pelo Padrão Nacional (/v2/nfsen)', type: 'switch', help: 'Desligado: NFS-e pelo padrão do município (/v2/nfse)' },
  ],
  capabilities: ['NF-e e NFC-e autorizadas pela SEFAZ via Focus', 'NFS-e municipal e Padrão Nacional', 'MDF-e com encerramento', 'Cancelamento, CC-e e inutilização', 'Retorno automático por gatilho (webhook)', 'NF-e recebidas e manifestação do destinatário'],
  async test(acc) {
    const res = await focusRequest(acc, 'GET', '/v2/hooks');
    if (res.status === 401 || res.status === 403) throw new IntegrationError('Focus NFe: token inválido para este ambiente');
    if (!res.ok) throw new IntegrationError(`Focus NFe: ${focusError(res.data, res.status)}`);
    // Cadastra os gatilhos (webhooks) de retorno, uma única vez por conta
    const hooks: any[] = Array.isArray(res.data) ? res.data : [];
    const url = webhookUrl('FOCUS_NFE', acc.id);
    const { prisma } = await import('@/lib/db');
    const company = await prisma.company.findUnique({ where: { id: acc.companyId }, select: { cnpj: true, name: true } });
    for (const event of HOOK_EVENTS) {
      if (hooks.some((h) => h.url === url && h.event === event)) continue;
      await focusRequest(acc, 'POST', '/v2/hooks', { cnpj: onlyDigits(company?.cnpj), event, url }).catch(() => null);
    }
    await updateAccount(acc, { settings: { hooksAt: new Date().toISOString() } });
    return { accountName: company?.name, message: `Conectado ao ambiente de ${acc.environment === 'PRODUCAO' ? 'produção' : 'homologação'}` };
  },
  // Consulta notas/manifestos ainda em processamento (caso o gatilho não chegue)
  poll: {
    everyMinutes: 5,
    async run(acc) {
      const { refreshPendingProvider } = await import('@/server/services/fiscal');
      const n = await refreshPendingProvider(acc.companyId);
      return n ? `${n} documento(s) atualizado(s)` : undefined;
    },
  },
  webhook: {
    describe: (b) => ({ topic: b?.status ? `${b?.cnpj_emitente || ''} ${b.status}`.trim() : undefined, externalId: b?.ref }),
    async process(ev, acc) {
      const body = ev.payload as any;
      if (!body?.ref) return 'Sem referência';
      const { applyProviderUpdate } = await import('@/server/services/fiscal');
      return applyProviderUpdate(acc.companyId, String(body.ref), body);
    },
  },
});
