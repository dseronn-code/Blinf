import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Arredonda para 2 casas (valores monetários) */
export const round2 = (n: number) => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;
export const round3 = (n: number) => Math.round((Number(n) || 0) * 1000 + Number.EPSILON) / 1000;

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (n: number | null | undefined) => brl.format(Number(n) || 0);
export const num = (n: number | null | undefined, d = 2) =>
  (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d });
export const pct = (n: number | null | undefined) => `${num(n, 2)}%`;

export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}
export function fmtDateTime(d: string | Date | null | undefined) {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
/** yyyy-mm-dd para inputs type=date */
export function toInputDate(d: string | Date | null | undefined) {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

export function onlyDigits(s: string | null | undefined) {
  return (s || '').replace(/\D/g, '');
}
export function fmtDoc(doc: string | null | undefined) {
  const d = onlyDigits(doc);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc || '';
}
export function fmtCep(cep: string | null | undefined) {
  const d = onlyDigits(cep);
  return d.length === 8 ? d.replace(/(\d{5})(\d{3})/, '$1-$2') : cep || '';
}

export function addDays(d: Date, days: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}
export function startOfDay(d = new Date()) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
export function endOfDay(d = new Date()) {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}
export function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
export function endOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
export function randomDigits(n: number) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}
