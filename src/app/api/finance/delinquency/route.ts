import { route } from '@/server/http';
import { delinquency } from '@/server/services/reports';

export const GET = route('financeiro', 'view', async ({ ctx }) => delinquency(ctx));
