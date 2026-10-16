import { route } from '@/server/http';
import { lookupPdvCode } from '@/server/services/operations';

/** Leitura de código no PDV (EAN, SKU ou etiqueta de balança) */
export const GET = route('pdv', 'view', async ({ ctx, query }) => (await lookupPdvCode(ctx, query.get('code') || '')) || { product: null });
