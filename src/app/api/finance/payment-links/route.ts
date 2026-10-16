import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { round2, randomDigits, addDays } from '@/lib/utils';
import { buildPixPayload } from '@/lib/br';
import { defaultBankAccount } from '@/server/services/finance';
import { paymentAccount, gatewayFor } from '@/server/services/payments';

export const GET = route('financeiro', 'view', async ({ ctx }) => {
  // Provedor de cobrança conectado (Asaas/Mercado Pago) — null = cobranças simuladas
  const acc = await paymentAccount(ctx.companyId);
  return {
    rows: await prisma.paymentLink.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: 'desc' } }),
    gateway: acc ? { provider: acc.provider, name: gatewayFor(acc.provider)?.name || acc.provider, environment: acc.environment, accountName: acc.accountName, autoCharge: acc.settings.autoCharge !== false } : null,
  };
});

/** Link de pagamento avulso (gera conta a receber vinculada) */
export const POST = route('financeiro', 'edit', async ({ ctx, body }) => {
  const amount = round2(Number(body.amount));
  if (!(amount > 0)) fail(400, 'Informe o valor');
  const company = await prisma.company.findUnique({ where: { id: ctx.companyId } });
  const bank = await defaultBankAccount(prisma, ctx.companyId, 'CONTA_DIGITAL');
  const slug = `pg${randomDigits(10)}`;
  const entry = await prisma.financialEntry.create({ data: { companyId: ctx.companyId, type: 'RECEBER', description: body.description || 'Link de pagamento', contactName: body.customerName || null, dueDate: body.expiresAt ? new Date(body.expiresAt) : addDays(new Date(), 7), amount, origin: 'MANUAL', paymentMethod: 'LINK', chartAccountId: (await prisma.chartAccount.findFirst({ where: { companyId: ctx.companyId, code: '1.1.01' } }))?.id } });
  return prisma.paymentLink.create({ data: { companyId: ctx.companyId, slug, description: body.description || 'Pagamento', amount, methods: body.methods || 'TODOS', customerName: body.customerName || null, entryId: entry.id, expiresAt: entry.dueDate, pixPayload: buildPixPayload({ key: bank?.pixKey || company!.cnpj, name: company!.tradeName || company!.name, city: company!.city || 'SAO PAULO', amount, txid: slug }) } });
});
