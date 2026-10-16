import { describe, it, expect, afterAll } from 'vitest';
import { billingDateIn, firstBillingDate, nextBillingAfter, periodOf, monthlyValue, lastAnniversary } from '@/server/services/contracts';

const d = (s: string) => new Date(`${s}T00:00:00`);
const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

describe('contratos: datas de cobrança', () => {
  it('limita o dia ao último dia do mês (31 → fevereiro/abril)', () => {
    expect(ymd(billingDateIn(2026, 1, 31))).toBe('2026-02-28');
    expect(ymd(billingDateIn(2028, 1, 31))).toBe('2028-02-29');
    expect(ymd(billingDateIn(2026, 3, 31))).toBe('2026-04-30');
    expect(ymd(billingDateIn(2026, 12, 10))).toBe('2027-01-10'); // mês 12 = janeiro do ano seguinte
  });

  it('mensal no dia 31 volta ao dia 31 depois de um mês curto', () => {
    const seq: string[] = [];
    let cur = d('2026-01-31');
    for (let i = 0; i < 4; i++) { seq.push(ymd(cur)); cur = nextBillingAfter(cur, 'MENSAL', 31); }
    expect(seq).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('avança conforme a periodicidade', () => {
    const base = d('2026-01-15');
    expect(ymd(nextBillingAfter(base, 'BIMESTRAL', 15))).toBe('2026-03-15');
    expect(ymd(nextBillingAfter(base, 'TRIMESTRAL', 15))).toBe('2026-04-15');
    expect(ymd(nextBillingAfter(base, 'SEMESTRAL', 15))).toBe('2026-07-15');
    expect(ymd(nextBillingAfter(base, 'ANUAL', 15))).toBe('2027-01-15');
    expect(ymd(nextBillingAfter(d('2026-11-30'), 'TRIMESTRAL', 30))).toBe('2027-02-28');
    expect(ymd(nextBillingAfter(d('2026-08-31'), 'SEMESTRAL', 31))).toBe('2027-02-28');
  });

  it('primeira cobrança: no mês do início se o dia ainda não passou, senão no mês seguinte', () => {
    expect(ymd(firstBillingDate(d('2026-03-05'), 10))).toBe('2026-03-10');
    expect(ymd(firstBillingDate(d('2026-03-10'), 10))).toBe('2026-03-10');
    expect(ymd(firstBillingDate(d('2026-03-20'), 10))).toBe('2026-04-10');
    expect(ymd(firstBillingDate(d('2026-01-31'), 31))).toBe('2026-01-31');
    expect(ymd(firstBillingDate(d('2026-02-01'), 31))).toBe('2026-02-28');
  });

  it('período AAAA-MM, MRR e aniversário para reajuste', () => {
    expect(periodOf(d('2026-02-28'))).toBe('2026-02');
    expect(monthlyValue(1200, 'ANUAL')).toBe(100);
    expect(monthlyValue(300, 'TRIMESTRAL')).toBe(100);
    expect(lastAnniversary(d('2025-06-10'), d('2026-06-09'))).toBeNull();
    expect(lastAnniversary(d('2025-06-10'), d('2026-06-10'))?.years).toBe(1);
    expect(ymd(lastAnniversary(d('2024-02-29'), d('2026-03-01'))!.date)).toBe('2026-02-28');
  });
});

describe.skipIf(process.env.RUN_DB_TESTS !== '1')('contratos: faturamento idempotente (banco)', async () => {
  const { prisma } = await import('@/lib/db');
  const { saveContract, billContract, billDueContracts, setContractStatus } = await import('@/server/services/contracts');
  const company = await prisma.company.findFirst({ where: { cnpj: '11444777000161' } });
  const actor = { companyId: company!.id, orgId: company!.organizationId, userName: 'Teste contratos' };
  const customer = await prisma.contact.findFirst({ where: { organizationId: actor.orgId, types: { has: 'CLIENTE' }, personType: 'PJ' } });
  const created: string[] = [];

  afterAll(async () => {
    await prisma.financialEntry.deleteMany({ where: { origin: 'CONTRATO', originId: { in: created } } });
    await prisma.contract.deleteMany({ where: { id: { in: created } } });
  });

  it('fatura o período uma única vez e avança a próxima cobrança', async () => {
    const start = new Date(); start.setMonth(start.getMonth() - 2); start.setDate(1);
    const c = await saveContract(actor, { customerId: customer!.id, description: 'Contrato de teste', interval: 'MENSAL', billingDay: 31, startDate: start, invoiceModel: 'NENHUMA', paymentMethod: 'PIX', items: [{ kind: 'SERVICO', description: 'Suporte mensal', quantity: 2, unitPrice: 150 }] });
    created.push(c.id);
    expect(c.amount).toBe(300);
    const period = periodOf(c.nextBillingDate);

    const a = await billContract(actor, c.id);
    expect(a.created).toBe(true);
    expect(a.billing.period).toBe(period);
    const b = await billContract(actor, c.id, period);
    expect(b.created).toBe(false);
    expect(b.billing.id).toBe(a.billing.id);

    expect(await prisma.contractBilling.count({ where: { contractId: c.id, period } })).toBe(1);
    expect(await prisma.financialEntry.count({ where: { origin: 'CONTRATO', originId: c.id } })).toBe(1);
    const after = await prisma.contract.findUnique({ where: { id: c.id } });
    expect(periodOf(after!.nextBillingDate) > period).toBe(true);

    // Rotina: recupera os períodos atrasados até hoje, sem duplicar o já faturado
    await billDueContracts(actor, { aheadDays: 0, contractIds: [c.id] });
    await billDueContracts(actor, { aheadDays: 0, contractIds: [c.id] });
    const periods = (await prisma.contractBilling.findMany({ where: { contractId: c.id } })).map((x) => x.period);
    expect(new Set(periods).size).toBe(periods.length);
    expect(await prisma.financialEntry.count({ where: { origin: 'CONTRATO', originId: c.id } })).toBe(periods.length);

    await setContractStatus(actor, c.id, 'suspend');
    await expect(billContract(actor, c.id)).rejects.toThrow(/suspenso/);
  });
});
