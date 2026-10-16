import { route } from '@/server/http';
import { dashboard } from '@/server/services/reports';

export const GET = route('dashboard', 'view', async ({ ctx }) => dashboard(ctx));
