import { route } from '@/server/http';
import { listContracts, saveContract, billDueContracts } from '@/server/services/contracts';

// GET: lista com resumo (MRR, ativos, a faturar no mês) · POST: novo contrato
export const GET = route('vendas', 'view', async ({ ctx, query }) => listContracts(ctx, { status: query.get('status'), q: query.get('q') }));
export const POST = route('vendas', 'edit', async ({ ctx, body }) => {
  // POST { action: 'bill-due' } fatura todos os contratos vencidos (mesma rotina da automação diária)
  if (body?.action === 'bill-due') return billDueContracts(ctx, { aheadDays: body.aheadDays });
  return saveContract(ctx, body);
});
