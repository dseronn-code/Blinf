/**
 * Mensagens para clientes/fornecedores (e-mail e WhatsApp).
 * Toda mensagem passa pela caixa de saída (OutboxMessage) e é enviada pela fila.
 * - E-mail: SMTP da empresa (Integrações → Contas → SMTP) → senão SMTP_HOST do
 *   ambiente → senão fica registrado como SIMULADO. HTML (modelos) + texto, com
 *   anexos gerados na hora do envio (DANFE/XML da nota).
 * - WhatsApp: Cloud API da empresa (modelos aprovados / janela de 24 h) → senão SIMULADO.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { prisma } from '@/lib/db';
import { enqueue, registerJob } from './jobs';
import { render } from './emailTemplates';
import { getAccount } from '../integrations/accounts';
import { IntegrationError } from '../integrations/http';
import { smtpTransport, smtpFrom } from '../integrations/providers/smtp';
import { toE164, buildWaMessage, waSend, type WaEvent } from '../integrations/providers/whatsapp';
import { danfePdf, danfcePdf, nfsePdf } from '../pdf';

/** Anexo guardado no payload do job e gerado só no envio */
export type OutboxAttachment = { type: 'invoice'; id: string; xml?: boolean; pdf?: boolean };
export type WaOptions = { event?: WaEvent; params?: string[] };

export async function sendMessage(companyId: string, msg: { channel?: 'EMAIL' | 'WHATSAPP'; to: string | null | undefined; subject: string; body: string; html?: string | null; related?: string; attachments?: OutboxAttachment[]; wa?: WaOptions }) {
  if (!msg.to) return null;
  const row = await prisma.outboxMessage.create({ data: { companyId, channel: msg.channel || 'EMAIL', to: msg.to, subject: msg.subject, body: msg.body, html: msg.html || null, related: msg.related || null } });
  await enqueue('outbox.send', { id: row.id, ...(msg.attachments?.length ? { attachments: msg.attachments } : {}), ...(msg.wa ? { wa: msg.wa } : {}) });
  return row;
}

/** E-mail a partir de um modelo (personalizado da empresa ou padrão) */
export async function sendTemplate(companyId: string, key: string, vars: Record<string, unknown>, opts: { to: string | null | undefined; related?: string; attachments?: OutboxAttachment[] }) {
  if (!opts.to) return null;
  const r = await render(key, vars, companyId);
  return sendMessage(companyId, { to: opts.to, subject: r.subject, body: r.text, html: r.html, related: opts.related, attachments: opts.attachments });
}

let envTransport: Transporter | null = null;
/** SMTP da empresa → SMTP do ambiente → null (simulado) */
export async function emailTransport(companyId: string) {
  const acc = await getAccount(companyId, 'SMTP').catch(() => null);
  if (acc) return { transport: smtpTransport(acc), from: smtpFrom(acc), replyTo: (acc.settings.replyTo as string) || undefined };
  if (!process.env.SMTP_HOST) return null;
  envTransport ||= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return { transport: envTransport, from: process.env.SMTP_FROM || 'GestãoPro <nao-responda@gestaopro.local>', replyTo: undefined };
}

/** Há envio real de e-mail configurado para a empresa? */
export async function hasRealEmail(companyId: string) {
  return !!(await emailTransport(companyId));
}

/** WhatsApp Cloud API conectado para a empresa? */
export async function hasWhatsApp(companyId: string) {
  return !!(await getAccount(companyId, 'WHATSAPP').catch(() => null));
}

async function buildAttachments(list: OutboxAttachment[] | undefined) {
  const out: { filename: string; content: Buffer | string; contentType: string }[] = [];
  for (const a of list || []) {
    if (a.type !== 'invoice') continue;
    const inv = await prisma.invoice.findUnique({ where: { id: a.id }, include: { items: true } });
    if (!inv) continue;
    const name = inv.accessKey || `${inv.model}-${inv.number}`;
    if (a.pdf !== false) {
      const company = await prisma.company.findUnique({ where: { id: inv.companyId } });
      const customer = inv.customerId ? await prisma.contact.findUnique({ where: { id: inv.customerId } }) : null;
      const pdf = inv.model === 'NFCE' ? await danfcePdf(inv, company!) : inv.model === 'NFSE' ? await nfsePdf(inv, company!) : await danfePdf(inv, company!, customer);
      out.push({ filename: `${inv.model === 'NFSE' ? 'NFS-e' : 'DANFE'}-${inv.number}.pdf`, content: Buffer.from(pdf), contentType: 'application/pdf' });
    }
    const xml = inv.procXml || inv.xml;
    if (a.xml !== false && xml) out.push({ filename: `${name}.xml`, content: xml, contentType: 'application/xml' });
  }
  return out;
}

const DONE = ['ENVIADO', 'SIMULADO', 'ENTREGUE', 'LIDO'];

registerJob('outbox.send', async ({ id, attachments, wa }) => {
  const m = await prisma.outboxMessage.findUnique({ where: { id } });
  if (!m || DONE.includes(m.status)) return;
  const done = (data: { status: string; providerRef?: string | null; error?: string | null }) => prisma.outboxMessage.update({ where: { id }, data: { sentAt: data.status === 'ERRO' ? undefined : new Date(), error: null, ...data } });
  try {
    if (m.channel === 'WHATSAPP') {
      const acc = await getAccount(m.companyId, 'WHATSAPP').catch(() => null);
      if (!acc) return void (await done({ status: 'SIMULADO' }));
      const to = toE164(m.to);
      if (!to) return void (await done({ status: 'ERRO', error: `Telefone inválido para WhatsApp: ${m.to}` }));
      let payload: object;
      try {
        payload = buildWaMessage(acc, to, m.body, wa);
      } catch (e) {
        // Sem modelo e fora da janela de 24 h: não adianta tentar de novo
        return void (await done({ status: 'ERRO', error: (e as Error).message }));
      }
      const wamid = await waSend(acc, payload);
      await done({ status: 'ENVIADO', providerRef: wamid || null });
      return;
    }
    const t = await emailTransport(m.companyId);
    if (!t) return void (await done({ status: 'SIMULADO' }));
    const info = await t.transport.sendMail({ from: t.from, replyTo: t.replyTo, to: m.to, subject: m.subject, text: m.body, ...(m.html ? { html: m.html } : {}), attachments: await buildAttachments(attachments) });
    await done({ status: 'ENVIADO', providerRef: info.messageId || null });
  } catch (e) {
    await prisma.outboxMessage.update({ where: { id }, data: { status: 'ERRO', error: (e as Error).message } });
    // Erros 4xx do provedor (dados inválidos) não são repetidos; falhas de rede/5xx voltam para a fila
    if (e instanceof IntegrationError && e.status && e.status < 500 && e.status !== 429) return;
    throw e;
  }
});
