import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { createOrder } from '@/server/services/sales';
import { parseSheet } from '@/server/sheets';

/**
 * Importação de pedidos via planilha (CSV/XLSX).
 * Colunas: pedido_externo, cliente_documento, cliente_nome, sku, quantidade, preco, frete, forma_pagamento
 * Linhas com o mesmo pedido_externo formam um único pedido.
 */
export const POST = route('vendas', 'edit', async ({ ctx, req }) => {
  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) fail(400, 'Envie o arquivo');
  const rows = parseSheet(Buffer.from(await file!.arrayBuffer()), file!.name);
  const groups = new Map<string, Record<string, string>[]>();
  rows.forEach((r, i) => {
    const k = r.pedido_externo || `linha-${i}`;
    groups.set(k, [...(groups.get(k) || []), r]);
  });
  const results: { externalId: string; ok: boolean; message: string }[] = [];
  for (const [externalId, lines] of groups) {
    try {
      const first = lines[0];
      const doc = (first.cliente_documento || '').replace(/\D/g, '');
      let customer = doc ? await prisma.contact.findFirst({ where: { organizationId: ctx.orgId, document: doc } }) : null;
      if (!customer) customer = await prisma.contact.create({ data: { organizationId: ctx.orgId, types: ['CLIENTE'], personType: doc.length === 14 ? 'PJ' : 'PF', name: first.cliente_nome || 'Cliente importado', document: doc || null, email: first.cliente_email || null, city: first.cidade || null, uf: first.uf || null, zip: first.cep || null } });
      const items = [];
      for (const l of lines) {
        const p = await prisma.product.findFirst({ where: { organizationId: ctx.orgId, OR: [{ sku: l.sku }, { gtin: l.sku }] } });
        if (!p) throw new Error(`SKU não encontrado: ${l.sku}`);
        items.push({ productId: p.id, quantity: Number(String(l.quantidade).replace(',', '.')) || 1, unitPrice: l.preco ? Number(String(l.preco).replace(',', '.')) : undefined });
      }
      const o = await createOrder(ctx, { customerId: customer.id, externalId: externalId.startsWith('linha-') ? null : externalId, origin: 'IMPORTACAO', items, freight: Number(String(first.frete || 0).replace(',', '.')), paymentMethod: (first.forma_pagamento || 'BOLETO').toUpperCase() });
      results.push({ externalId, ok: true, message: `Pedido nº ${o.number} criado (${o.total.toFixed(2)})` });
    } catch (e) {
      results.push({ externalId, ok: false, message: (e as Error).message });
    }
  }
  return { imported: results.filter((r) => r.ok).length, errors: results.filter((r) => !r.ok).length, results };
});
