import { route } from '@/server/http';
import { renegotiate } from '@/server/services/financeExtras';

/** Renegociação de títulos em atraso: agrupa, aplica juros/desconto e gera novo parcelamento */
export const POST = route('financeiro', 'edit', async ({ ctx, body }) => renegotiate(ctx, body));
