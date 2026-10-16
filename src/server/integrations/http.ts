/**
 * Cliente HTTP das integrações:
 * - registra cada chamada em IntegrationCall (sem segredos, corpo truncado)
 * - timeout, JSON/form/XML, autenticação por certificado (mTLS) para SEFAZ
 * - permite injetar respostas em testes (setHttpMock) — nenhuma rede é usada nos testes
 */
import https from 'https';
import { prisma } from '@/lib/db';

export type HttpRequest = {
  provider: string;
  companyId?: string | null;
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  /** objeto → JSON; string/Buffer → enviado como está; URLSearchParams → form */
  body?: unknown;
  timeoutMs?: number;
  /** Certificado cliente (PKCS#12) para mTLS — webservices da SEFAZ e da NFS-e Nacional */
  pfx?: { data: Buffer; password: string };
  /** Não registrar o corpo da requisição (ex.: contém senha) */
  redactRequest?: boolean;
};

export type HttpResponse<T = any> = { status: number; ok: boolean; headers: Record<string, string>; text: string; data: T };

type Mock = (req: HttpRequest) => Partial<HttpResponse> | Promise<Partial<HttpResponse>> | undefined;
let mock: Mock | null = null;
/** Testes: intercepta todas as chamadas (retorne undefined para erro de rede) */
export function setHttpMock(fn: Mock | null) {
  mock = fn;
}

export class IntegrationError extends Error {
  constructor(message: string, public status?: number, public body?: unknown) {
    super(message);
  }
}

const SECRET_KEYS = /(token|secret|password|senha|apikey|api_key|access_token|refresh_token|client_secret|authorization)"?\s*[:=]\s*"?[^",&\s}]+/gi;
const scrub = (s: string) => s.replace(SECRET_KEYS, (m) => m.replace(/[:=]\s*"?[^",&\s}]+$/, ':"***"')).slice(0, 4000);

function encodeBody(req: HttpRequest): { body?: string | Buffer; type?: string } {
  const b = req.body;
  if (b == null) return {};
  if (b instanceof URLSearchParams) return { body: b.toString(), type: 'application/x-www-form-urlencoded' };
  if (typeof b === 'string' || Buffer.isBuffer(b)) return { body: b };
  return { body: JSON.stringify(b), type: 'application/json' };
}

export async function httpRequest<T = any>(req: HttpRequest): Promise<HttpResponse<T>> {
  const started = Date.now();
  const method = req.method || (req.body != null ? 'POST' : 'GET');
  const { body, type } = encodeBody(req);
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'GestaoPro-ERP/1.0', ...(type ? { 'Content-Type': type } : {}), ...req.headers };
  let res: HttpResponse<T> | null = null;
  let error: string | null = null;
  try {
    if (mock) {
      const m = await mock({ ...req, method });
      if (!m) throw new Error('Falha de rede (mock)');
      const text = m.text ?? (m.data !== undefined ? (typeof m.data === 'string' ? m.data : JSON.stringify(m.data)) : '');
      res = { status: m.status ?? 200, ok: (m.status ?? 200) < 400, headers: m.headers || {}, text, data: (m.data ?? parse(text)) as T };
    } else if (req.pfx) {
      res = await pfxRequest<T>(req.url, method, headers, body, req.pfx, req.timeoutMs);
    } else {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), req.timeoutMs || 30000);
      try {
        const r = await fetch(req.url, { method, headers, body: body as BodyInit | undefined, signal: ctrl.signal });
        const text = await r.text();
        const h: Record<string, string> = {};
        r.headers.forEach((v, k) => (h[k] = v));
        res = { status: r.status, ok: r.ok, headers: h, text, data: parse(text) as T };
      } finally {
        clearTimeout(t);
      }
    }
    return res;
  } catch (e) {
    error = (e as Error).name === 'AbortError' ? 'Tempo de resposta esgotado' : (e as Error).message;
    throw new IntegrationError(`${req.provider}: ${error}`);
  } finally {
    const url = req.url.replace(/([?&](access_token|token|api_key|key)=)[^&]+/gi, '$1***');
    await prisma.integrationCall
      .create({ data: { companyId: req.companyId || null, provider: req.provider, method, url: url.slice(0, 500), status: res?.status ?? null, durationMs: Date.now() - started, request: req.redactRequest || body == null ? null : scrub(String(body)), response: res ? scrub(res.text) : null, error } })
      .catch(() => {});
  }
}

function parse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function pfxRequest<T>(url: string, method: string, headers: Record<string, string>, body: string | Buffer | undefined, pfx: { data: Buffer; password: string }, timeoutMs = 30000): Promise<HttpResponse<T>> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = https.request(
      { method, hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, headers: { ...headers, ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}) }, pfx: pfx.data, passphrase: pfx.password, timeout: timeoutMs, minVersion: 'TLSv1.2' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode || 0, ok: (res.statusCode || 0) < 400, headers: res.headers as Record<string, string>, text, data: parse(text) as T });
        });
      },
    );
    r.on('timeout', () => r.destroy(new Error('Tempo de resposta esgotado')));
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

/** Lança IntegrationError com a mensagem do provedor quando a resposta não é 2xx */
export function ensureOk<T>(res: HttpResponse<T>, provider: string): HttpResponse<T> {
  if (res.ok) return res;
  const d = res.data as any;
  const msg = d?.errors?.[0]?.description || d?.errors?.[0]?.message || d?.message || d?.error_description || d?.error?.message || d?.error || (typeof d === 'string' ? d.slice(0, 200) : `HTTP ${res.status}`);
  throw new IntegrationError(`${provider}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`, res.status, d);
}
