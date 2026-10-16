import { route } from '@/server/http';
import { cashFlow } from '@/server/services/reports';
import { addDays, startOfDay } from '@/lib/utils';

export const GET = route('financeiro', 'view', async ({ ctx, query }) => {
  const from = query.get('from') ? new Date(query.get('from') + 'T00:00:00') : addDays(startOfDay(), -15);
  const to = query.get('to') ? new Date(query.get('to') + 'T23:59:59') : addDays(startOfDay(), 30);
  return cashFlow(ctx, from, to, query.get('granularity') === 'month' ? 'month' : 'day');
});
