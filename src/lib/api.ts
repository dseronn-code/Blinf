'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** fetch JSON com tratamento padrão de erro */
export async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init || {};
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && typeof window !== 'undefined' && !url.startsWith('/api/public')) {
    window.location.href = '/login';
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error || `Erro ${res.status}`);
  return data as T;
}

/** Hook de leitura (React Query) — passe null para desabilitar */
export function useApi<T = any>(url: string | null, opts: { refetchInterval?: number } = {}) {
  return useQuery<T>({ queryKey: [url], queryFn: () => api<T>(url!), enabled: !!url, ...opts });
}

/**
 * Hook para ações: executa, mostra toast de sucesso/erro e invalida o cache
 * (dados fluem entre módulos, então invalidamos tudo após uma escrita).
 */
export function useAction() {
  const qc = useQueryClient();
  return async function act<T = any>(method: string, url: string, body?: unknown, success?: string | false): Promise<T | undefined> {
    try {
      const isForm = body instanceof FormData;
      const r = await api<T>(url, { method, ...(isForm ? { body } : body !== undefined ? { json: body } : {}) });
      if (success !== false) toast.success(success || 'Operação realizada com sucesso');
      await qc.invalidateQueries();
      return r;
    } catch (e) {
      toast.error((e as Error).message);
      return undefined;
    }
  };
}

export function qs(params: Record<string, unknown>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const openFile = (url: string) => window.open(url, '_blank');
