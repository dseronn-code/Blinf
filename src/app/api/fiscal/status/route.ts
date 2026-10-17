import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { prisma } from '@/lib/db';
import { sefazServiceStatus, fiscalProviderOf } from '@/server/services/fiscal';
import { getAccount } from '@/server/integrations/accounts';

/** Consulta o status dos serviços da SEFAZ (NFeStatusServico4) com o certificado da empresa */
export const GET = route('fiscal', 'view', async ({ ctx }) => {
  const c = await prisma.company.findUnique({ where: { id: ctx.companyId }, select: { fiscalProvider: true } });
  const provider = fiscalProviderOf(c!);
  if (provider === 'FOCUS_NFE') {
    const acc = await getAccount(ctx.companyId, 'FOCUS_NFE');
    return { provider, focus: acc ? { connected: true, environment: acc.environment } : { connected: false } };
  }
  if (!(await prisma.company.count({ where: { id: ctx.companyId, certPfx: { not: null } } }))) fail(400, 'Instale o certificado A1 para consultar a SEFAZ');
  return { provider, ...(await sefazServiceStatus(ctx.companyId)) };
});
