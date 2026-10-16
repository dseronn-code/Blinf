import { route } from '@/server/http';
import { regularizeContingency } from '@/server/services/fiscal';

/** Transmite à SEFAZ as NFC-e emitidas em contingência offline */
export const POST = route('fiscal', 'edit', async ({ ctx }) => regularizeContingency(ctx.companyId, ctx.orgId, ctx.userName));
