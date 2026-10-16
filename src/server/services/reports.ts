/**
 * Relatórios e indicadores: dashboard, curva ABC, DRE, fluxo de caixa,
 * inadimplência, lucratividade por produto/canal e relatórios exportáveis.
 * Todas as consultas respeitam a empresa ativa ou a visão consolidada.
 */
import { prisma } from '@/lib/db';
import { round2, startOfMonth, endOfMonth, addDays, startOfDay } from '@/lib/utils';
import { getAvailability } from './stock';
import { effectiveStatus, bankBalance } from './finance';
import type { Ctx } from '../context';

type Scope = Pick<Ctx, 'companyId' | 'companyIds' | 'consolidated' | 'orgId' | 'stockMode'>;
const cids = (c: Scope) => (c.consolidated ? c.companyIds : [c.companyId]);
const VALID_STATUS = { notIn: ['CANCELADO'] };
const SOLD_STATUS = { in: ['FATURADO', 'SEPARADO', 'ENVIADO', 'ENTREGUE'] };

export async function dashboard(ctx: Scope) {
  const companyId = { in: cids(ctx) };
  const today = startOfDay();
  const monthStart = startOfMonth();
  const prevMonthStart = startOfMonth(addDays(monthStart, -1));
  const [todaySales, monthSales, prevMonthSales, openOrders, toInvoice, toShip] = await Promise.all([
    prisma.salesOrder.aggregate({ where: { companyId, status: VALID_STATUS, date: { gte: today } }, _sum: { total: true }, _count: true }),
    prisma.salesOrder.aggregate({ where: { companyId, status: VALID_STATUS, date: { gte: monthStart } }, _sum: { total: true, totalCost: true, channelFee: true }, _count: true }),
    prisma.salesOrder.aggregate({ where: { companyId, status: VALID_STATUS, date: { gte: prevMonthStart, lt: monthStart } }, _sum: { total: true }, _count: true }),
    prisma.salesOrder.count({ where: { companyId, status: 'ABERTO' } }),
    prisma.salesOrder.aggregate({ where: { companyId, status: 'ABERTO' }, _sum: { total: true } }),
    prisma.salesOrder.count({ where: { companyId, status: { in: ['FATURADO', 'SEPARADO'] } } }),
  ]);
  const openEntries = await prisma.financialEntry.findMany({ where: { companyId, status: { in: ['ABERTO', 'PARCIAL'] } }, select: { type: true, amount: true, paidAmount: true, dueDate: true } });
  const sumBy = (fn: (e: (typeof openEntries)[number]) => boolean) => round2(openEntries.filter(fn).reduce((a, e) => a + e.amount - e.paidAmount, 0));
  const tomorrow = addDays(today, 1);
  const banks = await prisma.bankAccount.findMany({ where: { companyId, active: true } });
  const balances = await Promise.all(banks.map(async (b) => ({ id: b.id, name: b.name, type: b.type, balance: await bankBalance(prisma, b.id) })));

  // Vendas dos últimos 30 dias por dia
  const since = addDays(today, -29);
  const orders = await prisma.salesOrder.findMany({ where: { companyId, status: VALID_STATUS, date: { gte: since } }, select: { date: true, total: true, channelId: true, origin: true } });
  const days: { date: string; total: number; count: number }[] = [];
  for (let i = 0; i < 30; i++) days.push({ date: addDays(since, i).toISOString().slice(0, 10), total: 0, count: 0 });
  for (const o of orders) {
    const key = new Date(o.date.getTime() - o.date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const d = days.find((x) => x.date === key);
    if (d) {
      d.total = round2(d.total + o.total);
      d.count++;
    }
  }
  const byChannel = await salesByChannel(ctx, since, new Date());
  const topProducts = (await abcCurve(ctx, 30, 'value')).rows.slice(0, 8);
  const low = await prisma.product.findMany({ where: { organizationId: ctx.orgId, minStock: { gt: 0 }, controlsStock: true, active: true, kind: { notIn: ['KIT', 'VARIACAO_PAI'] } }, select: { id: true, sku: true, name: true, minStock: true } });
  const avail = await getAvailability(prisma, { orgId: ctx.orgId, companyId: ctx.companyId, stockMode: ctx.stockMode }, low.map((l) => l.id));
  const lowStock = low.map((l) => ({ ...l, available: avail.get(l.id)?.available ?? 0 })).filter((l) => l.available < l.minStock).sort((a, b) => a.available - b.available);
  const monthTotal = monthSales._sum.total || 0;
  const recentOrders = await prisma.salesOrder.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 8, include: { customer: { select: { name: true } } } });
  const channels = await prisma.salesChannel.findMany({ where: { companyId } });
  return {
    kpis: {
      salesToday: round2(todaySales._sum.total || 0),
      ordersToday: todaySales._count,
      salesMonth: round2(monthTotal),
      ordersMonth: monthSales._count,
      prevMonth: round2(prevMonthSales._sum.total || 0),
      avgTicket: monthSales._count ? round2(monthTotal / monthSales._count) : 0,
      grossMargin: monthTotal ? round2(((monthTotal - (monthSales._sum.totalCost || 0) - (monthSales._sum.channelFee || 0)) / monthTotal) * 100) : 0,
      openOrders,
      openOrdersValue: round2(toInvoice._sum.total || 0),
      toShip,
      receivableToday: sumBy((e) => e.type === 'RECEBER' && e.dueDate >= today && e.dueDate < tomorrow),
      payableToday: sumBy((e) => e.type === 'PAGAR' && e.dueDate >= today && e.dueDate < tomorrow),
      receivableOverdue: sumBy((e) => e.type === 'RECEBER' && e.dueDate < today),
      payableOverdue: sumBy((e) => e.type === 'PAGAR' && e.dueDate < today),
      receivableMonth: sumBy((e) => e.type === 'RECEBER' && e.dueDate <= endOfMonth()),
      payableMonth: sumBy((e) => e.type === 'PAGAR' && e.dueDate <= endOfMonth()),
      cashBalance: round2(balances.reduce((a, b) => a + b.balance, 0)),
      lowStockCount: lowStock.length,
    },
    salesByDay: days,
    byChannel: byChannel.map((c) => ({ ...c, name: c.channel })),
    topProducts,
    lowStock: lowStock.slice(0, 8),
    balances,
    recentOrders: recentOrders.map((o) => ({ id: o.id, number: o.number, customer: o.customer.name, total: o.total, status: o.status, date: o.date, origin: o.origin, channel: channels.find((c) => c.id === o.channelId)?.name })),
  };
}

export async function salesByChannel(ctx: Scope, from: Date, to: Date) {
  const orders = await prisma.salesOrder.findMany({ where: { companyId: { in: cids(ctx) }, status: VALID_STATUS, date: { gte: from, lte: to } }, select: { total: true, totalCost: true, channelFee: true, freight: true, channelId: true, origin: true } });
  const channels = await prisma.salesChannel.findMany({ where: { companyId: { in: cids(ctx) } } });
  const label = (o: (typeof orders)[number]) => (o.channelId ? channels.find((c) => c.id === o.channelId)?.name || 'Canal' : o.origin === 'PDV' ? 'PDV / Loja física' : o.origin === 'LOJA' ? 'Loja virtual' : 'Venda direta');
  const map = new Map<string, { channel: string; orders: number; revenue: number; cost: number; fees: number; profit: number; margin: number }>();
  for (const o of orders) {
    const k = label(o);
    const m = map.get(k) || { channel: k, orders: 0, revenue: 0, cost: 0, fees: 0, profit: 0, margin: 0 };
    m.orders++;
    m.revenue = round2(m.revenue + o.total);
    m.cost = round2(m.cost + o.totalCost);
    m.fees = round2(m.fees + o.channelFee);
    map.set(k, m);
  }
  return [...map.values()].map((m) => ({ ...m, profit: round2(m.revenue - m.cost - m.fees), margin: m.revenue ? round2(((m.revenue - m.cost - m.fees) / m.revenue) * 100) : 0 })).sort((a, b) => b.revenue - a.revenue);
}

/** Curva ABC de produtos por faturamento (ou quantidade) no período */
export async function abcCurve(ctx: Scope, days = 90, by: 'value' | 'quantity' = 'value') {
  const items = await prisma.salesOrderItem.findMany({
    where: { productId: { not: null }, salesOrder: { companyId: { in: cids(ctx) }, status: VALID_STATUS, date: { gte: addDays(new Date(), -days) } } },
    select: { productId: true, quantity: true, total: true, unitCost: true, sku: true, description: true },
  });
  const map = new Map<string, { productId: string; sku: string; name: string; quantity: number; revenue: number; cost: number }>();
  for (const it of items) {
    const m = map.get(it.productId!) || { productId: it.productId!, sku: it.sku || '', name: it.description, quantity: 0, revenue: 0, cost: 0 };
    m.quantity += it.quantity;
    m.revenue = round2(m.revenue + it.total);
    m.cost = round2(m.cost + it.unitCost * it.quantity);
    map.set(it.productId!, m);
  }
  const list = [...map.values()].sort((a, b) => (by === 'value' ? b.revenue - a.revenue : b.quantity - a.quantity));
  const total = list.reduce((a, r) => a + (by === 'value' ? r.revenue : r.quantity), 0);
  let acc = 0;
  const rows = list.map((r) => {
    const v = by === 'value' ? r.revenue : r.quantity;
    acc += v;
    const cumulative = total ? (acc / total) * 100 : 0;
    return { ...r, share: total ? round2((v / total) * 100) : 0, cumulative: round2(cumulative), profit: round2(r.revenue - r.cost), margin: r.revenue ? round2(((r.revenue - r.cost) / r.revenue) * 100) : 0, class: cumulative <= 80 ? 'A' : cumulative <= 95 ? 'B' : 'C' };
  });
  const summary = ['A', 'B', 'C'].map((c) => ({ class: c, products: rows.filter((r) => r.class === c).length, revenue: round2(rows.filter((r) => r.class === c).reduce((a, r) => a + r.revenue, 0)) }));
  return { rows, summary, total: round2(total), days, by };
}

/**
 * DRE gerencial (regime de competência):
 * Receita bruta (vendas) − deduções (impostos das notas) − CMV (custo dos itens)
 * − despesas por grupo do plano de contas (lançamentos a pagar por competência).
 */
export async function dre(ctx: Scope, from: Date, to: Date, regime: 'COMPETENCIA' | 'CAIXA' = 'COMPETENCIA') {
  const companyId = { in: cids(ctx) };
  const charts = await prisma.chartAccount.findMany({ where: { companyId } });
  const group = (id: string | null) => charts.find((c) => c.id === id)?.dreGroup || 'OUTRAS';
  let grossRevenue = 0, taxes = 0, simplesTax = 0, returns = 0, cmv = 0, finRev = 0, otherRev = 0;
  let sumGroup: (g: string) => number;
  if (regime === 'CAIXA') {
    // Regime de caixa: o que efetivamente entrou/saiu (baixas) no período, pelo plano de contas
    const paid = await prisma.financialEntry.findMany({ where: { companyId, paidAmount: { gt: 0 }, status: { not: 'CANCELADO' }, paymentDate: { gte: from, lte: to } }, select: { type: true, paidAmount: true, chartAccountId: true, origin: true } });
    const by = (type: string, g: string) => round2(paid.filter((p) => p.type === type && group(p.chartAccountId) === g).reduce((a, p) => a + p.paidAmount, 0));
    grossRevenue = round2(by('RECEBER', 'RECEITA_BRUTA') + paid.filter((p) => p.type === 'RECEBER' && !p.chartAccountId).reduce((a, p) => a + p.paidAmount, 0));
    finRev = by('RECEBER', 'RECEITA_FINANCEIRA');
    otherRev = by('RECEBER', 'OUTRAS');
    sumGroup = (g: string) => by('PAGAR', g);
    simplesTax = round2(paid.filter((p) => p.type === 'PAGAR' && group(p.chartAccountId) === 'DEDUCOES' && p.origin !== 'DEVOLUCAO').reduce((a, p) => a + p.paidAmount, 0));
    returns = round2(paid.filter((p) => p.type === 'PAGAR' && p.origin === 'DEVOLUCAO').reduce((a, p) => a + p.paidAmount, 0));
    cmv = sumGroup('CMV');
  } else {
    const orders = await prisma.salesOrder.aggregate({ where: { companyId, status: SOLD_STATUS, date: { gte: from, lte: to } }, _sum: { total: true, totalCost: true } });
    const os = await prisma.serviceOrder.aggregate({ where: { companyId, status: 'FATURADA', finishedAt: { gte: from, lte: to } }, _sum: { total: true } });
    const invoices = await prisma.invoice.aggregate({ where: { companyId, status: 'AUTORIZADA', direction: 'SAIDA', issueDate: { gte: from, lte: to } }, _sum: { icmsValue: true, pisValue: true, cofinsValue: true, issValue: true, ipiValue: true } });
    const payables = await prisma.financialEntry.findMany({ where: { companyId, type: 'PAGAR', status: { not: 'CANCELADO' }, competenceDate: { gte: from, lte: to } }, select: { amount: true, chartAccountId: true, origin: true } });
    const receivablesOther = await prisma.financialEntry.findMany({ where: { companyId, type: 'RECEBER', status: { not: 'CANCELADO' }, origin: 'MANUAL', competenceDate: { gte: from, lte: to } }, select: { amount: true, chartAccountId: true } });
    const rets = await prisma.salesReturn.findMany({ where: { companyId, status: 'CONCLUIDA', createdAt: { gte: from, lte: to } } });
    sumGroup = (g: string) => round2(payables.filter((p) => group(p.chartAccountId) === g && !['COMPRA', 'NFE_ENTRADA', 'DEVOLUCAO'].includes(p.origin)).reduce((a, p) => a + p.amount, 0));
    grossRevenue = round2((orders._sum.total || 0) + (os._sum.total || 0));
    taxes = round2((invoices._sum.icmsValue || 0) + (invoices._sum.pisValue || 0) + (invoices._sum.cofinsValue || 0) + (invoices._sum.issValue || 0) + (invoices._sum.ipiValue || 0));
    simplesTax = sumGroup('DEDUCOES');
    returns = round2(rets.reduce((a, r) => a + r.total, 0));
    // CMV das devoluções que voltaram ao estoque é estornado
    const retCost = rets.reduce((a, r) => a + (r.items as { quantity: number; unitPrice: number }[]).reduce((x, i) => x + i.quantity * i.unitPrice, 0), 0);
    const marginRatio = (orders._sum.total || 0) ? (orders._sum.totalCost || 0) / (orders._sum.total || 1) : 0;
    cmv = round2((orders._sum.totalCost || 0) - retCost * marginRatio);
    finRev = round2(receivablesOther.filter((r) => group(r.chartAccountId) === 'RECEITA_FINANCEIRA').reduce((a, r) => a + r.amount, 0));
    otherRev = round2(receivablesOther.filter((r) => group(r.chartAccountId) === 'OUTRAS').reduce((a, r) => a + r.amount, 0));
  }
  const deductions = round2(taxes + simplesTax + returns);
  const netRevenue = round2(grossRevenue - deductions);
  const grossProfit = round2(netRevenue - cmv);
  const opex = { operacionais: sumGroup('DESPESA_OPERACIONAL'), administrativas: sumGroup('DESPESA_ADMINISTRATIVA'), pessoal: sumGroup('DESPESA_PESSOAL') };
  const totalOpex = round2(opex.operacionais + opex.administrativas + opex.pessoal);
  const ebitda = round2(grossProfit - totalOpex);
  const finExp = sumGroup('DESPESA_FINANCEIRA');
  const other = round2(otherRev - sumGroup('OUTRAS'));
  const netProfit = round2(ebitda - finExp + finRev + other);
  const pct = (v: number) => (grossRevenue ? round2((v / grossRevenue) * 100) : 0);
  const lines = [
    { label: 'Receita operacional bruta', value: grossRevenue, level: 0, bold: true },
    ...(regime === 'COMPETENCIA' ? [{ label: '(-) Impostos destacados em notas (ICMS, IPI, PIS, COFINS, ISS)', value: -taxes, level: 1 }] : []),
    { label: '(-) Impostos sobre vendas (DAS / guias)', value: -simplesTax, level: 1 },
    { label: '(-) Devoluções de vendas', value: -returns, level: 1 },
    { label: '(=) Receita operacional líquida', value: netRevenue, level: 0, bold: true },
    { label: regime === 'CAIXA' ? '(-) Compras pagas (mercadorias / matéria-prima)' : '(-) Custo das mercadorias vendidas (CMV)', value: -cmv, level: 1 },
    { label: '(=) Lucro bruto', value: grossProfit, level: 0, bold: true },
    { label: '(-) Despesas operacionais (marketplaces, fretes, marketing)', value: -opex.operacionais, level: 1 },
    { label: '(-) Despesas administrativas', value: -opex.administrativas, level: 1 },
    { label: '(-) Despesas com pessoal', value: -opex.pessoal, level: 1 },
    { label: '(=) EBITDA / Resultado operacional', value: ebitda, level: 0, bold: true },
    { label: '(+) Receitas financeiras', value: finRev, level: 1 },
    { label: '(-) Despesas financeiras', value: -finExp, level: 1 },
    { label: '(+/-) Outras receitas e despesas', value: other, level: 1 },
    { label: '(=) Lucro líquido do período', value: netProfit, level: 0, bold: true },
  ].map((l) => ({ ...l, percent: pct(l.value) }));
  return { from, to, regime, lines, netProfit, grossRevenue, netMargin: pct(netProfit) };
}

/** Fluxo de caixa: realizado (movimentos bancários) e previsto (contas em aberto) */
export async function cashFlow(ctx: Scope, from: Date, to: Date, granularity: 'day' | 'month' = 'day') {
  const companyId = { in: cids(ctx) };
  const banks = await prisma.bankAccount.findMany({ where: { companyId, active: true } });
  const initial = round2(banks.reduce((a, b) => a + b.initialBalance, 0));
  const before = await prisma.bankTransaction.aggregate({ where: { companyId, date: { lt: from } }, _sum: { amount: true } });
  const txs = await prisma.bankTransaction.findMany({ where: { companyId, date: { gte: from, lte: to } }, select: { date: true, amount: true } });
  const open = await prisma.financialEntry.findMany({ where: { companyId, status: { in: ['ABERTO', 'PARCIAL'] }, dueDate: { lte: to } }, select: { type: true, amount: true, paidAmount: true, dueDate: true } });
  const keyOf = (d: Date) => (granularity === 'month' ? d.toISOString().slice(0, 7) : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10));
  const buckets = new Map<string, { period: string; realizedIn: number; realizedOut: number; expectedIn: number; expectedOut: number }>();
  const ensure = (k: string) => buckets.get(k) || buckets.set(k, { period: k, realizedIn: 0, realizedOut: 0, expectedIn: 0, expectedOut: 0 }).get(k)!;
  for (let d = new Date(from); d <= to; d = granularity === 'month' ? new Date(d.getFullYear(), d.getMonth() + 1, 1) : addDays(d, 1)) ensure(keyOf(d));
  for (const t of txs) {
    const b = ensure(keyOf(t.date));
    if (t.amount >= 0) b.realizedIn = round2(b.realizedIn + t.amount);
    else b.realizedOut = round2(b.realizedOut - t.amount);
  }
  const today = startOfDay();
  for (const e of open) {
    // Vencidos entram como previstos para hoje
    const d = e.dueDate < today ? today : e.dueDate;
    if (d < from) continue;
    const b = ensure(keyOf(d));
    const v = round2(e.amount - e.paidAmount);
    if (e.type === 'RECEBER') b.expectedIn = round2(b.expectedIn + v);
    else b.expectedOut = round2(b.expectedOut + v);
  }
  let balance = round2(initial + (before._sum.amount || 0));
  const opening = balance;
  const rows = [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period)).map((b) => {
    balance = round2(balance + b.realizedIn - b.realizedOut + b.expectedIn - b.expectedOut);
    return { ...b, net: round2(b.realizedIn - b.realizedOut + b.expectedIn - b.expectedOut), balance };
  });
  return { opening, closing: balance, rows };
}

/** Inadimplência: recebíveis vencidos agrupados por cliente e faixa de atraso */
export async function delinquency(ctx: Scope) {
  const today = startOfDay();
  const list = await prisma.financialEntry.findMany({ where: { companyId: { in: cids(ctx) }, type: 'RECEBER', status: { in: ['ABERTO', 'PARCIAL'] }, dueDate: { lt: today } }, orderBy: { dueDate: 'asc' } });
  const rows = list.map((e) => {
    const days = Math.floor((today.getTime() - e.dueDate.getTime()) / 86400000);
    return { id: e.id, customer: e.contactName || '—', description: e.description, dueDate: e.dueDate, daysLate: days, open: round2(e.amount - e.paidAmount), range: days <= 15 ? '1-15 dias' : days <= 30 ? '16-30 dias' : days <= 60 ? '31-60 dias' : '60+ dias', status: effectiveStatus(e) };
  });
  const totalOpen = await prisma.financialEntry.aggregate({ where: { companyId: { in: cids(ctx) }, type: 'RECEBER', status: { in: ['ABERTO', 'PARCIAL'] } }, _sum: { amount: true, paidAmount: true } });
  const overdue = round2(rows.reduce((a, r) => a + r.open, 0));
  const all = round2((totalOpen._sum.amount || 0) - (totalOpen._sum.paidAmount || 0));
  const ranges = ['1-15 dias', '16-30 dias', '31-60 dias', '60+ dias'].map((r) => ({ range: r, count: rows.filter((x) => x.range === r).length, amount: round2(rows.filter((x) => x.range === r).reduce((a, x) => a + x.open, 0)) }));
  const byCustomer = [...rows.reduce((m, r) => m.set(r.customer, round2((m.get(r.customer) || 0) + r.open)), new Map<string, number>())].map(([customer, amount]) => ({ customer, amount })).sort((a, b) => b.amount - a.amount);
  return { rows, overdue, totalOpen: all, rate: all ? round2((overdue / all) * 100) : 0, ranges, byCustomer };
}

// ---------------------------------------------------------------------------
// Relatórios exportáveis (tabela genérica → JSON / XLSX / PDF)
// ---------------------------------------------------------------------------
export type ReportColumn = { key: string; label: string; align?: 'right'; type?: 'money' | 'number' | 'date' | 'percent' };
export type ReportResult = { title: string; subtitle?: string; columns: ReportColumn[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown> };

export const REPORTS: Record<string, { title: string; group: string; description: string; run: (ctx: Scope, from: Date, to: Date) => Promise<ReportResult> }> = {
  'vendas-periodo': {
    title: 'Vendas por período', group: 'Vendas', description: 'Pedidos de venda com cliente, canal, status e totais',
    run: async (ctx, from, to) => {
      const orders = await prisma.salesOrder.findMany({ where: { companyId: { in: cids(ctx) }, date: { gte: from, lte: to } }, include: { customer: { select: { name: true } } }, orderBy: { date: 'asc' } });
      const channels = await prisma.salesChannel.findMany({ where: { companyId: { in: cids(ctx) } } });
      const rows = orders.map((o) => ({ number: o.number, date: o.date, customer: o.customer.name, channel: channels.find((c) => c.id === o.channelId)?.name || o.origin, status: o.status, subtotal: o.subtotal, discount: o.discount, freight: o.freight, total: o.total }));
      const valid = rows.filter((r) => r.status !== 'CANCELADO');
      return { title: 'Vendas por período', columns: [{ key: 'number', label: 'Pedido' }, { key: 'date', label: 'Data', type: 'date' }, { key: 'customer', label: 'Cliente' }, { key: 'channel', label: 'Canal' }, { key: 'status', label: 'Situação' }, { key: 'subtotal', label: 'Subtotal', align: 'right', type: 'money' }, { key: 'discount', label: 'Desconto', align: 'right', type: 'money' }, { key: 'freight', label: 'Frete', align: 'right', type: 'money' }, { key: 'total', label: 'Total', align: 'right', type: 'money' }], rows, totals: { customer: `${valid.length} pedidos válidos`, total: round2(valid.reduce((a, r) => a + r.total, 0)) } };
    },
  },
  'vendas-produto': {
    title: 'Vendas e lucratividade por produto', group: 'Vendas', description: 'Quantidade, faturamento, custo, lucro e margem por produto',
    run: async (ctx, from, to) => {
      const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000));
      const abc = await abcCurve(ctx, days);
      return { title: 'Lucratividade por produto', columns: [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Produto' }, { key: 'quantity', label: 'Qtd', align: 'right', type: 'number' }, { key: 'revenue', label: 'Faturamento', align: 'right', type: 'money' }, { key: 'cost', label: 'Custo', align: 'right', type: 'money' }, { key: 'profit', label: 'Lucro', align: 'right', type: 'money' }, { key: 'margin', label: 'Margem %', align: 'right', type: 'percent' }, { key: 'class', label: 'ABC' }], rows: abc.rows, totals: { revenue: abc.total, profit: round2(abc.rows.reduce((a, r) => a + r.profit, 0)) } };
    },
  },
  'vendas-canal': {
    title: 'Lucratividade por canal de venda', group: 'Vendas', description: 'Faturamento, custo, tarifas e margem por canal',
    run: async (ctx, from, to) => {
      const rows = await salesByChannel(ctx, from, to);
      return { title: 'Lucratividade por canal', columns: [{ key: 'channel', label: 'Canal' }, { key: 'orders', label: 'Pedidos', align: 'right', type: 'number' }, { key: 'revenue', label: 'Faturamento', align: 'right', type: 'money' }, { key: 'cost', label: 'CMV', align: 'right', type: 'money' }, { key: 'fees', label: 'Tarifas', align: 'right', type: 'money' }, { key: 'profit', label: 'Lucro bruto', align: 'right', type: 'money' }, { key: 'margin', label: 'Margem %', align: 'right', type: 'percent' }], rows, totals: { revenue: round2(rows.reduce((a, r) => a + r.revenue, 0)), profit: round2(rows.reduce((a, r) => a + r.profit, 0)) } };
    },
  },
  'vendas-cliente': {
    title: 'Vendas por cliente', group: 'Vendas', description: 'Ranking de clientes por faturamento',
    run: async (ctx, from, to) => {
      const g = await prisma.salesOrder.groupBy({ by: ['customerId'], where: { companyId: { in: cids(ctx) }, status: VALID_STATUS, date: { gte: from, lte: to } }, _sum: { total: true }, _count: true });
      const cs = await prisma.contact.findMany({ where: { id: { in: g.map((x) => x.customerId) } }, select: { id: true, name: true, city: true, uf: true } });
      const rows = g.map((x) => { const c = cs.find((y) => y.id === x.customerId); return { customer: c?.name, city: `${c?.city || ''}/${c?.uf || ''}`, orders: x._count, total: round2(x._sum.total || 0), ticket: round2((x._sum.total || 0) / x._count) }; }).sort((a, b) => b.total - a.total);
      return { title: 'Vendas por cliente', columns: [{ key: 'customer', label: 'Cliente' }, { key: 'city', label: 'Cidade/UF' }, { key: 'orders', label: 'Pedidos', align: 'right', type: 'number' }, { key: 'total', label: 'Total', align: 'right', type: 'money' }, { key: 'ticket', label: 'Ticket médio', align: 'right', type: 'money' }], rows };
    },
  },
  'vendas-vendedor': {
    title: 'Vendas e comissões por vendedor', group: 'Vendas', description: 'Faturamento e comissões por vendedor',
    run: async (ctx, from, to) => {
      const g = await prisma.salesOrder.groupBy({ by: ['sellerId'], where: { companyId: { in: cids(ctx) }, status: VALID_STATUS, date: { gte: from, lte: to } }, _sum: { total: true }, _count: true });
      const sellers = await prisma.seller.findMany({ where: { organizationId: ctx.orgId } });
      const com = await prisma.commission.groupBy({ by: ['sellerId'], where: { companyId: { in: cids(ctx) }, status: { not: 'CANCELADA' }, createdAt: { gte: from, lte: to } }, _sum: { amount: true } });
      const rows = g.map((x) => ({ seller: sellers.find((s) => s.id === x.sellerId)?.name || 'Sem vendedor', orders: x._count, total: round2(x._sum.total || 0), commission: round2(com.find((c) => c.sellerId === x.sellerId)?._sum.amount || 0) })).sort((a, b) => b.total - a.total);
      return { title: 'Vendas por vendedor', columns: [{ key: 'seller', label: 'Vendedor' }, { key: 'orders', label: 'Pedidos', align: 'right', type: 'number' }, { key: 'total', label: 'Faturamento', align: 'right', type: 'money' }, { key: 'commission', label: 'Comissões', align: 'right', type: 'money' }], rows };
    },
  },
  'estoque-posicao': {
    title: 'Posição de estoque', group: 'Estoque', description: 'Saldo físico, reservado, disponível e valor em estoque',
    run: async (ctx) => {
      const products = await prisma.product.findMany({ where: { organizationId: ctx.orgId, controlsStock: true, kind: { notIn: ['VARIACAO_PAI', 'KIT'] } }, include: { balances: { where: { warehouse: { companyId: { in: cids(ctx) } } } } }, orderBy: { name: 'asc' } });
      const rows = products.map((p) => { const q = p.balances.reduce((a, b) => a + b.quantity, 0); const r = p.balances.reduce((a, b) => a + b.reserved, 0); return { sku: p.sku, name: p.name, unit: p.unit, quantity: q, reserved: r, available: q - r, minStock: p.minStock, cost: p.costPrice, value: round2(q * p.costPrice) }; });
      return { title: 'Posição de estoque', columns: [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Produto' }, { key: 'unit', label: 'UN' }, { key: 'quantity', label: 'Físico', align: 'right', type: 'number' }, { key: 'reserved', label: 'Reservado', align: 'right', type: 'number' }, { key: 'available', label: 'Disponível', align: 'right', type: 'number' }, { key: 'minStock', label: 'Mínimo', align: 'right', type: 'number' }, { key: 'cost', label: 'Custo', align: 'right', type: 'money' }, { key: 'value', label: 'Valor', align: 'right', type: 'money' }], rows, totals: { value: round2(rows.reduce((a, r) => a + r.value, 0)) } };
    },
  },
  'estoque-movimentacao': {
    title: 'Movimentação de estoque', group: 'Estoque', description: 'Entradas, saídas, ajustes e transferências no período',
    run: async (ctx, from, to) => {
      const movs = await prisma.stockMovement.findMany({ where: { companyId: { in: cids(ctx) }, createdAt: { gte: from, lte: to } }, orderBy: { createdAt: 'asc' }, take: 5000 });
      const ps = await prisma.product.findMany({ where: { id: { in: [...new Set(movs.map((m) => m.productId))] } }, select: { id: true, sku: true, name: true } });
      const rows = movs.map((m) => ({ date: m.createdAt, sku: ps.find((p) => p.id === m.productId)?.sku, name: ps.find((p) => p.id === m.productId)?.name, type: m.type, origin: m.originLabel || m.origin, lot: m.lotNumber || '', quantity: m.quantity, balance: m.balanceAfter }));
      return { title: 'Movimentação de estoque', columns: [{ key: 'date', label: 'Data', type: 'date' }, { key: 'sku', label: 'SKU' }, { key: 'name', label: 'Produto' }, { key: 'type', label: 'Tipo' }, { key: 'origin', label: 'Origem' }, { key: 'lot', label: 'Lote' }, { key: 'quantity', label: 'Qtd', align: 'right', type: 'number' }, { key: 'balance', label: 'Saldo', align: 'right', type: 'number' }], rows };
    },
  },
  'estoque-ruptura': {
    title: 'Ruptura e estoque mínimo', group: 'Estoque', description: 'Produtos sem estoque ou abaixo do mínimo, com sugestão de compra',
    run: async (ctx) => {
      const ps = await prisma.product.findMany({ where: { organizationId: ctx.orgId, controlsStock: true, active: true, kind: { notIn: ['VARIACAO_PAI', 'KIT'] } } });
      const av = await getAvailability(prisma, { orgId: ctx.orgId, companyId: ctx.companyId, stockMode: ctx.stockMode }, ps.map((p) => p.id));
      const rows = ps.map((p) => ({ sku: p.sku, name: p.name, available: av.get(p.id)?.available ?? 0, minStock: p.minStock, maxStock: p.maxStock })).filter((r) => r.available <= 0 || r.available < r.minStock).map((r) => ({ ...r, situation: r.available <= 0 ? 'RUPTURA' : 'ABAIXO DO MÍNIMO', suggestion: Math.max((r.maxStock || r.minStock * 3) - r.available, 0) }));
      return { title: 'Ruptura de estoque', columns: [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Produto' }, { key: 'situation', label: 'Situação' }, { key: 'available', label: 'Disponível', align: 'right', type: 'number' }, { key: 'minStock', label: 'Mínimo', align: 'right', type: 'number' }, { key: 'suggestion', label: 'Sugestão compra', align: 'right', type: 'number' }], rows };
    },
  },
  'estoque-abc': {
    title: 'Curva ABC de produtos', group: 'Estoque', description: 'Classificação A/B/C pelo faturamento acumulado',
    run: async (ctx, from, to) => {
      const abc = await abcCurve(ctx, Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000)));
      return { title: 'Curva ABC', columns: [{ key: 'class', label: 'Classe' }, { key: 'sku', label: 'SKU' }, { key: 'name', label: 'Produto' }, { key: 'quantity', label: 'Qtd', align: 'right', type: 'number' }, { key: 'revenue', label: 'Faturamento', align: 'right', type: 'money' }, { key: 'share', label: '% part.', align: 'right', type: 'percent' }, { key: 'cumulative', label: '% acum.', align: 'right', type: 'percent' }], rows: abc.rows };
    },
  },
  'financeiro-receber': {
    title: 'Contas a receber', group: 'Financeiro', description: 'Títulos a receber no período (vencimento)',
    run: async (ctx, from, to) => finReport(ctx, 'RECEBER', from, to),
  },
  'financeiro-pagar': {
    title: 'Contas a pagar', group: 'Financeiro', description: 'Títulos a pagar no período (vencimento)',
    run: async (ctx, from, to) => finReport(ctx, 'PAGAR', from, to),
  },
  'financeiro-inadimplencia': {
    title: 'Inadimplência', group: 'Financeiro', description: 'Recebíveis vencidos por cliente e faixa de atraso',
    run: async (ctx) => {
      const d = await delinquency(ctx);
      return { title: 'Inadimplência', subtitle: `Taxa de inadimplência: ${d.rate}%`, columns: [{ key: 'customer', label: 'Cliente' }, { key: 'description', label: 'Título' }, { key: 'dueDate', label: 'Vencimento', type: 'date' }, { key: 'daysLate', label: 'Dias atraso', align: 'right', type: 'number' }, { key: 'range', label: 'Faixa' }, { key: 'open', label: 'Em aberto', align: 'right', type: 'money' }], rows: d.rows, totals: { open: d.overdue } };
    },
  },
  'financeiro-dre': {
    title: 'DRE gerencial', group: 'Financeiro', description: 'Demonstração do resultado do exercício',
    run: async (ctx, from, to) => {
      const d = await dre(ctx, from, to);
      return { title: 'DRE gerencial', columns: [{ key: 'label', label: 'Conta' }, { key: 'value', label: 'Valor', align: 'right', type: 'money' }, { key: 'percent', label: '% receita', align: 'right', type: 'percent' }], rows: d.lines };
    },
  },
  'financeiro-fluxo': {
    title: 'Fluxo de caixa', group: 'Financeiro', description: 'Realizado e previsto por dia',
    run: async (ctx, from, to) => {
      const f = await cashFlow(ctx, from, to);
      return { title: 'Fluxo de caixa', subtitle: `Saldo inicial ${f.opening.toFixed(2)} | Saldo final ${f.closing.toFixed(2)}`, columns: [{ key: 'period', label: 'Data' }, { key: 'realizedIn', label: 'Entradas realizadas', align: 'right', type: 'money' }, { key: 'realizedOut', label: 'Saídas realizadas', align: 'right', type: 'money' }, { key: 'expectedIn', label: 'A receber', align: 'right', type: 'money' }, { key: 'expectedOut', label: 'A pagar', align: 'right', type: 'money' }, { key: 'balance', label: 'Saldo', align: 'right', type: 'money' }], rows: f.rows };
    },
  },
  'fiscal-notas': {
    title: 'Notas fiscais emitidas', group: 'Fiscal', description: 'NF-e, NFC-e e NFS-e com impostos',
    run: async (ctx, from, to) => {
      const inv = await prisma.invoice.findMany({ where: { companyId: { in: cids(ctx) }, issueDate: { gte: from, lte: to } }, orderBy: { issueDate: 'asc' } });
      const rows = inv.map((i) => ({ model: i.model, number: i.number, date: i.issueDate, customer: i.customerName, status: i.status, total: i.total, icms: i.icmsValue, ipi: i.ipiValue, pis: i.pisValue, cofins: i.cofinsValue, iss: i.issValue }));
      const ok = rows.filter((r) => r.status === 'AUTORIZADA');
      return { title: 'Notas fiscais', columns: [{ key: 'model', label: 'Modelo' }, { key: 'number', label: 'Número' }, { key: 'date', label: 'Emissão', type: 'date' }, { key: 'customer', label: 'Destinatário' }, { key: 'status', label: 'Situação' }, { key: 'total', label: 'Total', align: 'right', type: 'money' }, { key: 'icms', label: 'ICMS', align: 'right', type: 'money' }, { key: 'ipi', label: 'IPI', align: 'right', type: 'money' }, { key: 'pis', label: 'PIS', align: 'right', type: 'money' }, { key: 'cofins', label: 'COFINS', align: 'right', type: 'money' }, { key: 'iss', label: 'ISS', align: 'right', type: 'money' }], rows, totals: { total: round2(ok.reduce((a, r) => a + r.total, 0)), icms: round2(ok.reduce((a, r) => a + r.icms, 0)) } };
    },
  },
};

async function finReport(ctx: Scope, type: 'RECEBER' | 'PAGAR', from: Date, to: Date): Promise<ReportResult> {
  const list = await prisma.financialEntry.findMany({ where: { companyId: { in: cids(ctx) }, type, dueDate: { gte: from, lte: to }, status: { not: 'CANCELADO' } }, orderBy: { dueDate: 'asc' } });
  const rows = list.map((e) => ({ dueDate: e.dueDate, description: e.description, contact: e.contactName || '', status: effectiveStatus(e), amount: e.amount, paid: e.paidAmount, open: round2(e.amount - e.paidAmount) }));
  return { title: type === 'RECEBER' ? 'Contas a receber' : 'Contas a pagar', columns: [{ key: 'dueDate', label: 'Vencimento', type: 'date' }, { key: 'description', label: 'Descrição' }, { key: 'contact', label: type === 'RECEBER' ? 'Cliente' : 'Fornecedor' }, { key: 'status', label: 'Situação' }, { key: 'amount', label: 'Valor', align: 'right', type: 'money' }, { key: 'paid', label: 'Pago', align: 'right', type: 'money' }, { key: 'open', label: 'Em aberto', align: 'right', type: 'money' }], rows, totals: { amount: round2(rows.reduce((a, r) => a + r.amount, 0)), open: round2(rows.reduce((a, r) => a + r.open, 0)) } };
}
