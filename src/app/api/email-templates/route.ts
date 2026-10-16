import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { DEFAULT_TEMPLATES, TEMPLATE_VARS, SAMPLE_VARS, renderWith, brandOf, getTemplate } from '@/server/services/emailTemplates';
import { sendMessage, hasRealEmail } from '@/server/services/messaging';

/** Modelos de e-mail: padrão + personalizados da empresa */
export const GET = route('configuracoes', 'view', async ({ ctx }) => {
  const custom = await prisma.emailTemplate.findMany({ where: { companyId: ctx.companyId } });
  return {
    vars: TEMPLATE_VARS,
    realEmail: await hasRealEmail(ctx.companyId),
    rows: Object.entries(DEFAULT_TEMPLATES).map(([key, d]) => {
      const c = custom.find((x) => x.key === key);
      return { id: key, key, name: d.name, description: d.description, subject: c?.subject ?? d.subject, html: c?.html ?? d.html, custom: !!c, active: c ? c.active : true, updatedAt: c?.updatedAt || null, defaultSubject: d.subject, defaultHtml: d.html };
    }),
  };
});

/** Salva o modelo personalizado ({ key, subject, html, active }) ou volta ao padrão ({ key, reset: true }) */
export const PUT = route('configuracoes', 'edit', async ({ ctx, body }) => {
  const key = String(body?.key || '');
  if (!DEFAULT_TEMPLATES[key]) fail(400, 'Modelo inválido');
  if (body.reset) {
    await prisma.emailTemplate.deleteMany({ where: { companyId: ctx.companyId, key } });
    return { ok: true };
  }
  const subject = String(body.subject || '').trim();
  const html = String(body.html || '').trim();
  if (!subject || !html) fail(400, 'Informe o assunto e o conteúdo do e-mail');
  if (html.length > 100_000) fail(400, 'Conteúdo muito grande');
  const active = body.active !== false;
  return prisma.emailTemplate.upsert({ where: { companyId_key: { companyId: ctx.companyId, key } }, create: { companyId: ctx.companyId, key, subject, html, active }, update: { subject, html, active } });
});

/** { action: 'preview' | 'test', key, subject?, html?, to? } — usa os dados de exemplo */
export const POST = route('configuracoes', 'view', async ({ ctx, body }) => {
  const key = String(body?.key || '');
  if (!DEFAULT_TEMPLATES[key]) fail(400, 'Modelo inválido');
  const tpl = body.subject != null && body.html != null ? { subject: String(body.subject), html: String(body.html) } : await getTemplate(ctx.companyId, key);
  const r = renderWith(tpl, SAMPLE_VARS, await brandOf(ctx.companyId));
  if (body.action === 'preview') return r;
  if (body.action === 'test') {
    const to = String(body.to || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(to)) fail(400, 'E-mail de destino inválido');
    const row = await sendMessage(ctx.companyId, { to, subject: `[Teste] ${r.subject}`, body: r.text, html: r.html, related: `template:${key}` });
    return { ok: true, id: row?.id, simulated: !(await hasRealEmail(ctx.companyId)) };
  }
  fail(400, 'Ação inválida');
});
