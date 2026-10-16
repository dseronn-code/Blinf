/**
 * Assistente de IA do GestãoPro.
 * - Com ANTHROPIC_API_KEY: usa Claude (tool use) para consultar os dados do ERP.
 * - Sem chave: motor local de intenções em português que chama as mesmas
 *   ferramentas de consulta (funciona 100% offline no ambiente demo).
 */
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/db';
import { money, round2, startOfDay, startOfMonth, addDays, fmtDate, num } from '@/lib/utils';
import { dashboard, abcCurve, delinquency, dre, salesByChannel, cashFlow } from './reports';
import { getAvailability } from './stock';
import type { Ctx } from '../context';

type Tool = { name: string; description: string; input_schema: Record<string, unknown>; run: (ctx: Ctx, input: any) => Promise<unknown> };

const periodSchema = { type: 'object', properties: { days: { type: 'integer', description: 'Período em dias até hoje (padrão 30)' } }, additionalProperties: false };

export const TOOLS: Tool[] = [
  {
    name: 'resumo_negocio', description: 'KPIs principais: vendas hoje/mês, ticket médio, margem, pedidos em aberto, contas a receber/pagar, saldo em contas, estoque baixo.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (ctx) => (await dashboard(ctx)).kpis,
  },
  {
    name: 'vendas_periodo', description: 'Total vendido, quantidade de pedidos e ticket médio nos últimos N dias, com quebra por canal de venda.',
    input_schema: periodSchema,
    run: async (ctx, i) => {
      const days = i?.days || 30;
      const from = addDays(startOfDay(), -days + 1);
      const channels = await salesByChannel(ctx, from, new Date());
      const revenue = round2(channels.reduce((a, c) => a + c.revenue, 0));
      const orders = channels.reduce((a, c) => a + c.orders, 0);
      return { days, revenue, orders, avgTicket: orders ? round2(revenue / orders) : 0, channels };
    },
  },
  {
    name: 'produtos_mais_vendidos', description: 'Ranking de produtos por faturamento (curva ABC) com quantidade, lucro e margem.',
    input_schema: { type: 'object', properties: { days: { type: 'integer' }, limit: { type: 'integer' } }, additionalProperties: false },
    run: async (ctx, i) => (await abcCurve(ctx, i?.days || 30)).rows.slice(0, i?.limit || 10),
  },
  {
    name: 'estoque_baixo', description: 'Produtos com estoque disponível abaixo do mínimo ou zerados (ruptura).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (ctx) => {
      const ps = await prisma.product.findMany({ where: { organizationId: ctx.orgId, controlsStock: true, active: true, kind: { notIn: ['KIT', 'VARIACAO_PAI'] } } });
      const av = await getAvailability(prisma, ctx, ps.map((p) => p.id));
      return ps.map((p) => ({ sku: p.sku, name: p.name, available: av.get(p.id)?.available ?? 0, minStock: p.minStock })).filter((p) => p.available <= 0 || p.available < p.minStock).sort((a, b) => a.available - b.available).slice(0, 20);
    },
  },
  {
    name: 'consultar_estoque_produto', description: 'Saldo físico, reservado e disponível de um produto pesquisado por nome ou SKU.',
    input_schema: { type: 'object', properties: { busca: { type: 'string' } }, required: ['busca'], additionalProperties: false },
    run: async (ctx, i) => {
      const ps = await prisma.product.findMany({ where: { organizationId: ctx.orgId, OR: [{ name: { contains: i.busca, mode: 'insensitive' } }, { sku: { contains: i.busca, mode: 'insensitive' } }] }, take: 10 });
      const av = await getAvailability(prisma, ctx, ps.map((p) => p.id));
      return ps.map((p) => ({ sku: p.sku, name: p.name, price: p.price, ...av.get(p.id) }));
    },
  },
  {
    name: 'inadimplencia', description: 'Contas a receber vencidas: total, taxa de inadimplência, faixas de atraso e maiores devedores.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (ctx) => {
      const d = await delinquency(ctx);
      return { overdue: d.overdue, totalOpen: d.totalOpen, rate: d.rate, ranges: d.ranges, topCustomers: d.byCustomer.slice(0, 5) };
    },
  },
  {
    name: 'contas_vencendo', description: 'Contas a pagar e a receber que vencem nos próximos N dias.',
    input_schema: periodSchema,
    run: async (ctx, i) => {
      const list = await prisma.financialEntry.findMany({ where: { companyId: ctx.companyId, status: { in: ['ABERTO', 'PARCIAL'] }, dueDate: { gte: startOfDay(), lte: addDays(startOfDay(), i?.days || 7) } }, orderBy: { dueDate: 'asc' }, take: 30 });
      return list.map((e) => ({ type: e.type, description: e.description, contact: e.contactName, dueDate: fmtDate(e.dueDate), open: round2(e.amount - e.paidAmount) }));
    },
  },
  {
    name: 'dre_mes', description: 'DRE gerencial do mês atual (receita, CMV, despesas, lucro líquido e margem).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (ctx) => dre(ctx, startOfMonth(), new Date()),
  },
  {
    name: 'fluxo_caixa', description: 'Projeção do fluxo de caixa (saldo atual e saldo previsto) para os próximos N dias.',
    input_schema: periodSchema,
    run: async (ctx, i) => {
      const f = await cashFlow(ctx, startOfDay(), addDays(startOfDay(), i?.days || 30));
      const minRow = f.rows.reduce((m, r) => (r.balance < m.balance ? r : m), f.rows[0]);
      return { opening: f.opening, closing: f.closing, lowestBalance: minRow };
    },
  },
  {
    name: 'melhores_clientes', description: 'Clientes que mais compraram nos últimos N dias.',
    input_schema: periodSchema,
    run: async (ctx, i) => {
      const g = await prisma.salesOrder.groupBy({ by: ['customerId'], where: { companyId: ctx.companyId, status: { not: 'CANCELADO' }, date: { gte: addDays(new Date(), -(i?.days || 90)) } }, _sum: { total: true }, _count: true, orderBy: { _sum: { total: 'desc' } }, take: 10 });
      const cs = await prisma.contact.findMany({ where: { id: { in: g.map((x) => x.customerId) } } });
      return g.map((x) => ({ customer: cs.find((c) => c.id === x.customerId)?.name, orders: x._count, total: round2(x._sum.total || 0) }));
    },
  },
  {
    name: 'pedidos_pendentes', description: 'Pedidos em aberto (a faturar) e faturados aguardando envio.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (ctx) => {
      const rows = await prisma.salesOrder.findMany({ where: { companyId: ctx.companyId, status: { in: ['ABERTO', 'FATURADO', 'SEPARADO'] } }, include: { customer: { select: { name: true } } }, orderBy: { date: 'asc' }, take: 30 });
      return rows.map((o) => ({ number: o.number, status: o.status, customer: o.customer.name, total: o.total, date: fmtDate(o.date) }));
    },
  },
];

const SYSTEM = `Você é o assistente de gestão do GestãoPro, um ERP para pequenas e médias empresas brasileiras.
Responda sempre em português do Brasil, de forma objetiva, usando as ferramentas para consultar dados reais do sistema antes de responder.
Formate valores em reais (R$ 1.234,56). Quando útil, traga uma recomendação prática curta (ex.: repor estoque, cobrar clientes).
Não invente números: se uma informação não estiver disponível nas ferramentas, diga isso.`;

export async function askAssistant(ctx: Ctx, message: string, history: { role: 'user' | 'assistant'; content: string }[] = []) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return { answer: await askClaude(ctx, message, history), engine: 'claude' };
    } catch (e) {
      console.error('[assistant] Claude indisponível, usando motor local:', (e as Error).message);
    }
  }
  return { answer: await localEngine(ctx, message), engine: 'local' };
}

async function askClaude(ctx: Ctx, message: string, history: { role: 'user' | 'assistant'; content: string }[]) {
  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = [...history.slice(-10).map((h) => ({ role: h.role, content: h.content })), { role: 'user', content: message }];
  const tools = TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema })) as Anthropic.Beta.BetaTool[];
  for (let step = 0; step < 6; step++) {
    const response = await client.beta.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
      max_tokens: 16000,
      system: SYSTEM,
      tools,
      messages,
      output_config: { effort: 'low' },
      // Fallback automático no servidor em caso de recusa por política
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    } as never) as unknown as Anthropic.Beta.BetaMessage;
    if (response.stop_reason === 'refusal') return 'Não posso ajudar com essa solicitação.';
    if (response.stop_reason !== 'tool_use') {
      return response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim() || 'Sem resposta.';
    }
    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const tool = TOOLS.find((t) => t.name === block.name);
      try {
        const out = tool ? await tool.run(ctx, block.input) : { error: 'Ferramenta desconhecida' };
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out).slice(0, 20000) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: block.id, content: (e as Error).message, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return 'Não consegui concluir a análise. Tente reformular a pergunta.';
}

// ---------------------------------------------------------------------------
// Motor local (sem LLM): reconhece intenções por palavras-chave
// ---------------------------------------------------------------------------
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const run = (name: string, ctx: Ctx, input: unknown = {}) => TOOLS.find((t) => t.name === name)!.run(ctx, input) as Promise<any>;

async function localEngine(ctx: Ctx, message: string): Promise<string> {
  const m = norm(message);
  const daysMatch = m.match(/(\d+)\s*dias?/);
  const days = daysMatch ? Number(daysMatch[1]) : m.includes('semana') ? 7 : m.includes('hoje') ? 1 : m.includes('ano') ? 365 : 30;

  if (/estoque (do|da|de)|quanto (tem|tenho) (de|do)|saldo (do|da|de)/.test(m)) {
    const term = message.split(/estoque (?:do|da|de)|quanto (?:tem|tenho) (?:de|do)|saldo (?:do|da|de)/i)[1]?.replace(/[?.!]/g, '').trim();
    if (term) {
      const rows = await run('consultar_estoque_produto', ctx, { busca: term });
      if (!rows.length) return `Não encontrei produtos com "${term}".`;
      return `📦 **Estoque para "${term}"**\n\n${rows.map((r: any) => `- ${r.sku} — ${r.name}: **${num(r.available)} disponíveis** (físico ${num(r.quantity)}, reservado ${num(r.reserved)})`).join('\n')}`;
    }
  }
  if (/estoque|ruptura|repor|reposicao|acabando|minimo/.test(m)) {
    const rows = await run('estoque_baixo', ctx);
    if (!rows.length) return '✅ Nenhum produto abaixo do estoque mínimo no momento.';
    return `⚠️ **${rows.length} produto(s) precisam de reposição:**\n\n${rows.slice(0, 12).map((r: any) => `- ${r.sku} — ${r.name}: disponível **${num(r.available)}** (mínimo ${num(r.minStock)})`).join('\n')}\n\n💡 A automação de reposição pode gerar pedidos de compra automaticamente para o fornecedor padrão.`;
  }
  if (/inadimpl|vencid|atrasad|devedor|cobran/.test(m)) {
    const d = await run('inadimplencia', ctx);
    return `💸 **Inadimplência**\n\n- Vencido: **${money(d.overdue)}** de ${money(d.totalOpen)} em aberto (taxa ${num(d.rate)}%)\n${d.ranges.map((r: any) => `- ${r.range}: ${r.count} título(s) — ${money(r.amount)}`).join('\n')}\n\n**Maiores devedores:**\n${d.topCustomers.map((c: any) => `- ${c.customer}: ${money(c.amount)}`).join('\n') || '- nenhum'}\n\n💡 Use a régua de cobrança (Automações) e envie links de pagamento Pix.`;
  }
  if (/dre|lucro|resultado|margem liquida/.test(m)) {
    const d = await run('dre_mes', ctx);
    return `📊 **DRE do mês (até hoje)**\n\n${d.lines.filter((l: any) => l.bold).map((l: any) => `- ${l.label.replace(/^\(=\) /, '')}: **${money(l.value)}** (${num(l.percent)}%)`).join('\n')}\n\nMargem líquida: **${num(d.netMargin)}%**.`;
  }
  if (/fluxo|caixa|saldo/.test(m)) {
    const f = await run('fluxo_caixa', ctx, { days });
    return `🏦 **Fluxo de caixa (${days} dias)**\n\n- Saldo atual: **${money(f.opening)}**\n- Saldo previsto ao fim do período: **${money(f.closing)}**\n- Menor saldo projetado: ${money(f.lowestBalance?.balance)} em ${f.lowestBalance?.period}`;
  }
  if (/pagar|receber|vence|vencimento|boleto/.test(m)) {
    const rows = await run('contas_vencendo', ctx, { days: daysMatch ? days : 7 });
    if (!rows.length) return 'Nenhuma conta vencendo no período.';
    const rec = rows.filter((r: any) => r.type === 'RECEBER');
    const pag = rows.filter((r: any) => r.type === 'PAGAR');
    return `📅 **Contas vencendo nos próximos ${daysMatch ? days : 7} dias**\n\n**A receber (${money(rec.reduce((a: number, r: any) => a + r.open, 0))}):**\n${rec.slice(0, 8).map((r: any) => `- ${r.dueDate} — ${r.description}: ${money(r.open)}`).join('\n') || '- nenhuma'}\n\n**A pagar (${money(pag.reduce((a: number, r: any) => a + r.open, 0))}):**\n${pag.slice(0, 8).map((r: any) => `- ${r.dueDate} — ${r.description}: ${money(r.open)}`).join('\n') || '- nenhuma'}`;
  }
  if (/mais vendid|top produto|produto.*vend|curva abc|campe/.test(m)) {
    const rows = await run('produtos_mais_vendidos', ctx, { days, limit: 10 });
    return `🏆 **Produtos mais vendidos (${days} dias)**\n\n${rows.map((r: any, i: number) => `${i + 1}. ${r.name} — ${money(r.revenue)} (${num(r.quantity)} un, margem ${num(r.margin)}%) — classe ${r.class}`).join('\n')}`;
  }
  if (/cliente/.test(m)) {
    const rows = await run('melhores_clientes', ctx, { days: daysMatch ? days : 90 });
    return `👥 **Melhores clientes (${daysMatch ? days : 90} dias)**\n\n${rows.map((r: any, i: number) => `${i + 1}. ${r.customer} — ${money(r.total)} em ${r.orders} pedido(s)`).join('\n')}`;
  }
  if (/pedido|faturar|enviar|pendente/.test(m)) {
    const rows = await run('pedidos_pendentes', ctx);
    const by = (s: string) => rows.filter((r: any) => r.status === s);
    return `🧾 **Pedidos pendentes**\n\n- Em aberto (a faturar): **${by('ABERTO').length}** — ${money(by('ABERTO').reduce((a: number, r: any) => a + r.total, 0))}\n- Faturados aguardando separação: **${by('FATURADO').length}**\n- Separados aguardando envio: **${by('SEPARADO').length}**\n\n${by('ABERTO').slice(0, 6).map((r: any) => `- Pedido ${r.number} — ${r.customer}: ${money(r.total)}`).join('\n')}`;
  }
  if (/canal|marketplace|mercado livre|shopee|amazon/.test(m) || /vend|fatur|receita/.test(m)) {
    const v = await run('vendas_periodo', ctx, { days });
    return `💰 **Vendas — últimos ${days} dia(s)**\n\n- Faturamento: **${money(v.revenue)}**\n- Pedidos: **${v.orders}**\n- Ticket médio: **${money(v.avgTicket)}**\n\n**Por canal:**\n${v.channels.map((c: any) => `- ${c.channel}: ${money(c.revenue)} (${c.orders} pedidos, margem ${num(c.margin)}%)`).join('\n')}`;
  }
  const k = await run('resumo_negocio', ctx);
  return `📈 **Resumo do seu negócio**\n\n- Vendas hoje: **${money(k.salesToday)}** (${k.ordersToday} pedidos)\n- Vendas no mês: **${money(k.salesMonth)}** — ticket médio ${money(k.avgTicket)}, margem bruta ${num(k.grossMargin)}%\n- Pedidos em aberto: ${k.openOrders} (${money(k.openOrdersValue)})\n- A receber vencido: ${money(k.receivableOverdue)} | A pagar vencido: ${money(k.payableOverdue)}\n- Saldo em contas: **${money(k.cashBalance)}**\n- Produtos com estoque baixo: ${k.lowStockCount}\n\nPergunte, por exemplo: *"quanto vendi nos últimos 7 dias?"*, *"quais produtos estão acabando?"*, *"qual a inadimplência?"*, *"estoque da camiseta"*, *"DRE do mês"*.`;
}
