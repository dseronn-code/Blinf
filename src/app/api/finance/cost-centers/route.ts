import { route } from '@/server/http';
import { costCenterReport } from '@/server/services/financeExtras';

/** Resultado por centro de custo (considera rateios) */
export const GET = route('financeiro', 'view', async ({ ctx, query }) => {
  const now = new Date();
  const from = query.get('from') ? new Date(query.get('from') + 'T00:00:00') : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = query.get('to') ? new Date(query.get('to') + 'T23:59:59') : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return costCenterReport(ctx.companyId, from, to);
});
