/**
 * Limitador de requisições em memória (janela fixa). Suficiente para uma
 * instância; com várias réplicas, trocar por Redis mantendo a assinatura.
 */
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  if (buckets.size > 10000) for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), reset: b.reset };
}
