/**
 * Motor de automações.
 * Cada automação reage a um evento de domínio e executa uma ação real no
 * sistema (estoque, financeiro, fiscal, logística, canais...). Podem ser
 * ativadas/desativadas por empresa em Automações. Toda execução é registrada.
 */
import { prisma } from '@/lib/db';
import { addDays, round2 } from '@/lib/utils';
import type { DomainEvent, EventPayload } from '../events';
import { emit } from '../events';
import {
  reserveOrder, postOrderStock, postOrderFinancial, postCommission, releaseOrderReservation, reverseOrderStock,
  reverseOrderFinancial, convertQuote, setOrderStatus, invoiceOrder, type Actor,
} from './sales';
import { createShipment } from './logistics';
import { postPurchaseStock, postPurchaseFinancial, updateCostsFromPurchase, savePurchase } from './purchases';
import { syncListings } from './integrations';
import { getAvailability } from './stock';
import { notify } from './notify';
import { payEntry } from './finance';

type Handler = (p: EventPayload, actor: Actor) => Promise<string | void>;
export type AutomationDef = { key: string; name: string; description: string; event: DomainEvent; group: string; defaultActive?: boolean; when?: (p: EventPayload) => boolean; run: Handler };

const str = (v: unknown) => String(v ?? '');

export const AUTOMATIONS: AutomationDef[] = [
  // ---------------- Vendas ----------------
  {
    key: 'RESERVAR_ESTOQUE_PEDIDO', group: 'Vendas', event: 'order.created', name: 'Reservar estoque ao criar pedido',
    description: 'Ao incluir um pedido de venda (manual, loja, marketplace ou API), reserva automaticamente o estoque dos itens.',
    when: (p) => p.origin !== 'PDV',
    run: async (p, a) => {
      const changed = await reserveOrder(a, str(p.orderId));
      if (changed.length) await emit('stock.changed', { ...p, productIds: changed });
      return `${changed.length} produto(s) reservado(s)`;
    },
  },
  {
    key: 'FATURAR_PEDIDO_MARKETPLACE', group: 'Vendas', event: 'order.created', name: 'Emitir NF-e automaticamente para pedidos de marketplace', defaultActive: false,
    description: 'Pedidos importados dos canais de venda são faturados (NF-e emitida) assim que chegam.',
    when: (p) => p.origin === 'INTEGRACAO',
    run: async (p, a) => {
      const r = await invoiceOrder(a, str(p.orderId));
      return `NF-e ${r.invoices[0]?.number} — ${r.invoices[0]?.status}`;
    },
  },
  {
    key: 'PDV_EMITIR_NFCE', group: 'Vendas', event: 'pdv.sale', name: 'Emitir NFC-e ao finalizar venda no PDV',
    description: 'Cada venda finalizada na frente de caixa gera e transmite a NFC-e (modelo 65).',
    run: async (p, a) => {
      const r = await invoiceOrder(a, str(p.orderId), { model: 'NFCE' });
      return `NFC-e nº ${r.invoices[0]?.number} ${r.invoices[0]?.status}`;
    },
  },
  {
    key: 'BAIXAR_ESTOQUE_FATURAMENTO', group: 'Vendas', event: 'order.invoiced', name: 'Baixar estoque ao faturar',
    description: 'Ao faturar o pedido (NF autorizada), consome a reserva e lança a saída de estoque.',
    run: async (p, a) => {
      const changed = await postOrderStock(a, str(p.orderId));
      if (changed.length) await emit('stock.changed', { ...p, productIds: changed });
      return `Saída de estoque de ${changed.length} produto(s)`;
    },
  },
  {
    key: 'CONTAS_RECEBER_FATURAMENTO', group: 'Financeiro', event: 'order.invoiced', name: 'Lançar contas a receber ao faturar',
    description: 'Gera as parcelas no contas a receber conforme a condição de pagamento (com boleto/Pix quando aplicável).',
    run: async (p, a) => {
      const e = await postOrderFinancial(a, str(p.orderId));
      return `${e.length} parcela(s) lançada(s)`;
    },
  },
  {
    key: 'CALCULAR_COMISSAO', group: 'Vendas', event: 'order.invoiced', name: 'Calcular comissão do vendedor',
    description: 'Calcula a comissão conforme o percentual do vendedor (liberada no faturamento ou no recebimento).',
    run: async (p, a) => {
      const c = await postCommission(a, str(p.orderId));
      return c ? `Comissão R$ ${c.amount.toFixed(2)} (${c.status})` : 'Pedido sem vendedor/comissão';
    },
  },
  {
    key: 'GERAR_ETIQUETA_FATURAMENTO', group: 'Logística', event: 'order.invoiced', name: 'Gerar etiqueta de envio ao faturar',
    description: 'Cota o frete, escolhe a melhor opção e gera a etiqueta com código de rastreio.',
    run: async (p, a) => {
      const s = await createShipment(a, str(p.orderId));
      return s ? `Etiqueta ${s.carrier} ${s.service} - ${s.trackingCode}` : 'Pedido sem envio (balcão/serviço)';
    },
  },
  {
    key: 'CANCELAMENTO_ESTOQUE', group: 'Vendas', event: 'order.cancelled', name: 'Liberar reserva / estornar estoque ao cancelar',
    description: 'Pedido cancelado devolve a reserva ou estorna a saída de estoque já lançada.',
    run: async (p, a) => {
      const changed = [...(await releaseOrderReservation(a, str(p.orderId))), ...(await reverseOrderStock(a, str(p.orderId)))];
      if (changed.length) await emit('stock.changed', { ...p, productIds: changed });
      return `${changed.length} produto(s) devolvido(s) ao estoque`;
    },
  },
  {
    key: 'CANCELAMENTO_FINANCEIRO', group: 'Financeiro', event: 'order.cancelled', name: 'Cancelar contas e comissões do pedido cancelado',
    description: 'Cancela as parcelas em aberto e as comissões vinculadas ao pedido.',
    run: async (p, a) => `${await reverseOrderFinancial(a, str(p.orderId))} lançamento(s) cancelado(s)`,
  },
  {
    key: 'CONVERTER_PROPOSTA_APROVADA', group: 'Vendas', event: 'quote.approved', name: 'Converter proposta aprovada em pedido',
    description: 'Quando o cliente aprova a proposta comercial, um pedido de venda é criado automaticamente.',
    run: async (p, a) => {
      const o = await convertQuote(a, str(p.quoteId));
      return `Pedido nº ${o?.number} criado`;
    },
  },
  {
    key: 'GERAR_ETIQUETA_SEPARACAO', group: 'Logística', event: 'order.separated', name: 'Gerar etiqueta após conferência (packing)',
    description: 'Ao concluir a conferência de embalagem, garante que o pedido possui etiqueta de envio.',
    run: async (p, a) => {
      const s = await createShipment(a, str(p.orderId));
      return s ? `Etiqueta ${s.trackingCode}` : 'Sem envio';
    },
  },
  // ---------------- Compras / estoque ----------------
  {
    key: 'ENTRADA_ESTOQUE_COMPRA', group: 'Compras', event: 'purchase.received', name: 'Dar entrada no estoque ao receber compra',
    description: 'Lança a entrada dos itens recebidos (com lote/validade e rateio de frete no custo).',
    run: async (p, a) => {
      const changed = await postPurchaseStock(a, str(p.purchaseId));
      if (changed.length) await emit('stock.changed', { ...p, productIds: changed });
      return `Entrada de ${changed.length} produto(s)`;
    },
  },
  {
    key: 'CONTAS_PAGAR_COMPRA', group: 'Financeiro', event: 'purchase.received', name: 'Lançar contas a pagar ao receber compra',
    description: 'Gera as parcelas a pagar ao fornecedor (usa as duplicatas do XML quando houver).',
    run: async (p, a) => `${(await postPurchaseFinancial(a, str(p.purchaseId))).length} parcela(s) a pagar`,
  },
  {
    key: 'CUSTO_MEDIO_COMPRA', group: 'Compras', event: 'purchase.received', name: 'Atualizar custo médio dos produtos',
    description: 'Recalcula o custo médio ponderado de cada produto após o recebimento.',
    run: async (p, a) => `${(await updateCostsFromPurchase(a, str(p.purchaseId))).length} custo(s) atualizado(s)`,
  },
  {
    key: 'SINCRONIZAR_ESTOQUE_CANAIS', group: 'Integrações', event: 'stock.changed', name: 'Sincronizar estoque com os canais em tempo real',
    description: 'Toda alteração de estoque é enviada aos anúncios dos marketplaces e lojas conectadas.',
    run: async (p, a) => `${await syncListings(a, { productIds: (p.productIds as string[]) || undefined })} anúncio(s) atualizado(s)`,
  },
  {
    key: 'ALERTA_ESTOQUE_MINIMO', group: 'Estoque', event: 'stock.changed', name: 'Alertar estoque abaixo do mínimo',
    description: 'Notifica quando o saldo disponível de um produto fica abaixo do estoque mínimo.',
    run: async (p, a) => {
      const low = await belowMinimum(a, (p.productIds as string[]) || []);
      for (const l of low) await notify(a.companyId, 'Estoque baixo', `${l.sku} - ${l.name}: disponível ${l.available} (mínimo ${l.minStock})`, { level: 'warning', link: '/estoque' });
      return `${low.length} alerta(s)`;
    },
  },
  {
    key: 'REPOSICAO_AUTOMATICA', group: 'Compras', event: 'stock.changed', name: 'Sugerir pedido de compra (reposição automática)',
    description: 'Cria um pedido de compra em aberto para o fornecedor padrão quando o produto atinge o mínimo.',
    run: async (p, a) => {
      const low = (await belowMinimum(a, (p.productIds as string[]) || [])).filter((l) => l.supplierId);
      let created = 0;
      for (const l of low) {
        const open = await prisma.purchaseOrderItem.findFirst({ where: { productId: l.id, purchaseOrder: { companyId: a.companyId, status: { in: ['ABERTO', 'ENVIADO', 'EM_CONFERENCIA'] } } } });
        if (open) continue;
        const qty = Math.max((l.maxStock || l.minStock * 3) - l.available, l.minStock);
        await savePurchase(a, { supplierId: l.supplierId!, items: [{ productId: l.id, quantity: Math.ceil(qty), unitCost: l.costPrice }], notes: 'Gerado automaticamente pela reposição de estoque mínimo', autoGenerated: true });
        created++;
      }
      if (created) await notify(a.companyId, 'Reposição automática', `${created} pedido(s) de compra sugerido(s)`, { level: 'info', link: '/compras' });
      return `${created} pedido(s) de compra sugerido(s)`;
    },
  },
  {
    key: 'SINCRONIZAR_PRECO_CANAIS', group: 'Integrações', event: 'product.price_changed', name: 'Sincronizar preço com os canais',
    description: 'Alterações de preço do produto (ou da lista de preço do canal) são enviadas aos anúncios.',
    run: async (p, a) => `${await syncListings(a, { productIds: (p.productIds as string[]) || undefined, prices: true })} anúncio(s) atualizado(s)`,
  },
  // ---------------- Logística ----------------
  {
    key: 'PEDIDO_ENVIADO_POSTAGEM', group: 'Logística', event: 'shipment.posted', name: 'Marcar pedido como enviado na postagem',
    description: 'Quando a transportadora registra a postagem, o pedido muda para "Enviado".',
    run: async (p, a) => {
      await setOrderStatus(a, str(p.orderId), 'ENVIADO');
      return 'Pedido enviado';
    },
  },
  {
    key: 'NOTIFICAR_RASTREIO', group: 'Logística', event: 'shipment.posted', name: 'Enviar código de rastreio ao cliente',
    description: 'Envia e-mail (simulado) ao cliente com o código de rastreio e o link de acompanhamento.',
    run: async (p) => {
      const s = await prisma.shipment.findUnique({ where: { id: str(p.shipmentId) }, include: { salesOrder: { include: { customer: true } } } });
      return `E-mail simulado para ${s?.salesOrder.customer.email || 'cliente'}: rastreio ${s?.trackingCode}`;
    },
  },
  {
    key: 'PEDIDO_ENTREGUE', group: 'Logística', event: 'shipment.delivered', name: 'Marcar pedido como entregue',
    description: 'Ao receber o evento de entrega da transportadora, conclui o pedido como "Entregue".',
    run: async (p, a) => {
      await setOrderStatus(a, str(p.orderId), 'ENTREGUE');
      return 'Pedido entregue';
    },
  },
  // ---------------- Fiscal ----------------
  {
    key: 'ENVIAR_DANFE_CLIENTE', group: 'Fiscal', event: 'invoice.authorized', name: 'Enviar DANFE e XML ao cliente e ao contador',
    description: 'Após a autorização, envia (simulado) o DANFE/XML por e-mail ao cliente e ao Portal do Contador.',
    run: async (p) => {
      const inv = await prisma.invoice.findUnique({ where: { id: str(p.invoiceId) } });
      const c = inv?.customerId ? await prisma.contact.findUnique({ where: { id: inv.customerId } }) : null;
      return `${inv?.model} ${inv?.number}: e-mail simulado para ${c?.email || 'consumidor'} e contabilidade`;
    },
  },
  // ---------------- Financeiro ----------------
  {
    key: 'LIBERAR_COMISSAO_RECEBIMENTO', group: 'Financeiro', event: 'receivable.paid', name: 'Liberar comissão no recebimento',
    description: 'Para vendedores com comissão por recebimento, libera a comissão quando todas as parcelas forem pagas.',
    when: (p) => ['VENDA', 'LOJA', 'INTEGRACAO', 'PDV'].includes(str(p.origin)),
    run: async (p, a) => {
      const orderId = str(p.originId);
      const open = await prisma.financialEntry.count({ where: { companyId: a.companyId, originId: orderId, type: 'RECEBER', status: { in: ['ABERTO', 'PARCIAL'] } } });
      if (open) return `${open} parcela(s) ainda em aberto`;
      const r = await prisma.commission.updateMany({ where: { salesOrderId: orderId, status: 'PENDENTE' }, data: { status: 'LIBERADA', releasedAt: new Date() } });
      return `${r.count} comissão(ões) liberada(s)`;
    },
  },
  {
    key: 'BAIXA_LINK_PAGAMENTO', group: 'Financeiro', event: 'payment_link.paid', name: 'Baixar conta ao receber Pix/link de pagamento',
    description: 'Pagamentos confirmados de Pix, boleto ou link de pagamento quitam automaticamente a conta a receber vinculada.',
    run: async (p, a) => {
      const link = await prisma.paymentLink.findUnique({ where: { id: str(p.linkId) } });
      if (!link?.entryId) return 'Link sem conta vinculada';
      const entry = await prisma.financialEntry.findUnique({ where: { id: link.entryId } });
      if (!entry || entry.status === 'PAGO') return 'Conta já quitada';
      await payEntry(a.companyId, a.orgId, link.entryId, { method: link.paidMethod || 'PIX', transactionSource: link.paidMethod === 'BOLETO' ? 'BOLETO' : 'PIX' });
      return `Conta "${entry.description}" quitada`;
    },
  },
  {
    key: 'COBRANCA_VENCIDOS', group: 'Financeiro', event: 'daily.routine', name: 'Régua de cobrança de contas vencidas',
    description: 'Rotina diária: notifica e envia lembrete (simulado) aos clientes com contas vencidas.',
    run: async (_p, a) => {
      const overdue = await prisma.financialEntry.findMany({ where: { companyId: a.companyId, type: 'RECEBER', status: { in: ['ABERTO', 'PARCIAL'] }, dueDate: { lt: new Date(new Date().toDateString()) } } });
      if (overdue.length) {
        const total = round2(overdue.reduce((s, e) => s + e.amount - e.paidAmount, 0));
        await notify(a.companyId, 'Contas vencidas', `${overdue.length} conta(s) a receber vencida(s) — R$ ${total.toFixed(2)}. Lembretes enviados (simulado).`, { level: 'error', link: '/financeiro/receber?status=VENCIDO' });
      }
      return `${overdue.length} lembrete(s) de cobrança`;
    },
  },
  {
    key: 'CONTAS_A_PAGAR_HOJE', group: 'Financeiro', event: 'daily.routine', name: 'Avisar contas a pagar do dia',
    description: 'Rotina diária: avisa as contas a pagar que vencem hoje.',
    run: async (_p, a) => {
      const today = new Date(new Date().toDateString());
      const n = await prisma.financialEntry.count({ where: { companyId: a.companyId, type: 'PAGAR', status: { in: ['ABERTO', 'PARCIAL'] }, dueDate: { gte: today, lt: addDays(today, 1) } } });
      if (n) await notify(a.companyId, 'Contas a pagar hoje', `${n} conta(s) vencem hoje`, { level: 'warning', link: '/financeiro/pagar' });
      return `${n} conta(s) vencendo hoje`;
    },
  },
  {
    key: 'LOTES_VENCENDO', group: 'Estoque', event: 'daily.routine', name: 'Alertar lotes próximos do vencimento',
    description: 'Rotina diária: lotes com validade nos próximos 30 dias geram alerta.',
    run: async (_p, a) => {
      const lots = await prisma.productLot.findMany({ where: { quantity: { gt: 0 }, expiresAt: { lte: addDays(new Date(), 30) }, product: { organizationId: a.orgId } }, include: { product: true } });
      for (const l of lots.slice(0, 10)) await notify(a.companyId, 'Lote vencendo', `${l.product.name} lote ${l.lotNumber} vence em ${l.expiresAt?.toLocaleDateString('pt-BR')} (${l.quantity} un)`, { level: 'warning', link: '/estoque/lotes' });
      return `${lots.length} lote(s) próximos do vencimento`;
    },
  },
  // ---------------- Produção / OS / cadastros ----------------
  {
    key: 'VERIFICAR_MATERIA_PRIMA', group: 'Produção', event: 'production.started', name: 'Verificar matéria-prima ao iniciar produção',
    description: 'Ao iniciar uma OP, verifica a disponibilidade dos componentes e alerta faltas.',
    run: async (p, a) => {
      const op = await prisma.productionOrder.findUnique({ where: { id: str(p.productionOrderId) }, include: { items: true } });
      const avail = await getAvailability(prisma, a, op!.items.map((i) => i.componentId));
      const missing = op!.items.filter((i) => (avail.get(i.componentId)?.available ?? 0) < i.requiredQty);
      if (missing.length) await notify(a.companyId, `OP ${op!.number}: matéria-prima insuficiente`, missing.map((m) => m.description).join(', '), { level: 'warning', link: '/producao' });
      return missing.length ? `${missing.length} componente(s) insuficiente(s)` : 'Matéria-prima disponível';
    },
  },
  {
    key: 'CUSTO_PRODUCAO', group: 'Produção', event: 'production.finished', name: 'Atualizar custo do produto acabado',
    description: 'Ao finalizar a OP, atualiza o custo do produto com o custo real apurado na produção.',
    run: async (p) => {
      const op = await prisma.productionOrder.findUnique({ where: { id: str(p.productionOrderId) } });
      if (!op || !p.unitCost) return 'Sem custo';
      await prisma.product.update({ where: { id: op.productId }, data: { costPrice: Number(p.unitCost) } });
      return `Custo atualizado para R$ ${Number(p.unitCost).toFixed(2)}`;
    },
  },
  {
    key: 'OS_CONCLUIDA_AVISO', group: 'Serviços', event: 'service_order.finished', name: 'Avisar cliente quando a OS for concluída',
    description: 'Envia mensagem (simulada) ao cliente avisando que o equipamento/serviço está pronto.',
    run: async (p, a) => {
      const os = await prisma.serviceOrder.findUnique({ where: { id: str(p.serviceOrderId) }, include: { customer: true } });
      await notify(a.companyId, `OS ${os?.number} concluída`, `Cliente ${os?.customer.name} avisado (WhatsApp/e-mail simulado)`, { level: 'success', link: '/servicos' });
      return `Aviso enviado para ${os?.customer.mobile || os?.customer.email || 'cliente'}`;
    },
  },
  {
    key: 'BOAS_VINDAS_CLIENTE', group: 'Cadastros', event: 'contact.created', name: 'E-mail de boas-vindas para novo cliente',
    description: 'Novo cliente cadastrado recebe e-mail de boas-vindas (simulado).',
    run: async (p) => `E-mail de boas-vindas simulado para ${str(p.email) || 'cliente sem e-mail'}`,
  },
];

async function belowMinimum(a: Actor, productIds: string[]) {
  if (!productIds.length) return [];
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, minStock: { gt: 0 }, controlsStock: true, kind: { notIn: ['KIT', 'VARIACAO_PAI'] } } });
  if (!products.length) return [];
  const avail = await getAvailability(prisma, a, products.map((p) => p.id));
  return products.map((p) => ({ ...p, available: avail.get(p.id)?.available ?? 0 })).filter((p) => p.available < p.minStock);
}

/** Executa as automações ativas para o evento */
export async function runAutomations(event: DomainEvent, payload: EventPayload) {
  const defs = AUTOMATIONS.filter((d) => d.event === event && (!d.when || d.when(payload)));
  if (!defs.length) return;
  const rows = await prisma.automation.findMany({ where: { companyId: payload.companyId, key: { in: defs.map((d) => d.key) } } });
  const actor: Actor = { companyId: payload.companyId, orgId: payload.orgId, userName: payload.userName || 'Automação' };
  for (const d of defs) {
    const row = rows.find((r) => r.key === d.key);
    const active = row ? row.active : d.defaultActive !== false;
    if (!active) continue;
    const entityId = str(payload.orderId || payload.purchaseId || payload.invoiceId || payload.shipmentId || payload.quoteId || payload.entryId || payload.productionOrderId || payload.serviceOrderId || '') || null;
    try {
      const msg = (await d.run(payload, actor)) || 'Executada';
      await prisma.automationLog.create({ data: { companyId: payload.companyId, key: d.key, event, entityId, success: true, message: msg } });
    } catch (e) {
      await prisma.automationLog.create({ data: { companyId: payload.companyId, key: d.key, event, entityId, success: false, message: (e as Error).message } });
    }
    await prisma.automation.upsert({
      where: { companyId_key: { companyId: payload.companyId, key: d.key } },
      create: { companyId: payload.companyId, key: d.key, active: d.defaultActive !== false, runs: 1, lastRunAt: new Date() },
      update: { runs: { increment: 1 }, lastRunAt: new Date() },
    });
  }
}

/** Rotina diária (executada no 1º acesso do dia ou manualmente) */
export async function runDailyRoutine(actor: Actor, force = false) {
  const today = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const seq = await prisma.sequence.findUnique({ where: { companyId_key: { companyId: actor.companyId, key: 'DAILY_ROUTINE' } } });
  if (!force && seq?.value === today) return false;
  await prisma.sequence.upsert({ where: { companyId_key: { companyId: actor.companyId, key: 'DAILY_ROUTINE' } }, create: { companyId: actor.companyId, key: 'DAILY_ROUTINE', value: today }, update: { value: today } });
  await emit('daily.routine', { ...actor });
  return true;
}
