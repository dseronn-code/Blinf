import { route } from '@/server/http';
import { getMdfeDetail } from '@/server/services/mdfe';

export const GET = route('fiscal', 'view', async ({ ctx, params }) => getMdfeDetail(ctx.companyId, params.id));
