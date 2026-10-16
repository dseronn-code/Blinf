/**
 * Correios (API do contrato — CWS): preço e prazo com o contrato do cliente,
 * pré-postagem (gera o código de objeto), rótulo em PDF e rastreio (SRO).
 * Autenticação: usuário do Meu Correios + código de acesso à API (Basic) →
 * token por cartão de postagem. Docs: https://cws.correios.com.br
 */
import { registerProvider } from '../registry';
import { httpRequest, ensureOk, IntegrationError } from '../http';
import { updateAccount } from '../accounts';
import type { AccountCtx } from '../types';
import type { QuotePackage, RealFreightOption, ShipPurchase, PurchaseResult, ShipParty } from './melhorenvio';

const P = 'CORREIOS';
export const correiosBase = (acc: Pick<AccountCtx, 'environment'>) => (acc.environment === 'PRODUCAO' ? 'https://api.correios.com.br' : 'https://apihom.correios.com.br');
const SERVICES: Record<string, string> = { '03298': 'PAC', '03220': 'SEDEX', '03140': 'SEDEX 12', '03158': 'SEDEX 10', '04227': 'Mini Envios' };
const services = (acc: AccountCtx) => String(acc.settings.services || '03298,03220').split(',').map((s) => s.trim()).filter(Boolean);
const digits = (s?: string | null) => (s || '').replace(/\D/g, '');

/** Token do cartão de postagem (válido ~24 h); fica guardado na conta até expirar */
export async function correiosToken(acc: AccountCtx) {
  if (acc.secrets.accessToken && acc.tokenExpiresAt && acc.tokenExpiresAt.getTime() > Date.now() + 60_000) return acc.secrets.accessToken;
  if (!acc.settings.usuario || !acc.secrets.codigoAcesso) throw new IntegrationError('Correios: informe o usuário do Meu Correios e o código de acesso à API');
  const res = await httpRequest({
    provider: P, companyId: acc.companyId, url: `${correiosBase(acc)}/token/v1/autentica/cartaopostagem`, redactRequest: true,
    headers: { Authorization: `Basic ${Buffer.from(`${acc.settings.usuario}:${acc.secrets.codigoAcesso}`).toString('base64')}` },
    body: { numero: digits(acc.settings.cartao), ...(acc.settings.contrato ? { contrato: digits(acc.settings.contrato) } : {}), ...(acc.settings.dr ? { dr: Number(acc.settings.dr) } : {}) },
  });
  const d = ensureOk(res, 'Correios').data;
  const exp = d.expiraEm ? new Date(d.expiraEm) : new Date(Date.now() + 23 * 3600_000);
  if (acc.id) await updateAccount(acc, { secrets: { accessToken: d.token }, tokenExpiresAt: exp }).catch(() => {});
  acc.secrets.accessToken = d.token;
  acc.tokenExpiresAt = exp;
  return d.token as string;
}

async function cws<T = any>(acc: AccountCtx, path: string, body?: unknown, method?: 'GET' | 'POST') {
  const res = await httpRequest<T>({ provider: P, companyId: acc.companyId, url: `${correiosBase(acc)}${path}`, method, body, headers: { Authorization: `Bearer ${await correiosToken(acc)}` } });
  return ensureOk(res, 'Correios').data;
}

/** "25,80" → 25.8 */
const brNum = (v: unknown) => Number(String(v ?? '0').replace(/\./g, '').replace(',', '.')) || 0;

// ---------------------------------------------------------------------------
// Preço e prazo
// ---------------------------------------------------------------------------
export async function correiosQuote(acc: AccountCtx, p: QuotePackage): Promise<RealFreightOption[]> {
  const from = digits(p.fromZip), to = digits(p.toZip);
  const grams = String(Math.max(100, Math.round((p.weight || 0.3) * 1000)));
  const out: RealFreightOption[] = [];
  for (const co of services(acc)) {
    const q = new URLSearchParams({
      cepOrigem: from, cepDestino: to, psObjeto: grams, tpObjeto: '2', comprimento: String(Math.max(16, Math.round(p.length || 20))), largura: String(Math.max(11, Math.round(p.width || 15))), altura: String(Math.max(2, Math.round(p.height || 10))),
      ...(acc.settings.contrato ? { nuContrato: digits(acc.settings.contrato) } : {}), ...(acc.settings.dr ? { nuDR: String(acc.settings.dr) } : {}),
      ...(p.value ? { servicosAdicionais: '019', vlDeclarado: (p.value || 0).toFixed(2) } : {}),
    });
    try {
      const [preco, prazo] = await Promise.all([cws(acc, `/preco/v1/nacional/${co}?${q}`), cws(acc, `/prazo/v1/nacional/${co}?cepOrigem=${from}&cepDestino=${to}`)]);
      out.push(mapCorreiosQuote(co, preco, prazo));
    } catch (e) {
      if (services(acc).length === 1) throw e; // serviço indisponível para o trecho: segue com os demais
    }
  }
  return out;
}

export function mapCorreiosQuote(co: string, preco: any, prazo: any): RealFreightOption {
  return { provider: P, carrier: 'Correios', service: SERVICES[co] || preco?.noProduto || co, serviceId: co, simulated: false, price: Math.round(brNum(preco?.pcFinal ?? preco?.pcBase) * 100) / 100, deadlineDays: Number(prazo?.prazoEntrega || 0) };
}

// ---------------------------------------------------------------------------
// Pré-postagem e rótulo
// ---------------------------------------------------------------------------
function party(p: ShipParty) {
  const phone = digits(p.phone);
  return {
    nome: p.name.slice(0, 50), cpfCnpj: digits(p.document) || undefined, email: p.email || undefined,
    ...(phone.length >= 10 ? (phone.length === 11 ? { dddCelular: phone.slice(0, 2), celular: phone.slice(2) } : { dddTelefone: phone.slice(0, 2), telefone: phone.slice(2) }) : {}),
    endereco: { cep: digits(p.zip), logradouro: p.street, numero: p.number || 'S/N', complemento: p.complement || undefined, bairro: p.district, cidade: p.city, uf: p.uf },
  };
}

/** Corpo do POST /prepostagem/v1/prepostagens */
export function correiosPrePostBody(acc: Pick<AccountCtx, 'settings'>, p: ShipPurchase) {
  return {
    idCorreios: acc.settings.usuario,
    numeroCartaoPostagem: digits(acc.settings.cartao),
    remetente: party(p.from),
    destinatario: party(p.to),
    codigoServico: p.serviceId,
    ...(p.invoiceKey ? { chaveNFe: p.invoiceKey, numeroNotaFiscal: String(p.invoiceNumber || '') } : {}),
    // Sem NF-e é obrigatória a declaração de conteúdo — Conferir na documentação: itensDeclaracaoConteudo
    ...(!p.invoiceKey ? { itensDeclaracaoConteudo: p.products.map((i) => ({ conteudo: i.name.slice(0, 60), quantidade: String(i.quantity), valor: i.unitValue.toFixed(2) })) } : {}),
    pesoInformado: String(Math.max(100, Math.round(p.volume.weight * 1000))),
    codigoFormatoObjetoInformado: '2', // caixa/pacote
    alturaInformada: String(Math.max(2, Math.round(p.volume.height))), larguraInformada: String(Math.max(11, Math.round(p.volume.width))), comprimentoInformado: String(Math.max(16, Math.round(p.volume.length))),
    cienteObjetoNaoProibido: 1,
    ...(p.value > 0 ? { listaServicoAdicional: [{ codigoServicoAdicional: '019', valorDeclarado: p.value.toFixed(2) }] } : {}),
    observacao: p.orderNumber ? `Pedido ${p.orderNumber}` : undefined,
  };
}

export async function correiosBuyLabel(acc: AccountCtx, p: ShipPurchase): Promise<PurchaseResult> {
  const pre = await cws(acc, '/prepostagem/v1/prepostagens', correiosPrePostBody(acc, p));
  const code = pre.codigoObjeto as string;
  // Rótulo assíncrono: pede a geração e guarda o recibo; o PDF é baixado na impressão
  let labelUrl: string | null = null;
  try {
    const r = await cws(acc, '/prepostagem/v1/prepostagens/rotulo/assincrono/pdf', { codigosObjeto: [code], idCorreios: acc.settings.usuario, numeroCartaoPostagem: digits(acc.settings.cartao), tipoRotulo: 'P', formatoRotulo: 'ET', layoutImpressao: 'PADRAO' });
    if (r.idRecibo) labelUrl = `correios:rotulo:${r.idRecibo}`;
  } catch {}
  return { providerRef: String(pre.id || code), trackingCode: code, labelUrl, status: 'PREPOSTADO' };
}

/** Cancela a pré-postagem (antes da postagem) — Conferir na documentação: DELETE /prepostagem/v1/prepostagens/{id} */
export async function correiosCancel(acc: AccountCtx, id: string) {
  const res = await httpRequest({ provider: P, companyId: acc.companyId, url: `${correiosBase(acc)}/prepostagem/v1/prepostagens/${encodeURIComponent(id)}`, method: 'DELETE', headers: { Authorization: `Bearer ${await correiosToken(acc)}` } });
  return ensureOk(res, 'Correios').data;
}

/** PDF do rótulo (base64 em `dados`) a partir do recibo guardado em labelUrl */
export async function correiosLabelPdf(acc: AccountCtx, labelUrl: string) {
  const recibo = labelUrl.replace('correios:rotulo:', '');
  const r = await cws(acc, `/prepostagem/v1/prepostagens/rotulo/download/assincrono/${recibo}`);
  if (!r?.dados) throw new IntegrationError('Correios: rótulo ainda em processamento — tente novamente em instantes');
  return Buffer.from(r.dados, 'base64');
}

// ---------------------------------------------------------------------------
// Rastreio (SRO)
// ---------------------------------------------------------------------------
export type TrackEvent = { date: string; status: string; description: string; location: string };

/** Código/tipo do evento SRO → status do envio */
function sroStatus(codigo: string, tipo: string) {
  if (['BDE', 'BDI', 'BDR'].includes(codigo) && ['01', '23', '24'].includes(tipo)) return 'ENTREGUE';
  if (codigo === 'OEC' || (codigo === 'LDI' && tipo === '01')) return 'SAIU_PARA_ENTREGA';
  if (codigo === 'PO' || codigo === 'PMT') return 'POSTADO';
  if (['DO', 'RO', 'FC', 'PAR', 'TRI'].includes(codigo) || ['BDE', 'BDI', 'BDR', 'LDI'].includes(codigo)) return 'EM_TRANSITO';
  return 'EM_TRANSITO';
}

/** Resposta do /srorastro → eventos em ordem cronológica e status atual */
export function mapCorreiosTracking(d: any): { status: string | null; events: TrackEvent[] } {
  const obj = d?.objetos?.[0];
  if (!obj || obj.mensagem) return { status: null, events: [] };
  const events: TrackEvent[] = (obj.eventos || [])
    .map((e: any) => {
      const end = e.unidade?.endereco || {};
      const dest = e.unidadeDestino?.endereco;
      return {
        date: new Date(e.dtHrCriado).toISOString(), status: sroStatus(e.codigo, e.tipo),
        description: `${e.descricao}${dest?.cidade ? ` — para ${dest.cidade}/${dest.uf}` : ''}`,
        location: [e.unidade?.tipo, end.cidade && `${end.cidade}/${end.uf}`].filter(Boolean).join(' - '),
      };
    })
    .sort((a: TrackEvent, b: TrackEvent) => a.date.localeCompare(b.date));
  return { status: events.length ? events[events.length - 1].status : null, events };
}

export async function correiosTracking(acc: AccountCtx, code: string) {
  return mapCorreiosTracking(await cws(acc, `/srorastro/v1/objetos/${encodeURIComponent(code)}?resultado=T`));
}

registerProvider({
  key: P,
  name: 'Correios (contrato)',
  category: 'LOGISTICA',
  color: '#ffd400',
  description: 'PAC e SEDEX com os preços do seu contrato, pré-postagem com código de objeto, rótulo oficial e rastreio pelo SRO.',
  docsUrl: 'https://cws.correios.com.br',
  auth: 'API_KEY',
  sandbox: true,
  fields: [
    { key: 'usuario', label: 'Usuário do Meu Correios', required: true, help: 'Login (CPF/CNPJ) usado no portal Meu Correios / CWS.' },
    { key: 'codigoAcesso', label: 'Código de acesso à API', secret: true, required: true, help: 'Gerado em cws.correios.com.br → Gestão de acesso a APIs.' },
    { key: 'cartao', label: 'Cartão de postagem', required: true },
    { key: 'contrato', label: 'Número do contrato' },
    { key: 'dr', label: 'DR (Diretoria Regional)', type: 'number', placeholder: '72' },
    { key: 'autoBuy', label: 'Gerar pré-postagem automaticamente ao faturar', type: 'switch', help: 'Desligado: o envio fica "aguardando etiqueta" e a pré-postagem é feita em Logística → Envios.' },
    { key: 'services', label: 'Serviços do contrato', placeholder: '03298,03220', help: 'Códigos separados por vírgula: 03298 PAC contrato, 03220 SEDEX contrato, 03140 SEDEX 12, 03158 SEDEX 10.' },
  ],
  capabilities: ['Preço e prazo com o seu contrato (PAC/SEDEX)', 'Pré-postagem com geração do código de objeto', 'Rótulo oficial em PDF', 'Rastreio automático pelo SRO a cada 30 minutos'],
  test: async (acc) => {
    acc.tokenExpiresAt = null; // força nova autenticação
    await correiosToken(acc);
    return { accountName: `Cartão ${acc.settings.cartao}`, externalAccountId: digits(acc.settings.cartao), message: 'Autenticado no cartão de postagem' };
  },
  poll: {
    everyMinutes: 30,
    run: async (acc) => {
      const { syncProviderTracking } = await import('@/server/services/logistics');
      return syncProviderTracking(acc.companyId, P);
    },
  },
});
