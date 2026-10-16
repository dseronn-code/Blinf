/**
 * Modelos de e-mail (como no Bling): modelos padrão por evento, com variáveis
 * {{cliente}}, {{pedido}}, {{valor}}... e seções condicionais {{#pix}}...{{/pix}}.
 * A empresa pode personalizar assunto e conteúdo (EmailTemplate); o conteúdo é
 * envolvido num layout HTML responsivo com a cor da empresa (logoColor).
 */
import { prisma } from '@/lib/db';

export const TEMPLATE_VARS: { key: string; label: string }[] = [
  { key: 'cliente', label: 'Nome do cliente/destinatário' },
  { key: 'empresa', label: 'Nome da empresa' },
  { key: 'pedido', label: 'Número do pedido' },
  { key: 'valor', label: 'Valor (R$)' },
  { key: 'vencimento', label: 'Data de vencimento' },
  { key: 'linha_digitavel', label: 'Linha digitável do boleto' },
  { key: 'pix', label: 'Pix copia e cola' },
  { key: 'link', label: 'Link (pagamento, rastreio, senha...)' },
  { key: 'rastreio', label: 'Código de rastreio' },
  { key: 'transportadora', label: 'Transportadora e serviço' },
  { key: 'prazo', label: 'Prazo de entrega' },
  { key: 'nota', label: 'Número da nota fiscal' },
  { key: 'chave', label: 'Chave de acesso da NF-e' },
  { key: 'documento', label: 'Tipo do documento/título' },
  { key: 'numero', label: 'Número (OS, devolução...)' },
  { key: 'equipamento', label: 'Equipamento/serviço da OS' },
  { key: 'itens', label: 'Lista de itens' },
  { key: 'mensagem', label: 'Texto complementar' },
  { key: 'perfil', label: 'Perfil de acesso (convite)' },
];

export type DefaultTemplate = { name: string; description: string; subject: string; html: string };

const btn = (label: string) => `{{#link}}<p style="margin:24px 0"><a class="btn" href="{{link}}">${label}</a></p>{{/link}}`;

export const DEFAULT_TEMPLATES: Record<string, DefaultTemplate> = {
  pedido_recebido: {
    name: 'Pedido recebido', description: 'Confirmação enviada ao cliente quando o pedido é registrado.',
    subject: 'Recebemos o seu pedido nº {{pedido}}',
    html: `<h1>Pedido recebido!</h1><p>Olá, {{cliente}}.</p><p>Recebemos o seu pedido <b>nº {{pedido}}</b> no valor de <b>{{valor}}</b>. Assim que o pagamento for confirmado, ele seguirá para separação.</p>{{#itens}}<p class="box">{{itens}}</p>{{/itens}}${btn('Acompanhar pedido')}<p>Obrigado pela preferência!</p>`,
  },
  nota_emitida: {
    name: 'Nota fiscal emitida', description: 'Envio do DANFE (PDF) e XML da nota autorizada.',
    subject: '{{documento}} nº {{nota}} emitida — {{empresa}}',
    html: `<h1>Sua nota fiscal foi emitida</h1><p>Olá, {{cliente}}.</p><p>Segue a <b>{{documento}} nº {{nota}}</b> no valor de <b>{{valor}}</b>.</p>{{#chave}}<p class="box">Chave de acesso:<br><span class="mono">{{chave}}</span></p>{{/chave}}<p>O DANFE (PDF) e o arquivo XML seguem em anexo. Guarde o XML: ele é o documento fiscal válido.</p>{{#link}}<p>Consulte a autenticidade em <a href="{{link}}">{{link}}</a>.</p>{{/link}}`,
  },
  rastreio: {
    name: 'Código de rastreio', description: 'Aviso de postagem com o código de rastreio.',
    subject: 'Seu pedido {{pedido}} foi enviado',
    html: `<h1>Seu pedido está a caminho!</h1><p>Olá, {{cliente}}.</p><p>O pedido <b>nº {{pedido}}</b> foi postado via <b>{{transportadora}}</b>.</p><p class="box">Código de rastreio:<br><span class="mono big">{{rastreio}}</span>{{#prazo}}<br>Prazo estimado: {{prazo}}{{/prazo}}</p>${btn('Rastrear pedido')}`,
  },
  cobranca: {
    name: 'Cobrança / boleto', description: 'Cobrança de título em aberto com boleto e Pix (régua de cobrança).',
    subject: 'Pagamento em aberto — {{empresa}}',
    html: `<h1>Pagamento em aberto</h1><p>Olá, {{cliente}}.</p><p>Identificamos o título <b>{{documento}}</b> no valor de <b>{{valor}}</b>, com vencimento em <b>{{vencimento}}</b>, ainda em aberto.</p>{{#linha_digitavel}}<p class="box">Linha digitável do boleto:<br><span class="mono">{{linha_digitavel}}</span></p>{{/linha_digitavel}}{{#pix}}<p class="box">Pix copia e cola:<br><span class="mono">{{pix}}</span></p>{{/pix}}${btn('Pagar agora')}<p>Se o pagamento já foi feito, desconsidere esta mensagem.</p>`,
  },
  lembrete_vencimento: {
    name: 'Lembrete de vencimento', description: 'Aviso antes do vencimento de um título.',
    subject: 'Lembrete: {{documento}} vence em {{vencimento}}',
    html: `<h1>Lembrete de vencimento</h1><p>Olá, {{cliente}}.</p><p>O título <b>{{documento}}</b> de <b>{{valor}}</b> vence em <b>{{vencimento}}</b>.</p>{{#linha_digitavel}}<p class="box">Linha digitável:<br><span class="mono">{{linha_digitavel}}</span></p>{{/linha_digitavel}}{{#pix}}<p class="box">Pix copia e cola:<br><span class="mono">{{pix}}</span></p>{{/pix}}${btn('Ver boleto / Pix')}`,
  },
  os_concluida: {
    name: 'OS concluída', description: 'Aviso de ordem de serviço pronta para retirada.',
    subject: 'OS nº {{numero}} concluída',
    html: `<h1>Seu serviço está pronto!</h1><p>Olá, {{cliente}}.</p><p>O {{equipamento}} da <b>OS nº {{numero}}</b> está pronto para retirada.</p><p class="box">Total: <b>{{valor}}</b></p>${btn('Ver ordem de serviço')}`,
  },
  boas_vindas: {
    name: 'Boas-vindas', description: 'Enviado ao cadastrar um novo cliente.',
    subject: 'Bem-vindo(a) à {{empresa}}!',
    html: `<h1>Bem-vindo(a)!</h1><p>Olá, {{cliente}}.</p><p>Seu cadastro na <b>{{empresa}}</b> foi realizado com sucesso. Conte conosco!</p>${btn('Visitar a loja')}`,
  },
  devolucao: {
    name: 'Devolução / troca', description: 'Comprovante de devolução ou troca registrada.',
    subject: '{{documento}} nº {{numero}} registrada',
    html: `<h1>{{documento}} registrada</h1><p>Olá, {{cliente}}.</p><p>Registramos a {{documento}} <b>nº {{numero}}</b> referente ao pedido nº {{pedido}}:</p><p class="box">{{itens}}</p><p>Valor: <b>{{valor}}</b></p>{{#mensagem}}<p>{{mensagem}}</p>{{/mensagem}}`,
  },
  recuperar_senha: {
    name: 'Recuperação de senha', description: 'Link para criar uma nova senha (expira em 1 hora).',
    subject: 'Redefinição de senha — {{empresa}}',
    html: `<h1>Redefinir senha</h1><p>Olá, {{cliente}}.</p><p>Recebemos um pedido para redefinir a sua senha. Clique no botão abaixo para criar uma nova:</p>${btn('Criar nova senha')}<p class="muted">O link expira em 1 hora. Se não foi você, ignore este e-mail.</p>`,
  },
  convite_usuario: {
    name: 'Convite de usuário', description: 'Convite para acessar o sistema e definir a senha (72 horas).',
    subject: 'Você foi convidado(a) para acessar a {{empresa}}',
    html: `<h1>Você recebeu um convite</h1><p>Olá, {{cliente}}.</p><p>{{mensagem}} Você foi convidado(a) para acessar o sistema da <b>{{empresa}}</b> com o perfil <b>{{perfil}}</b>.</p>${btn('Definir minha senha')}<p class="muted">O convite expira em 72 horas.</p>`,
  },
};

/** Valores de exemplo para pré-visualização e envio de teste */
export const SAMPLE_VARS: Record<string, string> = {
  cliente: 'Maria Oliveira', pedido: '1024', valor: 'R$ 349,90', vencimento: '20/11/2026', linha_digitavel: '34191.79001 01043.510047 91020.150008 1 99990000034990',
  pix: '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865406349.905802BR5913LOJA EXEMPLO6009SAO PAULO62070503***6304ABCD',
  link: 'https://exemplo.com.br/pedido/1024', rastreio: 'QB123456785BR', transportadora: 'Correios (SEDEX)', prazo: '3 dia(s) úteis', nota: '1530', chave: '35261011444777000161550010000015301000015309',
  documento: 'NF-e', numero: '87', equipamento: 'notebook', itens: '1x Camiseta básica\n2x Meia esportiva', mensagem: 'Qualquer dúvida, responda este e-mail.', perfil: 'Vendedor',
};

export function escapeHtml(s: unknown) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Substitui as variáveis: {{nome}} e seções {{#nome}}...{{/nome}} (exibidas só
 * quando a variável tem valor). No HTML os valores são escapados e quebras de
 * linha viram <br>; no texto puro entram como estão.
 */
export function fillTemplate(tpl: string, vars: Record<string, unknown>, mode: 'html' | 'text' = 'html') {
  const val = (k: string) => (vars[k] == null ? '' : String(vars[k]));
  let out = tpl;
  for (let i = 0; i < 3; i++) out = out.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, k: string, inner: string) => (val(k).trim() ? inner : ''));
  return out.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => (mode === 'html' ? escapeHtml(val(k)).replace(/\r?\n/g, '<br>') : val(k)));
}

export type BrandInfo = { name: string; color?: string | null; email?: string | null; phone?: string | null };

/** Layout responsivo (tabelas + CSS inline, compatível com Gmail/Outlook) */
export function emailLayout(content: string, brand: BrandInfo) {
  const color = /^#[0-9a-f]{3,8}$/i.test(brand.color || '') ? brand.color! : '#16a34a';
  const name = escapeHtml(brand.name);
  const contact = [brand.email, brand.phone].filter(Boolean).map(escapeHtml).join(' · ');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title>
<style>
body{margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937}
.wrap{width:100%;background:#f3f4f6;padding:24px 0}.card{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden}
.head{background:${color};color:#fff;padding:20px 28px;font-size:20px;font-weight:bold}.body{padding:28px;font-size:15px;line-height:1.55}
.body h1{font-size:22px;margin:0 0 16px;color:#111827}.btn{display:inline-block;background:${color};color:#fff !important;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold}
.box{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 14px}.mono{font-family:Consolas,Menlo,monospace;word-break:break-all}.big{font-size:20px;font-weight:bold}
.muted{color:#6b7280;font-size:13px}.foot{padding:16px 28px;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb}
@media (max-width:620px){.wrap{padding:0}.card{border-radius:0}.body{padding:20px}.head{padding:16px 20px}}
</style></head><body><div class="wrap"><table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff">
<tr><td class="head" style="background:${color};color:#fff;padding:20px 28px;font-size:20px;font-weight:bold">${name}</td></tr>
<tr><td class="body" style="padding:28px;font-size:15px;line-height:1.55">${content}</td></tr>
<tr><td class="foot" style="padding:16px 28px;font-size:12px;color:#6b7280">${name}${contact ? `<br>${contact}` : ''}</td></tr>
</table></div></body></html>`;
}

/** Versão em texto puro (para clientes de e-mail sem HTML e WhatsApp) */
export function htmlToText(html: string) {
  return html
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => (label.replace(/<[^>]+>/g, '').trim() === href ? href : `${label.replace(/<[^>]+>/g, '').trim()}: ${href}`))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h\d|div|li|tr)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export type Rendered = { subject: string; html: string; text: string };

/** Renderiza um modelo (assunto + conteúdo) com as variáveis e o layout da empresa */
export function renderWith(tpl: { subject: string; html: string }, vars: Record<string, unknown>, brand: BrandInfo): Rendered {
  const all = { empresa: brand.name, ...vars };
  const content = fillTemplate(tpl.html, all, 'html');
  return { subject: fillTemplate(tpl.subject, all, 'text').replace(/\s*\n\s*/g, ' ').trim(), html: emailLayout(content, brand), text: `${htmlToText(content)}\n\n--\n${brand.name}` };
}

export async function brandOf(companyId: string): Promise<BrandInfo> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true, tradeName: true, logoColor: true, email: true, phone: true } });
  return { name: c?.tradeName || c?.name || 'GestãoPro', color: c?.logoColor, email: c?.email, phone: c?.phone };
}

/** Modelo efetivo: personalizado da empresa (se ativo) ou o padrão */
export async function getTemplate(companyId: string, key: string) {
  const def = DEFAULT_TEMPLATES[key];
  if (!def) throw new Error(`Modelo de e-mail desconhecido: ${key}`);
  const custom = await prisma.emailTemplate.findUnique({ where: { companyId_key: { companyId, key } } }).catch(() => null);
  return custom?.active ? { subject: custom.subject, html: custom.html } : { subject: def.subject, html: def.html };
}

export async function render(templateKey: string, vars: Record<string, unknown>, companyId: string): Promise<Rendered> {
  return renderWith(await getTemplate(companyId, templateKey), vars, await brandOf(companyId));
}
