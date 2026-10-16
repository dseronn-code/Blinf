import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { addDays } from '@/lib/utils';

/**
 * Instalação de certificado digital A1 (SIMULADO): aceita um arquivo .pfx/.p12
 * qualquer + senha, valida o formato e registra validade de 1 ano.
 */
export const POST = route('fiscal', 'edit', async ({ ctx, req }) => {
  const form = await req.formData();
  const file = form.get('file') as File | null;
  const password = String(form.get('password') || '');
  if (!file) fail(400, 'Selecione o arquivo do certificado (.pfx ou .p12)');
  if (!/\.(pfx|p12)$/i.test(file!.name)) fail(400, 'Formato inválido: envie um certificado A1 (.pfx ou .p12)');
  if (password.length < 4) fail(400, 'Senha do certificado inválida');
  const company = await prisma.company.findUnique({ where: { id: ctx.companyId } });
  return prisma.company.update({ where: { id: ctx.companyId }, data: { certName: `${company!.name}:${company!.cnpj}`, certIssuer: 'AC SIMULADA RFB v5', certUploadedAt: new Date(), certValidUntil: addDays(new Date(), 365) } });
});

export const DELETE = route('fiscal', 'edit', async ({ ctx }) => prisma.company.update({ where: { id: ctx.companyId }, data: { certName: null, certIssuer: null, certValidUntil: null, certUploadedAt: null } }));
