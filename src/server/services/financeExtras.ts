/**
 * Recursos financeiros complementares:
 * - CNAB 400 (remessa de boletos e processamento do arquivo de retorno)
 * - Renegociação de títulos vencidos
 * - Agenda de recebíveis de cartão (liquidação D+1/D+30 e antecipação)
 * - Rateio por centro de custo e orçamento previsto × realizado
 */
import { prisma } from '@/lib/db';
import { round2, onlyDigits, addDays, randomDigits } from '@/lib/utils';
import { fail } from '../errors';
import { nextNumber } from '../sequence';
import { createEntries, payEntry, billingData, defaultBankAccount } from './finance';
import type { Actor } from './sales';

// ---------------------------------------------------------------------------
// CNAB 400
// ---------------------------------------------------------------------------
function line() {
  const arr = Array<string>(400).fill(' ');
  const api = {
    set(pos: number, len: number, value: unknown, numeric = false) {
      let v = String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
      v = numeric ? v.replace(/\D/g, '').slice(-len).padStart(len, '0') : v.slice(0, len).padEnd(len, ' ');
      for (let i = 0; i < len; i++) arr[pos - 1 + i] = v[i];
      return api;
    },
    toString: () => arr.join(''),
  };
  return api;
}
const ddmmyy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getFullYear()).slice(2)}`;
const parseDdmmyy = (s: string) => new Date(2000 + Number(s.slice(4, 6)), Number(s.slice(2, 4)) - 1, Number(s.slice(0, 2)), 12);
const cents = (v: number) => Math.round(v * 100);

/** Gera o arquivo de remessa CNAB 400 com os boletos selecionados (ou todos os em aberto) */
export async function cnabRemessa(actor: Actor, entryIds?: string[]) {
  const company = (await prisma.company.findUnique({ where: { id: actor.companyId } }))!;
  const bank = await defaultBankAccount(prisma, actor.companyId, 'CONTA_DIGITAL');
  const entries = await prisma.financialEntry.findMany({
    where: { companyId: actor.companyId, type: 'RECEBER', status: { in: ['ABERTO', 'PARCIAL'] }, ...(entryIds?.length ? { id: { in: entryIds } } : { paymentMethod: 'BOLETO' }) },
    orderBy: { dueDate: 'asc' },
    take: 500,
  });
  if (!entries.length) fail(400, 'Nenhum boleto em aberto para enviar');
  const seq = await nextNumber(prisma, actor.companyId, 'CNAB_REMESSA', 1);
  const L: string[] = [];
  L.push(line().set(1, 1, '0').set(2, 1, '1').set(3, 7, 'REMESSA').set(10, 2, '01', true).set(12, 15, 'COBRANCA').set(27, 20, `${onlyDigits(bank?.agency)}${onlyDigits(bank?.accountNumber)}`, true).set(47, 30, company.name).set(77, 3, bank?.bankCode || '999', true).set(80, 15, (bank?.bankName || 'GESTAOPRO BANK').slice(0, 15)).set(95, 6, ddmmyy(new Date())).set(109, 2, 'MX').set(111, 7, seq, true).set(395, 6, 1, true).toString());
  for (const e of entries) {
    if (!e.boletoNumber) Object.assign(e, await prisma.financialEntry.update({ where: { id: e.id }, data: billingData(company, bank!, e.amount - e.paidAmount, e.dueDate) }));
    const c = e.contactId ? await prisma.contact.findUnique({ where: { id: e.contactId } }) : null;
    const doc = onlyDigits(c?.document);
    L.push(
      line().set(1, 1, '1').set(21, 17, `${onlyDigits(bank?.agency)}${onlyDigits(bank?.accountNumber)}`, true).set(38, 25, e.id).set(71, 12, e.boletoNumber, true).set(109, 2, '01', true).set(111, 10, e.documentNumber || e.boletoNumber?.slice(-10)).set(121, 6, ddmmyy(e.dueDate)).set(127, 13, cents(e.amount - e.paidAmount), true)
        .set(140, 3, bank?.bankCode || '999', true).set(148, 2, '01', true).set(150, 1, 'N').set(151, 6, ddmmyy(e.issueDate)).set(161, 13, cents((e.amount * 0.01) / 30), true)
        .set(219, 2, doc.length === 14 ? '02' : '01', true).set(221, 14, doc, true).set(235, 40, c?.name || e.contactName).set(275, 40, `${c?.street || ''} ${c?.number || ''}`).set(327, 8, c?.zip || '0', true).set(395, 6, L.length + 1, true).toString(),
    );
  }
  L.push(line().set(1, 1, '9').set(395, 6, L.length + 1, true).toString());
  return { filename: `CB${ddmmyy(new Date())}${String(seq).padStart(2, '0')}.REM`, content: L.join('\r\n') + '\r\n', count: entries.length };
}

/** Gera um arquivo de RETORNO de exemplo (liquidação de parte dos boletos de uma remessa) */
export function cnabRetornoSample(remessa: string) {
  const lines = remessa.split(/\r?\n/).filter((l) => l.startsWith('1'));
  const L: string[] = [line().set(1, 1, '0').set(2, 1, '2').set(3, 7, 'RETORNO').set(10, 2, '01', true).set(12, 15, 'COBRANCA').set(95, 6, ddmmyy(new Date())).set(395, 6, 1, true).toString()];
  lines.forEach((l, i) => {
    const liquidated = i % 3 !== 2;
    const value = Number(l.slice(126, 139)) / 100;
    L.push(line().set(1, 1, '1').set(38, 25, l.slice(37, 62)).set(71, 12, l.slice(70, 82), true).set(109, 2, liquidated ? '06' : '02', true).set(111, 6, ddmmyy(new Date())).set(153, 13, cents(value), true).set(254, 13, liquidated ? cents(value) : 0, true).set(296, 6, ddmmyy(new Date())).set(395, 6, L.length + 1, true).toString());
  });
  L.push(line().set(1, 1, '9').set(2, 1, '2').set(395, 6, L.length + 1, true).toString());
  return L.join('\r\n') + '\r\n';
}

const OCORRENCIAS: Record<string, string> = { '02': 'Entrada confirmada', '03': 'Entrada rejeitada', '06': 'Liquidação', '09': 'Baixado', '10': 'Baixado conforme instruções', '17': 'Liquidação após baixa' };

/** Processa o arquivo de retorno: liquidações baixam os títulos automaticamente */
export async function cnabRetorno(actor: Actor, content: string) {
  const lines = content.split(/\r?\n/).filter((l) => l.length >= 300);
  if (!lines.length || !lines[0].startsWith('02RETORNO')) fail(400, 'Arquivo de retorno CNAB 400 inválido');
  const bank = await defaultBankAccount(prisma, actor.companyId, 'CONTA_DIGITAL');
  const results = [];
  for (const l of lines.filter((x) => x.startsWith('1'))) {
    const control = l.slice(37, 62).trim();
    const ourNumber = l.slice(70, 82).replace(/^0+/, '');
    const code = l.slice(108, 110);
    const paid = Number(l.slice(253, 266)) / 100;
    const date = parseDdmmyy(l.slice(295, 301));
    const entry = await prisma.financialEntry.findFirst({ where: { companyId: actor.companyId, OR: [{ id: control }, { boletoNumber: { endsWith: ourNumber.slice(-11) } }] } });
    let message = OCORRENCIAS[code] || `Ocorrência ${code}`;
    if (!entry) message += ' — título não encontrado';
    else if (['06', '17'].includes(code) && paid > 0) {
      if (entry.status === 'PAGO') message += ' — já estava baixado';
      else {
        await payEntry(actor.companyId, actor.orgId, entry.id, { amount: paid, date, bankAccountId: bank?.id, method: 'BOLETO', transactionSource: 'BOLETO', userName: actor.userName });
        message += ` — baixado R$ ${paid.toFixed(2)}`;
      }
    }
    results.push({ ourNumber, code, description: entry?.description || '', contact: entry?.contactName || '', amount: paid, message });
  }
  return { processed: results.length, liquidated: results.filter((r) => r.message.includes('baixado R$')).length, results };
}

// ---------------------------------------------------------------------------
// Renegociação
// ---------------------------------------------------------------------------
export async function renegotiate(actor: Actor, input: { entryIds: string[]; installments: number; firstDueDate: string; interestPercent?: number; discount?: number; paymentMethod?: string }) {
  const entries = await prisma.financialEntry.findMany({ where: { id: { in: input.entryIds }, companyId: actor.companyId, type: 'RECEBER', status: { in: ['ABERTO', 'PARCIAL'] } } });
  if (!entries.length) fail(400, 'Selecione títulos a receber em aberto');
  const contacts = new Set(entries.map((e) => e.contactId || e.contactName));
  if (contacts.size > 1) fail(400, 'Renegocie títulos de um único cliente por vez');
  const open = round2(entries.reduce((a, e) => a + e.amount - e.paidAmount, 0));
  const interest = round2((open * (Number(input.interestPercent) || 0)) / 100);
  const total = round2(open + interest - (Number(input.discount) || 0));
  if (total <= 0) fail(400, 'Valor renegociado inválido');
  const n = await nextNumber(prisma, actor.companyId, 'RENEGOCIACAO', 1);
  for (const e of entries) await prisma.financialEntry.update({ where: { id: e.id }, data: { status: 'CANCELADO', notes: `${e.notes || ''} Renegociado no acordo nº ${n}.`.trim() } });
  const created = await createEntries(prisma, {
    companyId: actor.companyId, type: 'RECEBER', description: `Acordo de renegociação nº ${n}`, contactId: entries[0].contactId, contactName: entries[0].contactName,
    total, installments: Math.max(1, Number(input.installments) || 1), firstDueDate: new Date(input.firstDueDate + 'T12:00:00'), origin: 'RENEGOCIACAO', originId: `acordo-${n}`,
    chartAccountId: entries[0].chartAccountId, paymentMethod: input.paymentMethod || 'BOLETO', documentNumber: `AC${n}`,
    notes: `Títulos originais: ${entries.map((e) => e.description).join('; ')}. Original R$ ${open.toFixed(2)}, juros R$ ${interest.toFixed(2)}.`,
  });
  return { agreement: n, original: open, interest, total, entries: created };
}

// ---------------------------------------------------------------------------
// Agenda de recebíveis de cartão (adquirentes)
// ---------------------------------------------------------------------------
export type Receivable = { transactionId: string; installment: number; installments: number; dueDate: Date; gross: number; fee: number; net: number; method: string; terminal: string; settled: boolean };

export async function receivablesSchedule(companyId: string) {
  const txs = await prisma.posTransaction.findMany({ where: { companyId, status: 'APROVADA' }, orderBy: { createdAt: 'desc' }, take: 1000 });
  const terminals = await prisma.posTerminal.findMany({ where: { companyId } });
  const settledIds = new Set((await prisma.bankTransaction.findMany({ where: { companyId, fitId: { startsWith: 'POS:' } }, select: { fitId: true } })).map((t) => t.fitId));
  const out: Receivable[] = [];
  for (const t of txs) {
    const n = t.method === 'CREDITO' ? Math.max(1, t.installments) : 1;
    for (let i = 1; i <= n; i++) {
      const days = t.method === 'CREDITO' ? 30 * i : t.method === 'DEBITO' ? 1 : 0;
      const gross = i === n ? round2(t.amount - round2(t.amount / n) * (n - 1)) : round2(t.amount / n);
      const fee = i === n ? round2(t.fee - round2(t.fee / n) * (n - 1)) : round2(t.fee / n);
      out.push({ transactionId: t.id, installment: i, installments: n, dueDate: addDays(t.createdAt, days), gross, fee, net: round2(gross - fee), method: t.method, terminal: terminals.find((x) => x.id === t.terminalId)?.name || '', settled: settledIds.has(`POS:${t.id}:${i}`) });
    }
  }
  return out.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

/** Liquida os recebíveis vencidos (ou todos, com antecipação e taxa) da conta de cartão para a conta bancária */
export async function settleReceivables(actor: Actor, opts: { anticipate?: boolean; anticipationRate?: number } = {}) {
  const schedule = (await receivablesSchedule(actor.companyId)).filter((r) => !r.settled && (opts.anticipate || r.dueDate <= new Date()));
  if (!schedule.length) return { settled: 0, net: 0, anticipationFee: 0 };
  const clearing = await defaultBankAccount(prisma, actor.companyId, 'CARTAO');
  const terminals = await prisma.posTerminal.findMany({ where: { companyId: actor.companyId } });
  const txs = await prisma.posTransaction.findMany({ where: { id: { in: [...new Set(schedule.map((s) => s.transactionId))] } } });
  let total = 0, feeTotal = 0;
  const rate = opts.anticipationRate ?? 1.99; // % ao mês
  for (const r of schedule) {
    const t = txs.find((x) => x.id === r.transactionId)!;
    const dest = terminals.find((x) => x.id === t.terminalId)?.bankAccountId || (await defaultBankAccount(prisma, actor.companyId, 'CONTA_DIGITAL'))?.id;
    const months = Math.max(0, (r.dueDate.getTime() - Date.now()) / (30 * 86400000));
    const antFee = opts.anticipate && months > 0 ? round2(r.net * (rate / 100) * months) : 0;
    const fitId = `POS:${r.transactionId}:${r.installment}`;
    // Débito na conta de recebíveis (bruto já entrou e a taxa da adquirente já foi lançada nela)
    if (clearing) await prisma.bankTransaction.create({ data: { companyId: actor.companyId, bankAccountId: clearing.id, date: new Date(), description: `Liquidação ${r.method} ${r.installment}/${r.installments} - ${r.terminal}`, amount: -r.net, source: 'TRANSFERENCIA', reconciled: true, fitId: `${fitId}:OUT` } });
    await prisma.bankTransaction.create({ data: { companyId: actor.companyId, bankAccountId: dest!, date: new Date(), description: `${opts.anticipate && months > 0 ? 'Antecipação' : 'Liquidação'} cartão ${r.installment}/${r.installments} - ${r.terminal}`, amount: r.net, source: 'POS', reconciled: true, fitId } });
    if (antFee) await prisma.bankTransaction.create({ data: { companyId: actor.companyId, bankAccountId: dest!, date: new Date(), description: `Taxa de antecipação (${rate}% a.m.)`, amount: -antFee, source: 'TARIFA', reconciled: true } });
    total += r.net;
    feeTotal += antFee;
  }
  for (const t of txs) {
    const all = (await receivablesSchedule(actor.companyId)).filter((r) => r.transactionId === t.id);
    if (all.every((r) => r.settled)) await prisma.posTransaction.update({ where: { id: t.id }, data: { settledAt: new Date(), anticipated: !!opts.anticipate } });
  }
  return { settled: schedule.length, net: round2(total), anticipationFee: round2(feeTotal) };
}

// ---------------------------------------------------------------------------
// Rateio por centro de custo e orçamento
// ---------------------------------------------------------------------------
export async function setAllocations(entryId: string, allocations: { costCenterId: string; percent: number }[]) {
  const valid = allocations.filter((a) => a.costCenterId && Number(a.percent) > 0);
  if (valid.length) {
    const sum = round2(valid.reduce((a, x) => a + Number(x.percent), 0));
    if (Math.abs(sum - 100) > 0.01) fail(400, `O rateio deve somar 100% (atual: ${sum}%)`);
  }
  await prisma.costAllocation.deleteMany({ where: { entryId } });
  if (valid.length) await prisma.costAllocation.createMany({ data: valid.map((a) => ({ entryId, costCenterId: a.costCenterId, percent: Number(a.percent) })) });
}

/** Despesas/receitas por centro de custo no período (considera rateios) */
export async function costCenterReport(companyId: string, from: Date, to: Date) {
  const entries = await prisma.financialEntry.findMany({ where: { companyId, status: { not: 'CANCELADO' }, competenceDate: { gte: from, lte: to } }, select: { id: true, type: true, amount: true, costCenterId: true } });
  const allocs = await prisma.costAllocation.findMany({ where: { entryId: { in: entries.map((e) => e.id) } } });
  const centers = await prisma.costCenter.findMany({ where: { companyId } });
  const map = new Map<string, { center: string; revenue: number; expense: number }>();
  const add = (id: string | null, type: string, v: number) => {
    const name = centers.find((c) => c.id === id)?.name || 'Sem centro de custo';
    const m = map.get(name) || { center: name, revenue: 0, expense: 0 };
    if (type === 'RECEBER') m.revenue = round2(m.revenue + v);
    else m.expense = round2(m.expense + v);
    map.set(name, m);
  };
  for (const e of entries) {
    const a = allocs.filter((x) => x.entryId === e.id);
    if (a.length) a.forEach((x) => add(x.costCenterId, e.type, (e.amount * x.percent) / 100));
    else add(e.costCenterId, e.type, e.amount);
  }
  return [...map.values()].map((m) => ({ ...m, result: round2(m.revenue - m.expense) })).sort((a, b) => b.expense - a.expense);
}

export async function budgetVsActual(companyId: string, year: number, month?: number) {
  const charts = await prisma.chartAccount.findMany({ where: { companyId, active: true }, orderBy: { code: 'asc' } });
  const budgets = await prisma.budget.findMany({ where: { companyId, year, ...(month ? { month } : {}) } });
  const from = new Date(year, (month || 1) - 1, 1);
  const to = month ? new Date(year, month, 0, 23, 59, 59) : new Date(year, 11, 31, 23, 59, 59);
  const actual = await prisma.financialEntry.groupBy({ by: ['chartAccountId'], where: { companyId, status: { not: 'CANCELADO' }, competenceDate: { gte: from, lte: to } }, _sum: { amount: true } });
  return charts
    .map((c) => {
      const b = round2(budgets.filter((x) => x.chartAccountId === c.id).reduce((a, x) => a + x.amount, 0));
      const a = round2(actual.find((x) => x.chartAccountId === c.id)?._sum.amount || 0);
      return { chartAccountId: c.id, code: c.code, name: c.name, type: c.type, budget: b, actual: a, diff: round2(a - b), percent: b ? round2((a / b) * 100) : null };
    })
    .filter((r) => r.budget || r.actual);
}

export async function saveBudget(companyId: string, rows: { chartAccountId: string; year: number; month: number; amount: number }[]) {
  for (const r of rows) {
    const amount = round2(Number(r.amount) || 0);
    await prisma.budget.upsert({
      where: { companyId_chartAccountId_year_month: { companyId, chartAccountId: r.chartAccountId, year: r.year, month: r.month } },
      create: { companyId, chartAccountId: r.chartAccountId, year: r.year, month: r.month, amount },
      update: { amount },
    });
  }
  return { saved: rows.length };
}

export const _r = randomDigits;
