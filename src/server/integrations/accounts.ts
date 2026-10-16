/**
 * Contas de integração por empresa — o mesmo modelo do Bling: cada empresa
 * conecta as próprias contas (chave de API, OAuth "Conectar", SMTP...).
 * Se a conta não estiver conectada, os módulos usam a simulação.
 */
import crypto from 'crypto';
import type { IntegrationAccount } from '@prisma/client';
import { prisma } from '@/lib/db';
import { encryptJson, decryptJson, mask } from './crypto';
import { getProvider } from './registry';
import type { AccountCtx, TokenResult } from './types';
import { IntegrationError } from './http';
import './providers';

export function toCtx(a: IntegrationAccount): AccountCtx {
  return {
    id: a.id, companyId: a.companyId, provider: a.provider, environment: a.environment as AccountCtx['environment'], status: a.status,
    secrets: decryptJson(a.secrets), settings: (a.settings || {}) as Record<string, any>, externalAccountId: a.externalAccountId, accountName: a.accountName, tokenExpiresAt: a.tokenExpiresAt,
  };
}

/** Conta conectada da empresa para o provedor (ou null → usar simulação) */
export async function getAccount(companyId: string, provider: string): Promise<AccountCtx | null> {
  const a = await prisma.integrationAccount.findUnique({ where: { companyId_provider: { companyId, provider } } });
  if (!a || a.status !== 'CONECTADO') return null;
  return ensureFreshToken(toCtx(a));
}

/** Primeira conta conectada entre os provedores informados (ordem = preferência) */
export async function firstAccount(companyId: string, providers: string[]) {
  const rows = await prisma.integrationAccount.findMany({ where: { companyId, provider: { in: providers }, status: 'CONECTADO' } });
  rows.sort((a, b) => Number(!!(b.settings as any)?.default) - Number(!!(a.settings as any)?.default) || providers.indexOf(a.provider) - providers.indexOf(b.provider));
  return rows[0] ? ensureFreshToken(toCtx(rows[0])) : null;
}

export async function findAccountByExternalId(provider: string, externalAccountId: string) {
  const a = await prisma.integrationAccount.findFirst({ where: { provider, externalAccountId, status: 'CONECTADO' } });
  return a ? ensureFreshToken(toCtx(a)) : null;
}

/** Atualiza segredos/configurações (merge) */
export async function updateAccount(acc: AccountCtx, patch: { secrets?: Record<string, string | undefined>; settings?: Record<string, unknown>; status?: string; lastError?: string | null; tokenExpiresAt?: Date | null; externalAccountId?: string | null; accountName?: string | null }) {
  const secrets = { ...acc.secrets, ...(patch.secrets || {}) };
  for (const k of Object.keys(secrets)) if (secrets[k] === undefined) delete secrets[k];
  const settings = { ...acc.settings, ...(patch.settings || {}) };
  await prisma.integrationAccount.update({
    where: { id: acc.id },
    data: {
      secrets: encryptJson(secrets), settings: settings as object,
      ...(patch.status !== undefined ? { status: patch.status } : {}), ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
      ...(patch.tokenExpiresAt !== undefined ? { tokenExpiresAt: patch.tokenExpiresAt } : {}), ...(patch.externalAccountId !== undefined ? { externalAccountId: patch.externalAccountId } : {}),
      ...(patch.accountName !== undefined ? { accountName: patch.accountName } : {}),
    },
  });
  Object.assign(acc, { secrets, settings, ...(patch.tokenExpiresAt !== undefined ? { tokenExpiresAt: patch.tokenExpiresAt } : {}) });
  return acc;
}

export async function applyToken(acc: AccountCtx, t: TokenResult) {
  return updateAccount(acc, {
    secrets: { accessToken: t.accessToken, ...(t.refreshToken ? { refreshToken: t.refreshToken } : {}), ...(t.extra || {}) },
    tokenExpiresAt: t.expiresIn ? new Date(Date.now() + (t.expiresIn - 60) * 1000) : null,
    ...(t.externalAccountId ? { externalAccountId: t.externalAccountId } : {}), ...(t.accountName ? { accountName: t.accountName } : {}),
  });
}

/** Renova o token OAuth quando estiver para expirar */
export async function ensureFreshToken(acc: AccountCtx) {
  const def = getProvider(acc.provider);
  if (!def?.oauth?.refresh || !acc.tokenExpiresAt || acc.tokenExpiresAt.getTime() > Date.now() + 60_000) return acc;
  try {
    await applyToken(acc, await def.oauth.refresh(acc));
  } catch (e) {
    await updateAccount(acc, { status: 'ERRO', lastError: `Falha ao renovar o acesso: ${(e as Error).message}. Reconecte a conta.` });
    throw new IntegrationError(`${def.name}: acesso expirado — reconecte a conta em Integrações → Contas`);
  }
  return acc;
}

async function getOrCreate(companyId: string, provider: string) {
  return prisma.integrationAccount.upsert({ where: { companyId_provider: { companyId, provider } }, create: { companyId, provider }, update: {} });
}

/** Salva credenciais digitadas na tela; campos secretos em branco mantêm o valor atual */
export async function saveCredentials(companyId: string, provider: string, input: { environment?: string; values?: Record<string, unknown>; settings?: Record<string, unknown> }) {
  const def = getProvider(provider);
  if (!def) throw new IntegrationError('Provedor desconhecido');
  const acc = toCtx(await getOrCreate(companyId, provider));
  const secrets: Record<string, string | undefined> = {};
  const settings: Record<string, unknown> = { ...(input.settings || {}) };
  for (const f of def.fields) {
    const v = input.values?.[f.key];
    if (v === undefined) continue;
    if (f.secret) {
      if (v !== '' && v !== null) secrets[f.key] = String(v);
    } else settings[f.key] = v;
  }
  if (input.environment) await prisma.integrationAccount.update({ where: { id: acc.id }, data: { environment: input.environment === 'PRODUCAO' ? 'PRODUCAO' : 'SANDBOX' } });
  acc.environment = input.environment === 'PRODUCAO' ? 'PRODUCAO' : input.environment === 'SANDBOX' ? 'SANDBOX' : acc.environment;
  return updateAccount(acc, { secrets, settings });
}

/** Testa a conexão chamando a API do provedor e atualiza o status */
export async function testConnection(companyId: string, provider: string) {
  const def = getProvider(provider);
  if (!def) throw new IntegrationError('Provedor desconhecido');
  const row = await getOrCreate(companyId, provider);
  const acc = toCtx(row);
  const missing = def.fields.filter((f) => f.required && !(f.secret ? acc.secrets[f.key] : acc.settings[f.key]));
  if (missing.length && def.auth !== 'OAUTH') throw new IntegrationError(`Preencha: ${missing.map((m) => m.label).join(', ')}`);
  try {
    const r = await def.test(await ensureFreshToken(acc));
    await prisma.integrationAccount.update({ where: { id: acc.id }, data: { status: 'CONECTADO', lastError: null, lastCheckAt: new Date(), ...(r.accountName ? { accountName: r.accountName } : {}), ...(r.externalAccountId ? { externalAccountId: r.externalAccountId } : {}) } });
    return { ok: true, ...r };
  } catch (e) {
    await prisma.integrationAccount.update({ where: { id: acc.id }, data: { status: 'ERRO', lastError: (e as Error).message, lastCheckAt: new Date() } });
    throw e;
  }
}

export async function disconnect(companyId: string, provider: string) {
  await prisma.integrationAccount.updateMany({ where: { companyId, provider }, data: { status: 'DESCONECTADO', secrets: null, tokenExpiresAt: null, lastError: null } });
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------
export const appUrl = (fallbackOrigin?: string) => (process.env.NEXTAUTH_URL || fallbackOrigin || 'http://localhost:3000').replace(/\/$/, '');
export const oauthRedirectUri = (provider: string, origin?: string) => `${appUrl(origin)}/api/oauth/${provider.toLowerCase()}/callback`;

export async function startOAuth(companyId: string, provider: string, userId: string, origin?: string) {
  const def = getProvider(provider);
  if (!def?.oauth) throw new IntegrationError('Este provedor não usa OAuth');
  const acc = toCtx(await getOrCreate(companyId, provider));
  if (!def.oauth.appConfigured() && !acc.settings.clientId) throw new IntegrationError(`${def.name}: o aplicativo da plataforma não está configurado (variáveis de ambiente). Veja o README → Integrações reais.`);
  const state = crypto.randomBytes(18).toString('hex');
  await prisma.oAuthState.create({ data: { state, companyId, provider, userId } });
  await prisma.oAuthState.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 3600_000) } } });
  return def.oauth.authorizeUrl(acc, state, oauthRedirectUri(provider, origin));
}

export async function finishOAuth(provider: string, params: URLSearchParams, origin?: string) {
  const def = getProvider(provider);
  if (!def?.oauth) throw new IntegrationError('Provedor inválido');
  const st = params.get('state') ? await prisma.oAuthState.findUnique({ where: { state: params.get('state')! } }) : null;
  if (!st || st.provider !== provider || st.createdAt.getTime() < Date.now() - 3600_000) throw new IntegrationError('Sessão de autorização inválida ou expirada. Tente conectar novamente.');
  await prisma.oAuthState.delete({ where: { state: st.state } });
  if (params.get('error')) throw new IntegrationError(`${def.name}: autorização negada (${params.get('error_description') || params.get('error')})`);
  const acc = toCtx(await getOrCreate(st.companyId, provider));
  await applyToken(acc, await def.oauth.exchange(acc, params, oauthRedirectUri(provider, origin)));
  await prisma.integrationAccount.update({ where: { id: acc.id }, data: { status: 'CONECTADO', lastError: null, lastCheckAt: new Date() } });
  try {
    await testConnection(st.companyId, provider);
  } catch {}
  return { companyId: st.companyId };
}

/** Visão segura da conta para a interface (segredos mascarados) */
export function publicView(a: IntegrationAccount | null) {
  if (!a) return null;
  const secrets = decryptJson(a.secrets);
  return {
    id: a.id, environment: a.environment, status: a.status, settings: a.settings, accountName: a.accountName, externalAccountId: a.externalAccountId, lastError: a.lastError, lastCheckAt: a.lastCheckAt, tokenExpiresAt: a.tokenExpiresAt,
    secrets: Object.fromEntries(Object.entries(secrets).filter(([k]) => !['accessToken', 'refreshToken'].includes(k)).map(([k, v]) => [k, mask(v)])),
    hasToken: !!secrets.accessToken,
  };
}

/** Token secreto usado na URL do webhook de cada conta */
export const webhookToken = (accountId: string) => crypto.createHmac('sha256', process.env.NEXTAUTH_SECRET || 'gestaopro-dev-secret').update(`hook:${accountId}`).digest('hex').slice(0, 32);
export const webhookUrl = (provider: string, accountId: string, origin?: string) => `${appUrl(origin)}/api/hooks/${provider.toLowerCase()}/${accountId}?token=${webhookToken(accountId)}`;
