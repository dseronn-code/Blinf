/**
 * SMTP da empresa: e-mails (notas, cobranças, rastreio...) saem do servidor de
 * e-mail do próprio cliente (Gmail/Google Workspace, Microsoft 365, Locaweb...).
 */
import nodemailer from 'nodemailer';
import { registerProvider } from '../registry';
import type { AccountCtx } from '../types';

export function smtpTransport(acc: Pick<AccountCtx, 'settings' | 'secrets'>) {
  const s = acc.settings;
  const security = String(s.security || 'STARTTLS');
  return nodemailer.createTransport({
    host: s.host,
    port: Number(s.port || (security === 'SSL' ? 465 : 587)),
    secure: security === 'SSL',
    requireTLS: security === 'STARTTLS',
    ignoreTLS: security === 'NENHUMA',
    auth: s.user ? { user: s.user, pass: acc.secrets.password } : undefined,
    connectionTimeout: 15000,
  });
}

/** "Nome <email>" do remetente configurado */
export function smtpFrom(acc: Pick<AccountCtx, 'settings'>) {
  const email = acc.settings.fromEmail || acc.settings.user;
  return acc.settings.fromName ? `"${String(acc.settings.fromName).replace(/"/g, '')}" <${email}>` : email;
}

registerProvider({
  key: 'SMTP',
  name: 'E-mail (SMTP próprio)',
  category: 'MENSAGENS',
  color: '#2563eb',
  description: 'Envie notas fiscais, boletos, rastreios e avisos a partir do e-mail da sua empresa, usando os modelos de e-mail personalizados.',
  auth: 'SMTP',
  fields: [
    { key: 'host', label: 'Servidor SMTP', required: true, placeholder: 'smtp.gmail.com' },
    { key: 'port', label: 'Porta', type: 'number', placeholder: '587' },
    { key: 'security', label: 'Segurança', type: 'select', options: [{ value: 'STARTTLS', label: 'STARTTLS (porta 587)' }, { value: 'SSL', label: 'SSL/TLS (porta 465)' }, { value: 'NENHUMA', label: 'Nenhuma (porta 25)' }] },
    { key: 'user', label: 'Usuário', placeholder: 'financeiro@suaempresa.com.br' },
    { key: 'password', label: 'Senha', secret: true, type: 'password', help: 'No Gmail/Microsoft 365 com verificação em duas etapas, use uma senha de app.' },
    { key: 'fromName', label: 'Nome do remetente', placeholder: 'Loja Exemplo' },
    { key: 'fromEmail', label: 'E-mail do remetente', required: true, placeholder: 'contato@suaempresa.com.br' },
    { key: 'replyTo', label: 'Responder para', placeholder: 'atendimento@suaempresa.com.br' },
  ],
  capabilities: ['Envio real dos e-mails da caixa de saída', 'Modelos HTML com a identidade da empresa (Configurações → Modelos de e-mail)', 'DANFE e XML anexados ao e-mail da nota'],
  test: async (acc) => {
    await smtpTransport(acc).verify();
    return { accountName: smtpFrom(acc), message: 'Servidor SMTP respondeu e aceitou o login' };
  },
});
