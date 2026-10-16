/**
 * Teste de integração ponta a ponta (usa o banco do DATABASE_URL já populado pelo seed).
 * Executar com: RUN_DB_TESTS=1 npm test
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createOrder, invoiceOrder, type Actor } from '@/server/services/sales';
import { createReturn } from '@/server/services/returns';
import { getAvailability } from '@/server/services/stock';
import { evaluateCoupon, createInventoryCount, countScan, finishInventoryCount } from '@/server/services/operations';
import { extractSignedParts } from '@/server/services/fiscal';
import { verifySignature } from '@/server/services/cert';

const run = process.env.RUN_DB_TESTS === '1';

describe.skipIf(!run)('fluxo integrado (banco)', () => {
  let actor: Actor;
  let productId: string;
  let customerId: string;

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ where: { cnpj: '11444777000161' } });
    actor = { companyId: company.id, orgId: company.organizationId, userName: 'Teste automatizado' };
    productId = (await prisma.product.findFirstOrThrow({ where: { organizationId: company.organizationId, sku: 'BON-ABA-01' } })).id;
    customerId = (await prisma.contact.findFirstOrThrow({ where: { organizationId: company.organizationId, types: { has: 'CLIENTE' }, personType: 'PF', document: { not: null }, code: null } })).id;
  });

  it('pedido → NF-e assinada → baixa de estoque → contas a receber → devolução', async () => {
    const before = (await getAvailability(prisma, actor, [productId])).get(productId)!;
    const order = await createOrder(actor, { customerId, items: [{ productId, quantity: 2 }], paymentMethod: 'BOLETO', installments: 2 });
    expect(order.status).toBe('ABERTO');

    await invoiceOrder(actor, order.id, { model: 'NFE' });
    const inv = await prisma.invoice.findFirstOrThrow({ where: { salesOrderId: order.id } });
    expect(inv.status).toBe('AUTORIZADA');
    expect(inv.accessKey).toHaveLength(44);
    expect(inv.signed).toBe(true);
    const parts = extractSignedParts(inv.xml!);
    expect(parts && verifySignature(parts.canonical, parts.signature)).toBe(true);

    const after = (await getAvailability(prisma, actor, [productId])).get(productId)!;
    expect(after.quantity).toBe(before.quantity - 2);
    const entries = await prisma.financialEntry.findMany({ where: { originId: order.id, type: 'RECEBER' } });
    expect(entries).toHaveLength(2);
    expect(Math.round(entries.reduce((a, e) => a + e.amount, 0) * 100) / 100).toBe(order.total);

    const items = await prisma.salesOrderItem.findMany({ where: { salesOrderId: order.id } });
    const ret = await createReturn(actor, { salesOrderId: order.id, reason: 'Teste de devolução', refundMethod: 'CREDITO', items: [{ salesOrderItemId: items[0].id, quantity: 1, restock: true }] });
    const full = await prisma.salesReturn.findUniqueOrThrow({ where: { id: (ret as { id: string }).id } });
    const devol = await prisma.invoice.findUniqueOrThrow({ where: { id: full.invoiceId! } });
    expect(devol.finalidade).toBe(4);
    expect(devol.refAccessKey).toBe(inv.accessKey);
    expect(['1202', '2202']).toContain((await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId: devol.id } })).cfop);
    const back = (await getAvailability(prisma, actor, [productId])).get(productId)!;
    expect(back.quantity).toBe(before.quantity - 1);
    await expect(createReturn(actor, { salesOrderId: order.id, reason: 'Excesso', items: [{ salesOrderItemId: items[0].id, quantity: 5 }] })).rejects.toThrow();
  });

  it('cupom de desconto valida mínimo e tipo', async () => {
    const c = await evaluateCoupon(actor.companyId, 'BEMVINDO10', 200);
    expect(c?.discount).toBe(20);
    await expect(evaluateCoupon(actor.companyId, 'BEMVINDO10', 50)).rejects.toThrow();
    await expect(evaluateCoupon(actor.companyId, 'NAOEXISTE', 500)).rejects.toThrow();
  });

  it('inventário por bipagem ajusta o saldo', async () => {
    const wh = await prisma.warehouse.findFirstOrThrow({ where: { companyId: actor.companyId, code: 'LOJA' } });
    await prisma.inventoryCount.updateMany({ where: { companyId: actor.companyId, warehouseId: wh.id, status: 'ABERTO' }, data: { status: 'CANCELADO' } });
    const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    const count = await createInventoryCount(actor, { warehouseId: wh.id, productIds: [productId] });
    for (let i = 0; i < 7; i++) await countScan(actor, count.id, p.gtin || p.sku);
    await finishInventoryCount(actor, count.id);
    const bal = await prisma.stockBalance.findUniqueOrThrow({ where: { productId_warehouseId: { productId, warehouseId: wh.id } } });
    expect(bal.quantity).toBe(7);
  });
});
