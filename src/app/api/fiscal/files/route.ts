import { route, fileResponse } from '@/server/http';
import { fail } from '@/server/errors';
import { spedFiscal, sintegra, accountantPackage } from '@/server/services/fiscalExtras';

/** Arquivos para o contador: ?type=sped|sintegra|zip&from=AAAA-MM-DD&to=AAAA-MM-DD */
export const GET = route('fiscal', 'view', async ({ ctx, query }) => {
  const now = new Date();
  const from = query.get('from') ? new Date(query.get('from') + 'T00:00:00') : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = query.get('to') ? new Date(query.get('to') + 'T23:59:59') : new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  if (from > to) fail(400, 'Período inválido');
  const tag = `${from.toISOString().slice(0, 7)}`;
  switch (query.get('type')) {
    case 'sped':
      return fileResponse(await spedFiscal(ctx.companyId, from, to), 'text/plain; charset=utf-8', `SPED-EFD-${tag}.txt`, false);
    case 'sintegra':
      return fileResponse(await sintegra(ctx.companyId, from, to), 'text/plain; charset=utf-8', `SINTEGRA-${tag}.txt`, false);
    case 'zip':
      return fileResponse(await accountantPackage(ctx.companyId, from, to), 'application/zip', `contador-${tag}.zip`, false);
    default:
      fail(400, 'Tipo de arquivo inválido');
  }
});
