/**
 * Mensagens para clientes/fornecedores (e-mail e WhatsApp).
 * Toda mensagem passa pela caixa de saída (OutboxMessage) e é enviada pela fila.
 * - E-mail: enviado de verdade via SMTP quando SMTP_HOST estiver configurado;
 *   caso contrário fica registrado como SIMULADO.
 * - WhatsApp: sempre simulado (requer conta na API oficial do WhatsApp Business).
 */
import nodemailer from 'nodemailer';
import { prisma } from '@/lib/db';
import { enqueue, registerJob } from './jobs';

export async function sendMessage(companyId: string, msg: { channel?: 'EMAIL' | 'WHATSAPP'; to: string | null | undefined; subject: string; body: string; related?: string }) {
  if (!msg.to) return null;
  const row = await prisma.outboxMessage.create({ data: { companyId, channel: msg.channel || 'EMAIL', to: msg.to, subject: msg.subject, body: msg.body, related: msg.related || null } });
  await enqueue('outbox.send', { id: row.id });
  return row;
}

let transport: nodemailer.Transporter | null = null;
function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  transport ||= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

registerJob('outbox.send', async ({ id }) => {
  const m = await prisma.outboxMessage.findUnique({ where: { id } });
  if (!m || m.status === 'ENVIADO' || m.status === 'SIMULADO') return;
  const t = m.channel === 'EMAIL' ? getTransport() : null;
  if (!t) {
    await prisma.outboxMessage.update({ where: { id }, data: { status: 'SIMULADO', sentAt: new Date() } });
    return;
  }
  try {
    await t.sendMail({ from: process.env.SMTP_FROM || 'GestãoPro <nao-responda@gestaopro.local>', to: m.to, subject: m.subject, text: m.body });
    await prisma.outboxMessage.update({ where: { id }, data: { status: 'ENVIADO', sentAt: new Date(), error: null } });
  } catch (e) {
    await prisma.outboxMessage.update({ where: { id }, data: { status: 'ERRO', error: (e as Error).message } });
    throw e;
  }
});
