import { prisma } from '@/lib/db';
import { route, fileResponse } from '@/server/http';
import { fail } from '@/server/errors';
import { parseSheet } from '@/server/sheets';
import { onlyDigits } from '@/lib/utils';
import { isValidCNPJ, isValidCPF } from '@/lib/br';
import { moveStock } from '@/server/services/stock';
import { emit } from '@/server/events';

const TEMPLATES: Record<string, string> = {
  produtos: 'sku;nome;preco;custo;unidade;ncm;gtin;categoria;estoque_minimo;peso;estoque_inicial\nCAM-NOVA-01;Camiseta Nova Coleção;79,90;30,00;UN;61091000;;Camisetas;5;0,2;20\n',
  clientes: 'nome;tipo_pessoa;documento;email;telefone;cep;endereco;numero;bairro;cidade;uf;limite_credito\nMaria da Silva;PF;52998224725;maria@email.com;(11) 99999-0000;01310100;Av. Paulista;1000;Bela Vista;São Paulo;SP;2000\n',
  fornecedores: 'nome;documento;email;telefone;cidade;uf\nFornecedor Exemplo Ltda;11222333000181;vendas@fornecedor.com;(11) 3000-0000;São Paulo;SP\n',
  estoque: 'sku;quantidade;deposito\nCAM-NOVA-01;50;Depósito Principal\n',
  pedidos: 'pedido_externo;cliente_documento;cliente_nome;sku;quantidade;preco;frete;forma_pagamento\nPED-1001;52998224725;Maria da Silva;CAM-BAS-BRA-M;2;59,90;15,00;PIX\n',
};
const n = (v: string) => (v ? Number(String(v).replace(/\./g, '').replace(',', '.')) || 0 : 0);
const nf = (v: string) => (v ? Number(String(v).replace(',', '.')) || 0 : 0);

export const GET = route('cadastros', 'view', async ({ params }) => {
  const t = TEMPLATES[params.entity];
  if (!t) fail(404, 'Modelo não encontrado');
  return fileResponse('﻿' + t, 'text/csv; charset=utf-8', `modelo-${params.entity}.csv`, false);
});

/** Importação via planilha CSV/XLSX — retorna relatório por linha */
export const POST = route('cadastros', 'edit', async ({ ctx, params, req }) => {
  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) fail(400, 'Envie o arquivo');
  const rows = parseSheet(Buffer.from(await file!.arrayBuffer()), file!.name);
  const results: { line: number; ok: boolean; message: string }[] = [];
  const changed: string[] = [];
  for (const [i, r] of rows.entries()) {
    const line = i + 2;
    try {
      if (params.entity === 'produtos') {
        if (!r.sku || !r.nome) throw new Error('SKU e nome são obrigatórios');
        let categoryId: string | null = null;
        if (r.categoria) categoryId = ((await prisma.category.findFirst({ where: { organizationId: ctx.orgId, name: r.categoria } })) || (await prisma.category.create({ data: { organizationId: ctx.orgId, name: r.categoria } }))).id;
        const data = { name: r.nome, price: nf(r.preco), costPrice: nf(r.custo), unit: r.unidade || 'UN', ncm: onlyDigits(r.ncm) || null, gtin: r.gtin || null, categoryId, minStock: nf(r.estoque_minimo), weight: nf(r.peso) || 0.3 };
        const p = await prisma.product.upsert({ where: { organizationId_sku: { organizationId: ctx.orgId, sku: r.sku } }, create: { organizationId: ctx.orgId, sku: r.sku, ...data }, update: data });
        if (nf(r.estoque_inicial) > 0) changed.push(...(await moveStock(prisma, { companyId: ctx.companyId, productId: p.id, quantity: nf(r.estoque_inicial), direction: 'IN', origin: 'INVENTARIO', notes: 'Importação de planilha', userName: ctx.userName })));
        results.push({ line, ok: true, message: `Produto ${r.sku} importado` });
      } else if (params.entity === 'clientes' || params.entity === 'fornecedores') {
        if (!r.nome) throw new Error('Nome obrigatório');
        const doc = onlyDigits(r.documento);
        if (doc && !(doc.length === 11 ? isValidCPF(doc) : isValidCNPJ(doc))) throw new Error(`Documento inválido: ${r.documento}`);
        const type = params.entity === 'clientes' ? 'CLIENTE' : 'FORNECEDOR';
        const existing = doc ? await prisma.contact.findFirst({ where: { organizationId: ctx.orgId, document: doc } }) : null;
        const data = { name: r.nome, personType: r.tipo_pessoa || (doc.length === 14 ? 'PJ' : 'PF'), document: doc || null, email: r.email || null, phone: r.telefone || null, zip: onlyDigits(r.cep) || null, street: r.endereco || null, number: r.numero || null, district: r.bairro || null, city: r.cidade || null, uf: r.uf || null, creditLimit: n(r.limite_credito) };
        if (existing) await prisma.contact.update({ where: { id: existing.id }, data: { ...data, types: [...new Set([...existing.types, type])] } });
        else await prisma.contact.create({ data: { organizationId: ctx.orgId, types: [type], ...data } });
        results.push({ line, ok: true, message: `${existing ? 'Atualizado' : 'Criado'}: ${r.nome}` });
      } else if (params.entity === 'estoque') {
        const p = await prisma.product.findFirst({ where: { organizationId: ctx.orgId, sku: r.sku } });
        if (!p) throw new Error(`SKU não encontrado: ${r.sku}`);
        const wh = r.deposito ? await prisma.warehouse.findFirst({ where: { companyId: ctx.companyId, name: r.deposito } }) : null;
        changed.push(...(await moveStock(prisma, { companyId: ctx.companyId, productId: p.id, warehouseId: wh?.id, quantity: nf(r.quantidade), direction: nf(r.quantidade) >= 0 ? 'IN' : 'OUT', origin: 'INVENTARIO', notes: 'Importação de planilha', userName: ctx.userName })));
        results.push({ line, ok: true, message: `Estoque de ${r.sku}: ${r.quantidade}` });
      } else fail(404, 'Tipo de importação inválido');
    } catch (e) {
      results.push({ line, ok: false, message: (e as Error).message });
    }
  }
  if (changed.length) await emit('stock.changed', { companyId: ctx.companyId, orgId: ctx.orgId, productIds: [...new Set(changed)] });
  return { total: rows.length, imported: results.filter((r) => r.ok).length, errors: results.filter((r) => !r.ok).length, results };
});
