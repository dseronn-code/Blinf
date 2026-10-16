import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { listProviders } from '@/server/integrations/registry';
import { publicView, webhookUrl, oauthRedirectUri } from '@/server/integrations/accounts';

/** Provedores disponíveis + situação da conta de cada um na empresa ativa */
export const GET = route('integracoes', 'view', async ({ ctx, req }) => {
  const rows = await prisma.integrationAccount.findMany({ where: { companyId: ctx.companyId } });
  const origin = new URL(req.url).origin;
  return listProviders().map((p) => {
    const a = rows.find((r) => r.provider === p.key) || null;
    return {
      key: p.key, name: p.name, category: p.category, description: p.description, color: p.color, docsUrl: p.docsUrl, auth: p.auth, sandbox: !!p.sandbox, capabilities: p.capabilities,
      fields: p.fields, oauthReady: p.oauth ? p.oauth.appConfigured() : undefined, hasWebhook: !!p.webhook,
      account: publicView(a),
      webhookUrl: p.webhook ? (a && !p.webhook.findAccount ? webhookUrl(p.key, a.id, origin) : `${origin}/api/hooks/${p.key.toLowerCase()}`) : null,
      redirectUri: p.oauth ? oauthRedirectUri(p.key, origin) : null,
    };
  });
});
