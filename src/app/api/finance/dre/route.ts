import { route } from '@/server/http';
import { dre } from '@/server/services/reports';
import { startOfMonth, endOfMonth } from '@/lib/utils';

export const GET = route('financeiro', 'view', async ({ ctx, query }) => {
  const from = query.get('from') ? new Date(query.get('from') + 'T00:00:00') : startOfMonth();
  const to = query.get('to') ? new Date(query.get('to') + 'T23:59:59') : endOfMonth();
  return dre(ctx, from, to, query.get('regime') === 'CAIXA' ? 'CAIXA' : 'COMPETENCIA');
});
