import { route, fileResponse } from '@/server/http';
import { fail } from '@/server/errors';
import { REPORTS } from '@/server/services/reports';
import { tablePdf } from '@/server/pdf';
import { toXlsx } from '@/server/sheets';
import { addDays, startOfDay, fmtDate } from '@/lib/utils';

// GET /api/reports/:key?from=&to=&format=json|xlsx|pdf
export const GET = route('relatorios', 'view', async ({ ctx, params, query }) => {
  const def = REPORTS[params.key];
  if (!def) fail(404, 'Relatório não encontrado');
  const from = query.get('from') ? new Date(query.get('from') + 'T00:00:00') : addDays(startOfDay(), -30);
  const to = query.get('to') ? new Date(query.get('to') + 'T23:59:59') : new Date();
  const r = await def!.run(ctx, from, to);
  const subtitle = `${r.subtitle ? r.subtitle + ' | ' : ''}Período: ${fmtDate(from)} a ${fmtDate(to)}`;
  const format = query.get('format');
  if (format === 'xlsx') return fileResponse(toXlsx(r.title, r.columns, r.rows), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${params.key}.xlsx`, false);
  if (format === 'pdf') return fileResponse(Buffer.from(await tablePdf(r.title, r.columns, r.rows, subtitle, r.totals)), 'application/pdf', `${params.key}.pdf`);
  return { ...r, subtitle };
});
