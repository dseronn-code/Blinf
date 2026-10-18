import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { getCtx, requirePerm, type Ctx } from './context';
import { prisma } from '@/lib/db';
import type { AccessLevel, ModuleKey } from '@/lib/permissions';

import { HttpError } from './errors';
import { RealIntegrationRequired, isDemoMode } from '@/lib/demo';
export { HttpError, fail } from './errors';

export function toErrorResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
  if (e instanceof RealIntegrationRequired) return NextResponse.json({ error: e.message, code: 'CONFIGURACAO_NECESSARIA', feature: e.feature, howTo: e.howTo }, { status: 400 });
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') return NextResponse.json({ error: 'Registro duplicado: já existe um cadastro com estes dados únicos.' }, { status: 409 });
    if (e.code === 'P2003') return NextResponse.json({ error: 'Registro vinculado a outros documentos — não pode ser excluído.' }, { status: 409 });
    if (e.code === 'P2025') return NextResponse.json({ error: 'Registro não encontrado.' }, { status: 404 });
  }
  if (e instanceof Prisma.PrismaClientValidationError) {
    const msg = e.message.split('\n').filter(Boolean).slice(-2).join(' ');
    return NextResponse.json({ error: 'Dados inválidos: ' + msg }, { status: 400 });
  }
  console.error(e);
  return NextResponse.json({ error: (e as Error)?.message || 'Erro interno' }, { status: 500 });
}

type RouteParams = { params: Promise<Record<string, string>> };
type Handler = (args: { req: Request; ctx: Ctx; params: Record<string, string>; body: any; query: URLSearchParams }) => Promise<unknown>;

/**
 * Wrapper das rotas autenticadas: resolve contexto, checa permissão,
 * faz parse do corpo JSON e padroniza respostas de erro.
 */
export function route(mod: ModuleKey | null, level: AccessLevel, fn: Handler) {
  return async (req: Request, rp: RouteParams) => {
    try {
      const ctx = await getCtx();
      // Senha padrão: só libera a troca de senha e os dados do próprio usuário
      if (ctx.mustChangePassword && !/^\/api\/(account\/password|me)(\/|$)/.test(new URL(req.url).pathname)) throw new HttpError(403, 'Troque a sua senha para continuar');
      if (mod) requirePerm(ctx, mod, level);
      const params = rp?.params ? await rp.params : {};
      let body: any = undefined;
      if (req.method !== 'GET' && req.method !== 'DELETE') {
        const ct = req.headers.get('content-type') || '';
        if (ct.includes('application/json')) body = await req.json().catch(() => ({}));
      }
      const query = new URL(req.url).searchParams;
      const result = await fn({ req, ctx, params, body, query });
      if (req.method !== 'GET') audit(ctx, req, params, body).catch(() => {});
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

/** Resposta binária (PDF, XLSX, XML) */
export function fileResponse(data: Uint8Array | Buffer | string, contentType: string, filename: string, inline = true) {
  const body = typeof data === 'string' ? data : new Uint8Array(data);
  return new Response(body as BodyInit, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
    },
  });
}

const SENSITIVE = /password|secret|token|pfx|key/i;

/** Trilha de auditoria: registra toda escrita bem-sucedida (usuário, rota, resumo do corpo) */
async function audit(ctx: Ctx, req: Request, params: Record<string, string>, body: unknown) {
  const path = new URL(req.url).pathname.replace(/^\/api\//, '');
  const parts = path.split('/');
  const entity = parts[0] === 'r' ? parts[1] : parts[0];
  const entityId = params.id || null;
  let details: string | undefined;
  if (body && typeof body === 'object') {
    const clean = Object.fromEntries(Object.entries(body as Record<string, unknown>).filter(([k]) => !SENSITIVE.test(k)).map(([k, v]) => [k, typeof v === 'object' ? '[…]' : v]));
    details = JSON.stringify(clean).slice(0, 400);
  }
  await prisma.auditLog.create({ data: { companyId: ctx.companyId, userId: ctx.userId, action: `${req.method} /${path}`, entity, entityId, details } });
}
