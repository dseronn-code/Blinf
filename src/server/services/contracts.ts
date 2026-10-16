/**
 * Contratos (cobrança recorrente, como em Vendas → Contratos do Bling):
 * cadastro com itens de serviço/produto, periodicidade e dia de cobrança;
 * faturamento por período (conta a receber + NFS-e/NF-e opcional), idempotente
 * por contrato/período, e reajuste anual no aniversário.
 */
import { prisma } from '@/lib/db';
import { round2, round3, addDays } from '@/lib/utils';
import { fail } from '../errors';
import { nextNumber } from '../sequence';
import { createEntries } from './finance';
import { buildInvoice, transmitInvoice } from './fiscal';
import { notify } from './notify';
import type { Actor } from './sales';

export const INTERVAL_MONTHS = { MENSAL: 1, BIMESTRAL: 2, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 } as const;
export type ContractInterval = keyof typeof INTERVAL_MONTHS;
export const INTERVALS = Object.keys(INTERVAL_MONTHS) as ContractInterval[];
export const INVOICE_MODELS = ['NENHUMA', 'NFSE', 'NFE'] as const;
export const CONTRACT_STATUS = ['ATIVO', 'SUSPENSO', 'ENCERRADO'] as const;
/** Antecedência padrão: contratos com vencimento nos próximos N dias já são faturados pela rotina */
export const BILL_AHEAD_DAYS = 5;
/** Linhas de reajuste ficam no histórico (ContractBilling) com período "REAJ-AAAA" */
const ADJ_PREFIX = 'REAJ-';

export type ContractItem = { kind: 'SERVICO' | 'PRODUTO'; serviceId?: string | null; productId?: string | null; description: string; quantity: number; unitPrice: number };

export type ContractInput = {
  customerId: string;
  description: string;
  items: Partial<ContractItem>[];
  interval?: string;
  billingDay?: number;
  startDate: string | Date;
  endDate?: string | Date | null;
  paymentMethod?: string;
  invoiceModel?: string;
  adjustPercent?: number;
  sellerId?: string | null;
  notes?: string | null;
};

// ---------------- Datas (funções puras, testadas em tests/contracts.test.ts) ----------------

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** Data de cobrança no mês (dia limitado ao último dia do mês: 31 → 28/29/30) */
export function billingDateIn(year: number, month0: number, billingDay: number) {
  const y = year + Math.floor(month0 / 12);
  const m = ((month0 % 12) + 12) % 12;
  return new Date(y, m, Math.min(Math.max(1, billingDay), daysInMonth(y, m)));
}

/** Primeira cobrança a partir do início do contrato */
export function firstBillingDate(start: Date, billingDay: number) {
  const d = billingDateIn(start.getFullYear(), start.getMonth(), billingDay);
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  return d >= s ? d : billingDateIn(start.getFullYear(), start.getMonth() + 1, billingDay);
}

/** Próxima cobrança após `current`, sempre recalculada a partir do dia configurado (31/01 → 28/02 → 31/03) */
export function nextBillingAfter(current: Date, interval: string, billingDay: number) {
  const months = INTERVAL_MONTHS[interval as ContractInterval] || 1;
  return billingDateIn(current.getFullYear(), current.getMonth() + months, billingDay);
}

/** Período de competência AAAA-MM de uma data de cobrança */
export const periodOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Valor mensal equivalente (MRR) */
export const monthlyValue = (amount: number, interval: string) => round2(amount / (INTERVAL_MONTHS[interval as ContractInterval] || 1));

/** Aniversário mais recente (k ≥ 1 anos após o início) até a data de referência */
export function lastAnniversary(start: Date, ref: Date) {
  let years = ref.getFullYear() - start.getFullYear();
  const at = (k: number) => billingDateIn(start.getFullYear() + k, start.getMonth(), start.getDate());
  if (years >= 1 && at(years) > ref) years--;
  return years >= 1 ? { years, date: at(years) } : null;
}

const toDate = (v: string | Date) => (v instanceof Date ? new Date(v.getFullYear(), v.getMonth(), v.getDate()) : /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v));
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };

// ---------------- Cadastro ----------------

async function resolveItems(companyOrgId: string, items: ContractInput['items']) {
  const out: ContractItem[] = [];
  for (const it of items || []) {
    const quantity = round3(Number(it.quantity) || 0);
    if (!quantity) continue;
    const kind = it.kind === 'PRODUTO' ? 'PRODUTO' : 'SERVICO';
    let description = (it.description || '').trim();
    if (kind === 'SERVICO' && it.serviceId) {
      const s = await prisma.service.findFirst({ where: { id: it.serviceId, organizationId: companyOrgId } });
      if (!s) fail(400, 'Serviço não encontrado');
      description ||= s!.name;
    }
    if (kind === 'PRODUTO' && it.productId) {
      const p = await prisma.product.findFirst({ where: { id: it.productId, organizationId: companyOrgId } });
      if (!p) fail(400, 'Produto não encontrado');
      description ||= p!.name;
    }
    if (!description) fail(400, 'Informe a descrição de cada item do contrato');
    out.push({ kind, serviceId: kind === 'SERVICO' ? it.serviceId || null : null, productId: kind === 'PRODUTO' ? it.productId || null : null, description, quantity, unitPrice: round2(Number(it.unitPrice) || 0) });
  }
  return out;
}

export const itemsTotal = (items: ContractItem[]) => round2(items.reduce((a, i) => a + round2(i.quantity * i.unitPrice), 0));

export async function saveContract(actor: Actor, input: ContractInput, id?: string) {
  if (!input.customerId) fail(400, 'Informe o cliente');
  if (!input.description?.trim()) fail(400, 'Informe a descrição do contrato');
  const customer = await prisma.contact.findFirst({ where: { id: input.customerId, organizationId: actor.orgId } });
  if (!customer) fail(400, 'Cliente não encontrado');
  const interval = (input.interval || 'MENSAL').toUpperCase();
  if (!INTERVALS.includes(interval as ContractInterval)) fail(400, 'Periodicidade inválida');
  const invoiceModel = (input.invoiceModel || 'NFSE').toUpperCase();
  if (!(INVOICE_MODELS as readonly string[]).includes(invoiceModel)) fail(400, 'Modelo de nota inválido');
  const billingDay = Math.floor(Number(input.billingDay) || 10);
  if (billingDay < 1 || billingDay > 31) fail(400, 'Dia de cobrança deve estar entre 1 e 31');
  if (!input.startDate) fail(400, 'Informe a data de início');
  const startDate = toDate(input.startDate);
  const endDate = input.endDate ? toDate(input.endDate) : null;
  if (endDate && endDate < startDate) fail(400, 'Término anterior ao início');
  const items = await resolveItems(actor.orgId, input.items);
  if (!items.length) fail(400, 'Inclua ao menos um item no contrato');
  const amount = itemsTotal(items);
  if (amount <= 0) fail(400, 'O valor do contrato deve ser maior que zero');
  const data = {
    customerId: input.customerId,
    description: input.description.trim(),
    items: items as unknown as object[],
    amount,
    interval,
    billingDay,
    startDate,
    endDate,
    paymentMethod: input.paymentMethod || 'BOLETO',
    invoiceModel,
    adjustPercent: round2(Number(input.adjustPercent) || 0),
    sellerId: input.sellerId || null,
    notes: input.notes || null,
  };

  if (id) {
    const c = await prisma.contract.findFirst({ where: { id, companyId: actor.companyId } });
    if (!c) fail(404, 'Contrato não encontrado');
    if (c!.status === 'ENCERRADO') fail(400, 'Contrato encerrado não pode ser alterado');
    // Mudou dia/periodicidade/início: recalcula a próxima cobrança a partir da última faturada
    let nextBillingDate = c!.nextBillingDate;
    if (c!.billingDay !== billingDay || c!.interval !== interval || +c!.startDate !== +startDate) {
      const last = await prisma.contractBilling.findFirst({ where: { contractId: id, NOT: { period: { startsWith: ADJ_PREFIX } } }, orderBy: { period: 'desc' } });
      if (last) {
        const [y, m] = last.period.split('-').map(Number);
        nextBillingDate = nextBillingAfter(billingDateIn(y, m - 1, billingDay), interval, billingDay);
      } else nextBillingDate = firstBillingDate(startDate, billingDay);
    }
    return prisma.contract.update({ where: { id }, data: { ...data, nextBillingDate } });
  }
  const number = await nextNumber(prisma, actor.companyId, 'CONTRATO', 1);
  return prisma.contract.create({ data: { ...data, companyId: actor.companyId, number, status: 'ATIVO', nextBillingDate: firstBillingDate(startDate, billingDay) } });
}

export async function setContractStatus(actor: Actor, id: string, action: 'suspend' | 'activate' | 'close') {
  const c = await prisma.contract.findFirst({ where: { id, companyId: actor.companyId } });
  if (!c) fail(404, 'Contrato não encontrado');
  if (c!.status === 'ENCERRADO') fail(400, 'Contrato já encerrado');
  if (action === 'suspend') {
    if (c!.status !== 'ATIVO') fail(400, 'Somente contratos ativos podem ser suspensos');
    return prisma.contract.update({ where: { id }, data: { status: 'SUSPENSO' } });
  }
  if (action === 'activate') {
    if (c!.status !== 'SUSPENSO') fail(400, 'Contrato não está suspenso');
    // Períodos que venceram durante a suspensão não são cobrados: pula para a próxima data a partir de hoje
    let next = c!.nextBillingDate;
    while (next < today()) next = nextBillingAfter(next, c!.interval, c!.billingDay);
    return prisma.contract.update({ where: { id }, data: { status: 'ATIVO', nextBillingDate: next } });
  }
  // Encerramento: término hoje (ou mantém o término já informado se for anterior)
  const end = c!.endDate && c!.endDate < today() ? c!.endDate : today();
  return prisma.contract.update({ where: { id }, data: { status: 'ENCERRADO', endDate: end } });
}

// ---------------- Faturamento ----------------

export type BillResult = { billing: { id: string; period: string; amount: number; entryId: string | null; invoiceId: string | null }; created: boolean; invoiceStatus?: string | null; message: string };

/**
 * Fatura um período do contrato (padrão: a próxima cobrança). Idempotente: o par
 * contrato/período é único — chamar de novo devolve o faturamento já existente.
 */
export async function billContract(actor: Actor, id: string, period?: string | null): Promise<BillResult> {
  const c = await prisma.contract.findFirst({ where: { id, companyId: actor.companyId } });
  if (!c) fail(404, 'Contrato não encontrado');
  const ct = c!;
  if (ct.status !== 'ATIVO') fail(400, `Contrato ${ct.status === 'SUSPENSO' ? 'suspenso' : 'encerrado'} não pode ser faturado`);
  if (period && !/^\d{4}-\d{2}$/.test(period)) fail(400, 'Período inválido (use AAAA-MM)');
  const nextPeriod = periodOf(ct.nextBillingDate);
  const p = period || nextPeriod;
  const [py, pm] = p.split('-').map(Number);
  const dueDate = p === nextPeriod ? ct.nextBillingDate : billingDateIn(py, pm - 1, ct.billingDay);
  if (dueDate < billingDateIn(ct.startDate.getFullYear(), ct.startDate.getMonth(), 1)) fail(400, 'Período anterior ao início do contrato');
  if (ct.endDate && dueDate > ct.endDate) fail(400, 'Período após o término do contrato');
  const advance = async () => {
    if (p !== nextPeriod) return;
    const next = nextBillingAfter(ct.nextBillingDate, ct.interval, ct.billingDay);
    // Passou do término: o contrato é encerrado automaticamente
    const ended = ct.endDate && next > ct.endDate;
    await prisma.contract.update({ where: { id }, data: { nextBillingDate: next, ...(ended ? { status: 'ENCERRADO' } : {}) } });
  };

  const existing = await prisma.contractBilling.findUnique({ where: { contractId_period: { contractId: id, period: p } } });
  if (existing) {
    await advance();
    return { billing: existing, created: false, message: `Período ${p} já faturado` };
  }
  // Reserva o período antes de gerar documentos (a unicidade impede cobrança em dobro em chamadas simultâneas)
  let billing;
  try {
    billing = await prisma.contractBilling.create({ data: { contractId: id, period: p, amount: ct.amount } });
  } catch (e) {
    const again = await prisma.contractBilling.findUnique({ where: { contractId_period: { contractId: id, period: p } } });
    if (again) return { billing: again, created: false, message: `Período ${p} já faturado` };
    throw e;
  }

  const customer = await prisma.contact.findUnique({ where: { id: ct.customerId } });
  const items = (ct.items as unknown as ContractItem[]) || [];
  const label = `Contrato nº ${ct.number} — ${ct.description} (${p.slice(5)}/${p.slice(0, 4)})`;
  let entryId: string | null = null;
  try {
    const due = dueDate < today() ? today() : dueDate;
    const [entry] = await createEntries(prisma, {
      companyId: actor.companyId, type: 'RECEBER', description: label, contactId: ct.customerId, contactName: customer?.name, total: ct.amount,
      installments: 1, firstDueDate: due, origin: 'CONTRATO', originId: ct.id, chartAccountCode: ct.invoiceModel === 'NFE' ? '1.1.01' : '1.1.04',
      paymentMethod: ct.paymentMethod, documentNumber: `CT${ct.number}-${p.replace('-', '')}`, competenceDate: dueDate,
    });
    entryId = entry.id;
  } catch (e) {
    await prisma.contractBilling.delete({ where: { id: billing.id } }).catch(() => {});
    throw e;
  }

  // Nota fiscal: NFS-e com os serviços ou NF-e com os produtos (falha na SEFAZ/prefeitura não desfaz a cobrança)
  let invoiceId: string | null = null;
  let invoiceStatus: string | null = null;
  let invoiceMsg = '';
  if (ct.invoiceModel !== 'NENHUMA') {
    const nfse = ct.invoiceModel === 'NFSE';
    const lines = items.filter((i) => (nfse ? i.kind === 'SERVICO' && i.serviceId : i.kind === 'PRODUTO' && i.productId));
    if (!lines.length) invoiceMsg = ` · sem ${nfse ? 'serviços cadastrados' : 'produtos cadastrados'} para emitir ${nfse ? 'NFS-e' : 'NF-e'}`;
    else {
      try {
        const inv = await buildInvoice(prisma, {
          companyId: actor.companyId, model: nfse ? 'NFSE' : 'NFE', customerId: ct.customerId,
          items: lines.map((l) => ({ serviceId: l.serviceId, productId: l.productId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })),
          additionalInfo: `${label}. Referente ao período ${p.slice(5)}/${p.slice(0, 4)}.`,
        });
        invoiceId = inv.id;
        const r = await transmitInvoice(actor.companyId, actor.orgId, inv.id, actor.userName);
        invoiceStatus = r?.status || null;
        invoiceMsg = ` · ${nfse ? 'NFS-e' : 'NF-e'} nº ${inv.number} ${invoiceStatus === 'AUTORIZADA' ? 'autorizada' : `${invoiceStatus?.toLowerCase()}${r?.rejectionReason ? `: ${r.rejectionReason}` : ''}`}`;
      } catch (e) {
        invoiceMsg = ` · nota não emitida: ${(e as Error).message}`;
      }
      if (invoiceStatus !== 'AUTORIZADA') await notify(actor.companyId, `Contrato nº ${ct.number}: nota não autorizada`, `Cobrança de ${p} lançada${invoiceMsg}`, { level: 'warning', link: invoiceId ? `/fiscal/notas/${invoiceId}` : `/vendas/contratos/${ct.id}` });
    }
  }
  const saved = await prisma.contractBilling.update({ where: { id: billing.id }, data: { entryId, invoiceId } });
  await advance();
  return { billing: saved, created: true, invoiceStatus, message: `Período ${p} faturado: R$ ${ct.amount.toFixed(2)}${invoiceMsg}` };
}

/** Fatura todos os contratos ativos com vencimento até hoje (+ antecedência), inclusive períodos atrasados */
export async function billDueContracts(actor: Actor, opts: { aheadDays?: number; contractIds?: string[] } = {}) {
  const limit = addDays(today(), opts.aheadDays ?? BILL_AHEAD_DAYS);
  const due = await prisma.contract.findMany({ where: { companyId: actor.companyId, status: 'ATIVO', nextBillingDate: { lte: limit }, ...(opts.contractIds ? { id: { in: opts.contractIds } } : {}) }, orderBy: { nextBillingDate: 'asc' } });
  const results: { contractId: string; number: number; ok: boolean; message: string }[] = [];
  for (const c of due) {
    // Atualiza em laço para recuperar vários períodos atrasados (no máximo 24 por execução)
    for (let i = 0; i < 24; i++) {
      const cur = await prisma.contract.findUnique({ where: { id: c.id } });
      if (!cur || cur.status !== 'ATIVO' || cur.nextBillingDate > limit) break;
      try {
        const r = await billContract(actor, c.id);
        results.push({ contractId: c.id, number: c.number, ok: true, message: r.message });
      } catch (e) {
        results.push({ contractId: c.id, number: c.number, ok: false, message: (e as Error).message });
        break;
      }
    }
  }
  return { billed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

// ---------------- Reajuste anual ----------------

/** Aplica o reajuste anual (%) no aniversário do contrato — uma vez por aniversário */
export async function adjustContract(actor: Actor, id: string, ref = today()) {
  const c = await prisma.contract.findFirst({ where: { id, companyId: actor.companyId } });
  if (!c) fail(404, 'Contrato não encontrado');
  const ct = c!;
  if (ct.status === 'ENCERRADO' || !ct.adjustPercent) return null;
  const ann = lastAnniversary(ct.startDate, ref);
  // Contratos cadastrados depois do aniversário já entram com o preço atualizado
  if (!ann || ct.createdAt > ann.date) return null;
  const period = `${ADJ_PREFIX}${ann.date.getFullYear()}`;
  if (await prisma.contractBilling.findUnique({ where: { contractId_period: { contractId: id, period } } })) return null;
  const factor = 1 + ct.adjustPercent / 100;
  const items = ((ct.items as unknown as ContractItem[]) || []).map((i) => ({ ...i, unitPrice: round2(i.unitPrice * factor) }));
  const amount = itemsTotal(items);
  try {
    await prisma.contractBilling.create({ data: { contractId: id, period, amount } });
  } catch {
    return null; // outro processo aplicou o mesmo reajuste
  }
  await prisma.contract.update({ where: { id }, data: { items: items as unknown as object[], amount, notes: [ct.notes, `Reajuste de ${ct.adjustPercent}% em ${ann.date.toLocaleDateString('pt-BR')}: R$ ${ct.amount.toFixed(2)} → R$ ${amount.toFixed(2)}`].filter(Boolean).join('\n') } });
  return { contractId: id, number: ct.number, from: ct.amount, to: amount };
}

export async function adjustDueContracts(actor: Actor) {
  const rows = await prisma.contract.findMany({ where: { companyId: actor.companyId, status: { in: ['ATIVO', 'SUSPENSO'] }, adjustPercent: { gt: 0 }, startDate: { lte: addDays(today(), -365) } }, select: { id: true } });
  const done = [];
  for (const r of rows) {
    const a = await adjustContract(actor, r.id);
    if (a) done.push(a);
  }
  if (done.length) await notify(actor.companyId, 'Reajuste de contratos', `${done.length} contrato(s) reajustado(s) no aniversário`, { level: 'info', link: '/vendas/contratos' });
  return done;
}

// ---------------- Consultas ----------------

export const isAdjustment = (period: string) => period.startsWith(ADJ_PREFIX);

export async function listContracts(actor: Actor, filters: { status?: string | null; q?: string | null } = {}) {
  const where: any = { companyId: actor.companyId };
  if (filters.status) where.status = { in: filters.status.split(',') };
  const rows = await prisma.contract.findMany({ where, orderBy: { number: 'desc' } });
  const customers = await prisma.contact.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.customerId))] } }, select: { id: true, name: true } });
  const name = (id: string) => customers.find((c) => c.id === id)?.name || '';
  const q = filters.q?.trim().toLowerCase();
  const list = rows.map((r) => ({ ...r, customerName: name(r.customerId), monthly: monthlyValue(r.amount, r.interval) })).filter((r) => !q || r.customerName.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || String(r.number) === q);

  // Resumo: MRR dos ativos, quantidade e valor a faturar até o fim do mês corrente
  const all = await prisma.contract.findMany({ where: { companyId: actor.companyId }, select: { status: true, amount: true, interval: true, nextBillingDate: true } });
  const active = all.filter((r) => r.status === 'ATIVO');
  const now = new Date();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const toBill = active.filter((r) => r.nextBillingDate <= monthEnd);
  return {
    rows: list,
    summary: {
      mrr: round2(active.reduce((s, r) => s + monthlyValue(r.amount, r.interval), 0)),
      active: active.length,
      suspended: all.filter((r) => r.status === 'SUSPENSO').length,
      toBillCount: toBill.length,
      toBillAmount: round2(toBill.reduce((s, r) => s + r.amount, 0)),
    },
  };
}

export async function getContract(actor: Actor, id: string) {
  const c = await prisma.contract.findFirst({ where: { id, companyId: actor.companyId }, include: { billings: { orderBy: { createdAt: 'desc' } } } });
  if (!c) fail(404, 'Contrato não encontrado');
  const ct = c!;
  const customer = await prisma.contact.findUnique({ where: { id: ct.customerId }, select: { id: true, name: true, document: true, email: true } });
  const entryIds = ct.billings.map((b) => b.entryId).filter(Boolean) as string[];
  const invoiceIds = ct.billings.map((b) => b.invoiceId).filter(Boolean) as string[];
  const [entries, invoices] = await Promise.all([
    prisma.financialEntry.findMany({ where: { id: { in: entryIds } }, select: { id: true, dueDate: true, amount: true, paidAmount: true, status: true } }),
    prisma.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, number: true, model: true, status: true } }),
  ]);
  return {
    ...ct,
    customer,
    monthly: monthlyValue(ct.amount, ct.interval),
    billings: ct.billings.map((b) => ({ ...b, adjustment: isAdjustment(b.period), entry: entries.find((e) => e.id === b.entryId) || null, invoice: invoices.find((i) => i.id === b.invoiceId) || null })),
  };
}
