import { route } from '@/server/http';
import { getContract, saveContract } from '@/server/services/contracts';

// Contrato com histórico de faturamentos (contas a receber e notas)
export const GET = route('vendas', 'view', async ({ ctx, params }) => getContract(ctx, params.id));
export const PUT = route('vendas', 'edit', async ({ ctx, params, body }) => saveContract(ctx, body, params.id));
