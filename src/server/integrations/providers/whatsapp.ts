/**
 * WhatsApp Cloud API (Meta): mensagens de modelo (templates aprovados) para
 * rastreio, cobrança e OS concluída; texto livre só dentro da janela de 24 h
 * após a última mensagem do cliente. Webhook de status (sent/delivered/read/failed)
 * com verificação hub.challenge e assinatura X-Hub-Signature-256.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { registerProvider } from '../registry';
import { httpRequest, ensureOk, IntegrationError } from '../http';
import { findAccountByExternalId, updateAccount, webhookToken } from '../accounts';
import type { AccountCtx } from '../types';

const P = 'WHATSAPP';
const GRAPH = 'https://graph.facebook.com/v20.0';

/** Eventos com modelo configurável → campo da conta com o nome do template */
export const WA_TEMPLATE_FIELDS = { rastreio: 'templateRastreio', cobranca: 'templateCobranca', os: 'templateOs' } as const;
export type WaEvent = keyof typeof WA_TEMPLATE_FIELDS;

/** Telefone brasileiro em E.164 sem "+" (55 + DDD + número); null quando inválido */
export function toE164(phone: string | null | undefined) {
  let d = (phone || '').replace(/\D/g, '').replace(/^0+/, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return null;
}

export function waTemplatePayload(to: string, name: string, language: string, params: string[]) {
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template',
    template: { name, language: { code: language || 'pt_BR' }, ...(params.length ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text ?? '').replace(/\s*\n\s*/g, ' ').slice(0, 1024) || '-' })) }] } : {}) },
  };
}

export function waTextPayload(to: string, body: string) {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: true, body: body.slice(0, 4096) } };
}

/** X-Hub-Signature-256: "sha256=" + HMAC-SHA256(corpo bruto, app secret) em hexadecimal */
export function verifyHubSignature(appSecret: string, raw: string, header: string | null | undefined) {
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(raw, 'utf8').digest('hex')}`;
  return header.length === expected.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/** GET de verificação do webhook: devolve o hub.challenge quando o verify token confere */
export function verifyChallenge(query: URLSearchParams, acc: Pick<AccountCtx, 'id' | 'settings'>) {
  const tok = query.get('hub.verify_token');
  const ok = query.get('hub.mode') === 'subscribe' && !!tok && (tok === acc.settings.verifyToken || tok === webhookToken(acc.id));
  return ok ? query.get('hub.challenge') : null;
}

const STATUS: Record<string, string> = { sent: 'ENVIADO', delivered: 'ENTREGUE', read: 'LIDO', failed: 'ERRO' };
const RANK = ['PENDENTE', 'ENVIADO', 'ENTREGUE', 'LIDO'];

/** Envia o payload e devolve o wamid */
export async function waSend(acc: AccountCtx, payload: object) {
  if (!acc.secrets.token || !acc.settings.phoneNumberId) throw new IntegrationError('WhatsApp: informe o token e o Phone Number ID');
  const res = await httpRequest({ provider: P, companyId: acc.companyId, url: `${GRAPH}/${acc.settings.phoneNumberId}/messages`, headers: { Authorization: `Bearer ${acc.secrets.token}` }, body: payload });
  const d = ensureOk(res, 'WhatsApp').data;
  return String(d?.messages?.[0]?.id || '');
}

/** Cliente escreveu nas últimas 24 h? (janela de atendimento — permite texto livre) */
export function insideWindow(acc: Pick<AccountCtx, 'settings'>, to: string) {
  const ts = Number((acc.settings.lastInbound || {})[to] || 0);
  return Date.now() - ts < 24 * 3600_000;
}

/**
 * Monta o envio: modelo aprovado do evento (parâmetros do corpo na ordem
 * documentada nos campos) ou texto livre dentro da janela de 24 h.
 */
export function buildWaMessage(acc: Pick<AccountCtx, 'settings'>, to: string, body: string, wa?: { event?: WaEvent; params?: string[] } | null) {
  const tpl = wa?.event ? acc.settings[WA_TEMPLATE_FIELDS[wa.event]] : null;
  if (tpl) return waTemplatePayload(to, String(tpl), String(acc.settings.language || 'pt_BR'), wa?.params || []);
  if (insideWindow(acc, to)) return waTextPayload(to, body);
  throw new IntegrationError(`WhatsApp: fora da janela de 24 h e sem modelo aprovado configurado${wa?.event ? ` para "${wa.event}"` : ''} (Integrações → Contas → WhatsApp)`);
}

async function processWebhook(body: any, acc: AccountCtx) {
  let statuses = 0, inbound = 0;
  const lastInbound: Record<string, number> = { ...(acc.settings.lastInbound || {}) };
  for (const entry of body?.entry || []) for (const ch of entry.changes || []) {
    const v = ch.value || {};
    for (const st of v.statuses || []) {
      const status = STATUS[st.status];
      if (!status) continue;
      const m = await prisma.outboxMessage.findFirst({ where: { companyId: acc.companyId, channel: 'WHATSAPP', providerRef: st.id } });
      if (!m) continue;
      // Notificações podem chegar fora de ordem: nunca regride (lido → entregue)
      if (status !== 'ERRO' && RANK.indexOf(status) <= RANK.indexOf(m.status)) continue;
      const err = st.errors?.[0];
      await prisma.outboxMessage.update({ where: { id: m.id }, data: { status, ...(status === 'ERRO' ? { error: err ? `${err.code} ${err.title}${err.error_data?.details ? ` — ${err.error_data.details}` : ''}` : 'Falha na entrega' } : {}) } });
      statuses++;
    }
    for (const msg of v.messages || []) {
      lastInbound[msg.from] = Number(msg.timestamp) * 1000 || Date.now();
      inbound++;
    }
  }
  if (inbound) {
    // Mantém só as conversas recentes (janela de 24 h)
    const fresh = Object.fromEntries(Object.entries(lastInbound).filter(([, t]) => Date.now() - t < 24 * 3600_000));
    await updateAccount(acc, { settings: { lastInbound: fresh } });
  }
  return `${statuses} status atualizado(s), ${inbound} mensagem(ns) recebida(s)`;
}

registerProvider({
  key: P,
  name: 'WhatsApp Business (Cloud API)',
  category: 'MENSAGENS',
  color: '#25d366',
  description: 'Avisos de rastreio, cobrança e OS concluída pelo WhatsApp oficial da empresa, com modelos aprovados pela Meta e confirmação de entrega/leitura.',
  docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
  auth: 'API_KEY',
  fields: [
    { key: 'token', label: 'Token de acesso permanente', secret: true, required: true, type: 'textarea', help: 'Meta Business → Usuários do sistema → Gerar token (permissões whatsapp_business_messaging e whatsapp_business_management).' },
    { key: 'phoneNumberId', label: 'Phone Number ID', required: true, help: 'WhatsApp → Configuração da API (não é o número de telefone).' },
    { key: 'wabaId', label: 'WABA ID (conta do WhatsApp Business)' },
    { key: 'appSecret', label: 'Chave secreta do app (App Secret)', secret: true, help: 'Usada para validar a assinatura X-Hub-Signature-256 das notificações.' },
    { key: 'verifyToken', label: 'Token de verificação do webhook', help: 'Informe o mesmo valor no painel da Meta ao cadastrar a URL de callback (vazio = o token da URL do webhook).' },
    { key: 'language', label: 'Idioma dos modelos', placeholder: 'pt_BR' },
    { key: 'templateRastreio', label: 'Modelo: código de rastreio', placeholder: 'rastreio_pedido', help: 'Parâmetros do corpo: {{1}} cliente, {{2}} pedido, {{3}} transportadora, {{4}} código de rastreio.' },
    { key: 'templateCobranca', label: 'Modelo: cobrança', placeholder: 'cobranca_aberto', help: 'Parâmetros: {{1}} cliente, {{2}} título, {{3}} valor, {{4}} vencimento, {{5}} link/linha digitável.' },
    { key: 'templateOs', label: 'Modelo: OS concluída', placeholder: 'os_concluida', help: 'Parâmetros: {{1}} cliente, {{2}} nº da OS, {{3}} equipamento, {{4}} valor.' },
  ],
  capabilities: ['Mensagens com modelos aprovados (rastreio, cobrança, OS concluída)', 'Texto livre dentro da janela de 24 h de atendimento', 'Status de envio, entrega e leitura na caixa de saída'],
  test: async (acc) => {
    const res = await httpRequest({ provider: P, companyId: acc.companyId, url: `${GRAPH}/${acc.settings.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, headers: { Authorization: `Bearer ${acc.secrets.token}` } });
    const d = ensureOk(res, 'WhatsApp').data;
    return { accountName: `${d.verified_name || 'WhatsApp'} (${d.display_phone_number || acc.settings.phoneNumberId})`, externalAccountId: String(acc.settings.phoneNumberId), message: d.quality_rating ? `Qualidade: ${d.quality_rating}` : undefined };
  },
  webhook: {
    // /api/hooks/whatsapp (URL única do app): a conta é localizada pelo phone_number_id da notificação
    findAccount: (b) => {
      const id = b?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
      return id ? findAccountByExternalId(P, String(id)) : Promise.resolve(null);
    },
    verify: (acc, req) => {
      if (!acc) return false;
      if (acc.secrets.appSecret) return verifyHubSignature(acc.secrets.appSecret, req.raw, req.headers.get('x-hub-signature-256'));
      return req.query.get('token') === webhookToken(acc.id); // sem app secret: só pela URL com token
    },
    describe: (b) => {
      const v = b?.entry?.[0]?.changes?.[0]?.value || {};
      return { topic: v.statuses ? `status.${v.statuses[0]?.status}` : v.messages ? 'message' : b?.object, externalId: v.statuses?.[0]?.id || v.messages?.[0]?.id };
    },
    process: (ev, acc) => processWebhook(ev.payload, acc),
  },
});
