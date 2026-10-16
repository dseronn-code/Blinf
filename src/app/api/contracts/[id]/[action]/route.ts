import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { billContract, setContractStatus, adjustContract } from '@/server/services/contracts';

// POST /api/contracts/:id/bill | suspend | activate | close | adjust
export const POST = route('vendas', 'edit', async ({ ctx, params, body }) => {
  switch (params.action) {
    case 'bill':
      return billContract(ctx, params.id, body?.period || null);
    case 'suspend':
    case 'activate':
    case 'close':
      return setContractStatus(ctx, params.id, params.action);
    case 'adjust': {
      const r = await adjustContract(ctx, params.id);
      return r || { ok: false, message: 'Nenhum reajuste pendente para este contrato' };
    }
    default:
      fail(404, 'Ação inválida');
  }
});
