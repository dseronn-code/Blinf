import { route } from '@/server/http';
import { abcCurve } from '@/server/services/reports';

export const GET = route('estoque', 'view', async ({ ctx, query }) => abcCurve(ctx, Number(query.get('days')) || 90, query.get('by') === 'quantity' ? 'quantity' : 'value'));
