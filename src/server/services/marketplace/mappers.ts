/**
 * Mapeadores comuns (funções puras): UF, endereço, documento, valores,
 * IDs compostos de anúncio e verificação de assinaturas HMAC.
 */
import crypto from 'crypto';
import { onlyDigits } from '@/lib/utils';

const UF_NAMES: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO', maranhao: 'MA',
  'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
};
const UFS = new Set(Object.values(UF_NAMES));

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** "SP", "BR-SP", "São Paulo" → "SP" */
export function toUf(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.toUpperCase().match(/^(?:BR-)?([A-Z]{2})$/);
  if (m && UFS.has(m[1])) return m[1];
  return UF_NAMES[fold(s)] || null;
}

export const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export const str = (v: unknown) => (v == null || v === '' ? null : String(v).trim() || null);

export const cep = (v: unknown) => {
  const d = onlyDigits(str(v));
  return d.length === 8 ? d : d || null;
};

/** CPF/CNPJ só com dígitos (ou null) */
export function doc(v: unknown) {
  const d = onlyDigits(str(v));
  return d.length === 11 || d.length === 14 ? d : null;
}

/** "Rua X, 123 - Apto 4" → { street, number, complement } */
export function splitStreet(line: unknown): { street: string | null; number: string | null; complement: string | null } {
  const s = str(line);
  if (!s) return { street: null, number: null, complement: null };
  // "Rua X, 123 - Apto 4" (vírgula antes do número) ou "Avenida Paulista 1000" (número no fim)
  const m = s.match(/^(.*?),\s*(\d+[A-Za-z]?|s\/?n)\b\s*[-,]?\s*(.*)$/i) || s.match(/^(.*\D)\s+(\d+[A-Za-z]?)()$/);
  if (m && m[1].trim()) return { street: m[1].trim().replace(/,$/, ''), number: m[2], complement: str(m[3]) };
  return { street: s, number: null, complement: null };
}

export function fullName(...parts: unknown[]) {
  return parts.map((p) => str(p)).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** ID composto do anúncio: "MLB123/1789" (item/variação), "123/456/789" (Shopify: produto/variante/item de estoque) */
export function joinExternal(...parts: unknown[]) {
  return parts.filter((p) => p != null && p !== '' && p !== 0 && p !== '0').map(String).join('/');
}
export const splitExternal = (id: string) => id.split('/');

/** HMAC-SHA256 do corpo bruto, comparado em tempo constante */
export function hmacMatches(secret: string, raw: string, given: string | null | undefined, encoding: 'hex' | 'base64') {
  if (!secret || !given) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest(encoding);
  const a = Buffer.from(expected);
  const b = Buffer.from(given.trim());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Divide uma lista em blocos (APIs com limite de IDs por chamada) */
export function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
