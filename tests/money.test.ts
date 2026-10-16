import { describe, it, expect } from 'vitest';
import { roundMoney, isMoneyField } from '@/lib/moneyGuard';

describe('proteção de centavos', () => {
  it('classifica campos monetários', () => {
    for (const f of ['amount', 'paidAmount', 'unitPrice', 'total', 'icmsValue', 'freight', 'discount', 'creditLimit', 'netAmount', 'fee', 'initialBalance', 'icmsStBase']) expect(isMoneyField(f), f).toBe(true);
    for (const f of ['quantity', 'unitCost', 'avgCost', 'icmsRate', 'feePercent', 'weight', 'expected', 'counted', 'mvaST', 'installments', 'deadlineDays']) expect(isMoneyField(f), f).toBe(false);
  });
  it('arredonda dados aninhados, increment e listas', () => {
    const r = roundMoney({ amount: 10.005, quantity: 1.2345, items: { create: [{ unitPrice: 0.1 + 0.2, total: 2.675, quantity: 0.3333 }] }, paidAmount: { increment: 1.004 } });
    expect(r.amount).toBe(10.01);
    expect(r.quantity).toBe(1.2345);
    expect(r.items.create[0].unitPrice).toBe(0.3);
    expect(r.items.create[0].total).toBe(2.68);
    expect(r.items.create[0].quantity).toBe(0.3333);
    expect(r.paidAmount.increment).toBe(1);
  });
  it('preserva datas e buffers', () => {
    const d = new Date();
    const r = roundMoney({ dueDate: d, certPfx: Buffer.from('x') });
    expect(r.dueDate).toBe(d);
    expect(Buffer.isBuffer(r.certPfx)).toBe(true);
  });
});
