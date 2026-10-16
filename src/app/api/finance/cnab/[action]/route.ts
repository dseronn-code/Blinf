import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { cnabRemessa, cnabRetorno, cnabRetornoSample } from '@/server/services/financeExtras';

/** Cobrança bancária CNAB 400: remessa, retorno de exemplo e processamento do retorno */
export const POST = route('financeiro', 'edit', async ({ ctx, params, body }) => {
  switch (params.action) {
    case 'remessa':
      return cnabRemessa(ctx, body?.entryIds);
    case 'sample':
      if (!body?.remessa) fail(400, 'Informe o conteúdo da remessa');
      return { filename: 'RETORNO.RET', content: cnabRetornoSample(body.remessa) };
    case 'retorno':
      return cnabRetorno(ctx, String(body?.content || ''));
    default:
      fail(404, 'Ação inválida');
  }
});
