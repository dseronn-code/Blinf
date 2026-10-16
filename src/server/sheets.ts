import * as XLSX from 'xlsx';
import type { ReportColumn } from './services/reports';

/** Lê CSV/XLSX e devolve linhas com cabeçalhos normalizados (minúsculas, sem acento, _ ) */
export function parseSheet(buf: Buffer, filename: string): Record<string, string>[] {
  const isCsv = filename.toLowerCase().endsWith('.csv');
  const wb = isCsv ? XLSX.read(buf.toString('utf8').replace(/^﻿/, ''), { type: 'string', FS: buf.toString('utf8').split('\n')[0].includes(';') ? ';' : ',' } as never) : XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });
  const norm = (k: string) => k.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
  return raw.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [norm(k), String(v ?? '').trim()])));
}

export function toXlsx(title: string, columns: ReportColumn[], rows: Record<string, unknown>[]) {
  const data = rows.map((r) => Object.fromEntries(columns.map((c) => {
    const v = r[c.key];
    return [c.label, v instanceof Date ? v.toLocaleDateString('pt-BR') : typeof v === 'string' && c.type === 'date' && v ? new Date(v).toLocaleDateString('pt-BR') : v];
  })));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(10, c.label.length + 4, c.key === 'name' || c.key === 'description' ? 40 : 0) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 30).replace(/[\\/?*[\]:]/g, ''));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
