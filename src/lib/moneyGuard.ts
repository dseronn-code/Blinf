/**
 * Proteção de centavos: todo valor monetário gravado no banco é arredondado
 * para 2 casas (half-up) antes do INSERT/UPDATE, em qualquer módulo
 * (custos unitários e médios mantêm mais casas para não distorcer o CMV).
 * Assim os campos Float guardam sempre o double mais próximo do valor em
 * centavos — somas e comparações feitas com round2 ficam exatas.
 */
const MONEY = /(amount|price|total|value|cost|subtotal|discount|freight|fee$|fees|balance|base$|paid|interest|fine$|revenue|limit|othercosts|insurance|budget|change|opening|closing|expected(amount)?$|gross|net)/i;
const NOT_MONEY = /(avgcost|unitcost|rate|percent|quantity|qty|weight|counted|^expected$|width|height|length|tara|mva|days|installments)/i;

export const isMoneyField = (k: string) => MONEY.test(k) && !NOT_MONEY.test(k);

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Arredonda recursivamente os campos monetários de um objeto `data` do Prisma (inclui escritas aninhadas e increment/decrement) */
export function roundMoney<T>(data: T, depth = 0): T {
  if (!data || typeof data !== 'object' || depth > 6) return data;
  if (Array.isArray(data)) return data.map((d) => roundMoney(d, depth + 1)) as T;
  if (data instanceof Date || Buffer.isBuffer(data) || data instanceof Uint8Array) return data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (typeof v === 'number' && isMoneyField(k)) out[k] = r2(v);
    else if (v && typeof v === 'object' && isMoneyField(k) && !Array.isArray(v) && !(v instanceof Date)) {
      // { increment: 1.005 } / { set: 2.999 }
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([op, x]) => [op, typeof x === 'number' ? r2(x) : x]));
    } else if (v && typeof v === 'object') out[k] = roundMoney(v, depth + 1);
    else out[k] = v;
  }
  return out as T;
}

const WRITES = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert']);

/** Middleware Prisma ($use) */
export async function moneyMiddleware(params: { action: string; args: any }, next: (p: any) => Promise<unknown>) {
  if (WRITES.has(params.action) && params.args) {
    if (params.args.data) params.args.data = roundMoney(params.args.data);
    if (params.args.create) params.args.create = roundMoney(params.args.create);
    if (params.args.update) params.args.update = roundMoney(params.args.update);
  }
  return next(params);
}
