import { route } from '@/server/http';
import { budgetVsActual, saveBudget } from '@/server/services/financeExtras';

/** Orçamento (previsto x realizado) por conta do plano de contas */
export const GET = route('financeiro', 'view', async ({ ctx, query }) => {
  const year = Number(query.get('year')) || new Date().getFullYear();
  const month = query.get('month') ? Number(query.get('month')) : undefined;
  return budgetVsActual(ctx.companyId, year, month);
});

export const PUT = route('financeiro', 'edit', async ({ ctx, body }) => saveBudget(ctx.companyId, body?.rows || []));
