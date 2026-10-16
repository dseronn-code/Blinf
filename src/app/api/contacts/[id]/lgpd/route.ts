import { prisma } from '@/lib/db';
import { route, fileResponse } from '@/server/http';
import { fail } from '@/server/errors';

/**
 * LGPD (Lei 13.709/2018) — direitos do titular:
 * GET  exporta todos os dados pessoais e históricos vinculados (portabilidade/acesso)
 * POST anonimiza o cadastro (eliminação), preservando documentos fiscais e financeiros
 *      exigidos por lei (art. 16, I — cumprimento de obrigação legal).
 */
export const GET = route('cadastros', 'view', async ({ ctx, params }) => {
  const c = await prisma.contact.findFirst({ where: { id: params.id, organizationId: ctx.orgId }, include: { addresses: true, persons: true } });
  if (!c) fail(404, 'Contato não encontrado');
  const [orders, quotes, invoices, entries, serviceOrders, returns] = await Promise.all([
    prisma.salesOrder.findMany({ where: { customerId: c!.id }, include: { items: true } }),
    prisma.quote.findMany({ where: { customerId: c!.id }, include: { items: true } }),
    prisma.invoice.findMany({ where: { customerId: c!.id }, select: { model: true, number: true, series: true, status: true, total: true, issueDate: true, accessKey: true } }),
    prisma.financialEntry.findMany({ where: { contactId: c!.id }, select: { type: true, description: true, amount: true, paidAmount: true, dueDate: true, status: true } }),
    prisma.serviceOrder.findMany({ where: { customerId: c!.id } }),
    prisma.salesReturn.findMany({ where: { salesOrderId: { in: (await prisma.salesOrder.findMany({ where: { customerId: c!.id }, select: { id: true } })).map((o) => o.id) } } }),
  ]);
  const data = { geradoEm: new Date().toISOString(), controlador: (await prisma.company.findUnique({ where: { id: ctx.companyId }, select: { name: true, cnpj: true, email: true } })), titular: c, pedidos: orders, propostas: quotes, notasFiscais: invoices, financeiro: entries, ordensDeServico: serviceOrders, devolucoes: returns };
  return fileResponse(JSON.stringify(data, null, 2), 'application/json; charset=utf-8', `lgpd-${c!.document || c!.id}.json`, false);
});

export const POST = route('cadastros', 'edit', async ({ ctx, params, body }) => {
  if (body?.confirm !== 'ANONIMIZAR') fail(400, 'Confirme digitando ANONIMIZAR');
  const c = await prisma.contact.findFirst({ where: { id: params.id, organizationId: ctx.orgId } });
  if (!c) fail(404, 'Contato não encontrado');
  const open = await prisma.financialEntry.count({ where: { contactId: c!.id, status: { in: ['ABERTO', 'PARCIAL'] } } });
  if (open) fail(400, `O titular possui ${open} título(s) em aberto — quite ou cancele antes de anonimizar`);
  const alias = `Titular anonimizado ${c!.id.slice(-6).toUpperCase()}`;
  await prisma.$transaction([
    prisma.contactAddress.deleteMany({ where: { contactId: c!.id } }),
    prisma.contactPerson.deleteMany({ where: { contactId: c!.id } }),
    prisma.contact.update({ where: { id: c!.id }, data: { name: alias, tradeName: null, document: null, ie: null, email: null, phone: null, mobile: null, birthDate: null, zip: null, street: null, number: null, complement: null, district: null, notes: `Dados anonimizados (LGPD) em ${new Date().toLocaleString('pt-BR')} por ${ctx.userName}`, active: false } }),
    prisma.financialEntry.updateMany({ where: { contactId: c!.id }, data: { contactName: alias } }),
  ]);
  return { ok: true, name: alias };
});
