import { route } from '@/server/http';
import { runDailyRoutine } from '@/server/services/automations';

// Executa a rotina diária manualmente (cobrança, lotes vencendo, contas do dia)
export const POST = route('automacoes', 'edit', async ({ ctx }) => ({ ran: await runDailyRoutine({ companyId: ctx.companyId, orgId: ctx.orgId, userName: ctx.userName }, true) }));
