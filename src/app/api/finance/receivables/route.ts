import { route } from '@/server/http';
import { receivablesSchedule, settleReceivables } from '@/server/services/financeExtras';

/** Agenda de recebíveis de cartão (POS/PDV/loja) e liquidação/antecipação */
export const GET = route('financeiro', 'view', async ({ ctx }) => receivablesSchedule(ctx.companyId));

export const POST = route('financeiro', 'edit', async ({ ctx, body }) => settleReceivables(ctx, { anticipate: !!body?.anticipate, anticipationRate: body?.rate ? Number(body.rate) : undefined }));
