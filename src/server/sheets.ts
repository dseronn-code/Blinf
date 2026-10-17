import ExcelJS from 'exceljs';
import type { ReportColumn } from './services/reports';

const norm = (k: string) => k.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');

/** CSV com separador ; ou , e campos entre aspas (padrão Excel/BR) */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const sep = (src.split(/\r?\n/)[0] || '').includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toLocaleDateString('pt-BR');
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v);
}

/** Lê CSV/XLSX e devolve linhas com cabeçalhos normalizados (minúsculas, sem acento, _ ) */
export async function parseSheet(buf: Buffer, filename: string): Promise<Record<string, string>[]> {
  let table: string[][];
  if (filename.toLowerCase().endsWith('.csv')) table = parseCsv(buf.toString('utf8'));
  else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    table = [];
    ws?.eachRow({ includeEmpty: false }, (r) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(r.getCell(c).value));
      table.push(cells);
    });
  }
  const [header = [], ...data] = table;
  const keys = header.map((h) => norm(String(h)));
  return data.map((r) => Object.fromEntries(keys.map((k, i) => [k, String(r[i] ?? '').trim()])));
}

/** Gera planilha .xlsx do relatório (cabeçalho em negrito, larguras ajustadas, filtro) */
export async function toXlsx(title: string, columns: ReportColumn[], rows: Record<string, unknown>[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GestãoPro';
  const ws = wb.addWorksheet(title.slice(0, 30).replace(/[\\/?*[\]:]/g, '') || 'Relatório');
  ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(10, c.label.length + 4, c.key === 'name' || c.key === 'description' ? 40 : 0) }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow(Object.fromEntries(columns.map((c) => {
      const v = r[c.key];
      return [c.key, v instanceof Date ? v.toLocaleDateString('pt-BR') : typeof v === 'string' && c.type === 'date' && v ? new Date(v).toLocaleDateString('pt-BR') : v];
    })));
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, columns.length) } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
