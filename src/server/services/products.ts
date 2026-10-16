/**
 * Cadastro de produtos: simples, variações (grade), kits, fabricados
 * (ficha técnica), matéria-prima e controle de lote.
 */
import { prisma } from '@/lib/db';
import { round2 } from '@/lib/utils';
import { buildEan13 } from '@/lib/br';
import { fail } from '../errors';
import { emit } from '../events';
import type { Ctx } from '../context';

const FIELDS = ['sku', 'name', 'kind', 'gtin', 'unit', 'ncm', 'cest', 'origin', 'brand', 'categoryId', 'price', 'costPrice', 'ipiRate', 'weight', 'width', 'height', 'length', 'controlsStock', 'controlsLot', 'minStock', 'maxStock', 'location', 'supplierId', 'imageUrl', 'description', 'active', 'featured', 'attributes'];
const NUM = ['origin', 'price', 'costPrice', 'ipiRate', 'weight', 'width', 'height', 'length', 'minStock', 'maxStock'];
const BOOL = ['controlsStock', 'controlsLot', 'active', 'featured'];

export async function saveProduct(ctx: Pick<Ctx, 'orgId' | 'companyId'>, body: Record<string, any>, id?: string) {
  const data: Record<string, any> = {};
  for (const f of FIELDS) {
    if (!(f in body)) continue;
    let v = body[f];
    if (NUM.includes(f)) v = v === '' || v == null ? 0 : Number(String(v).replace(',', '.'));
    else if (BOOL.includes(f)) v = !!v && v !== 'false';
    else if (v === '') v = null;
    data[f] = v;
  }
  if (!id && !data.sku) fail(400, 'Informe o código (SKU)');
  if (!id && !data.name) fail(400, 'Informe a descrição do produto');
  if (data.ncm) data.ncm = String(data.ncm).replace(/\D/g, '');
  if (data.gtin === 'GERAR') data.gtin = buildEan13('789' + String(Date.now()).slice(-9));
  const components = Array.isArray(body.components) ? body.components.filter((c: { componentId?: string; quantity?: number }) => c.componentId && Number(c.quantity) > 0) : null;
  if (components && (data.kind === 'KIT' || data.kind === 'FABRICADO' || !data.kind)) {
    if (components.some((c: { componentId: string }) => c.componentId === id)) fail(400, 'Um produto não pode ser componente dele mesmo');
  }
  let product: Awaited<ReturnType<typeof prisma.product.update>>;
  const prev = id ? await prisma.product.findFirst({ where: { id, organizationId: ctx.orgId } }) : null;
  if (id && !prev) fail(404, 'Produto não encontrado');
  if (id) {
    product = await prisma.product.update({ where: { id }, data });
    // Propaga preço/custo/NCM do pai para as variações
    if (prev!.kind === 'VARIACAO_PAI' && body.propagate !== false) {
      const prop: Record<string, unknown> = {};
      for (const f of ['price', 'costPrice', 'ncm', 'categoryId', 'weight', 'ipiRate', 'supplierId']) if (f in data) prop[f] = data[f];
      if (Object.keys(prop).length) await prisma.product.updateMany({ where: { parentId: id }, data: prop });
    }
  } else {
    product = await prisma.product.create({ data: { ...data, organizationId: ctx.orgId } as never });
  }
  if (components) {
    await prisma.productComponent.deleteMany({ where: { productId: product.id } });
    if (components.length) await prisma.productComponent.createMany({ data: components.map((c: { componentId: string; quantity: number }) => ({ productId: product.id, componentId: c.componentId, quantity: Number(c.quantity) })) });
    // Custo do kit/fabricado = soma dos componentes
    const comps = await prisma.productComponent.findMany({ where: { productId: product.id }, include: { component: true } });
    if (comps.length && (product.kind === 'KIT' || (product.kind === 'FABRICADO' && !product.costPrice))) {
      product = await prisma.product.update({ where: { id: product.id }, data: { costPrice: round2(comps.reduce((a, c) => a + c.quantity * c.component.costPrice, 0)) } });
    }
  }
  if (prev && (prev.price !== product.price)) {
    const children = await prisma.product.findMany({ where: { parentId: product.id }, select: { id: true } });
    await emit('product.price_changed', { companyId: ctx.companyId, orgId: ctx.orgId, productIds: [product.id, ...children.map((c) => c.id)] });
  }
  return product;
}

/** Gera as variações (produto cartesiano dos atributos) de um produto pai */
export async function generateVariations(ctx: Pick<Ctx, 'orgId' | 'companyId'>, parentId: string, attributes: Record<string, string[]>) {
  const parent = await prisma.product.findFirst({ where: { id: parentId, organizationId: ctx.orgId } });
  if (!parent) fail(404, 'Produto não encontrado');
  const attrs = Object.fromEntries(Object.entries(attributes || {}).map(([k, v]) => [k.trim(), (Array.isArray(v) ? v : String(v).split(',')).map((s) => s.trim()).filter(Boolean)]).filter(([k, v]) => k && (v as string[]).length));
  if (!Object.keys(attrs).length) fail(400, 'Informe ao menos um atributo com valores (ex.: Cor: Azul, Preto)');
  await prisma.product.update({ where: { id: parentId }, data: { kind: 'VARIACAO_PAI', attributes: attrs } });
  const combos = Object.keys(attrs).reduce<Record<string, string>[]>((acc, k) => acc.flatMap((c) => (attrs[k] as string[]).map((v) => ({ ...c, [k]: v }))), [{}]);
  let created = 0;
  for (const combo of combos) {
    const suffix = Object.values(combo).map((v) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 3).toUpperCase()).join('-');
    const sku = `${parent!.sku}-${suffix}`;
    const exists = await prisma.product.findFirst({ where: { organizationId: ctx.orgId, sku } });
    if (exists) continue;
    await prisma.product.create({
      data: {
        organizationId: ctx.orgId, sku, name: `${parent!.name} ${Object.values(combo).join(' ')}`, kind: 'VARIACAO', parentId, attributes: combo,
        unit: parent!.unit, ncm: parent!.ncm, origin: parent!.origin, brand: parent!.brand, categoryId: parent!.categoryId, price: parent!.price, costPrice: parent!.costPrice,
        ipiRate: parent!.ipiRate, weight: parent!.weight, width: parent!.width, height: parent!.height, length: parent!.length, controlsLot: parent!.controlsLot, minStock: parent!.minStock, supplierId: parent!.supplierId,
        gtin: buildEan13('789' + String(Date.now() + created).slice(-9)),
      },
    });
    created++;
  }
  return { created, total: combos.length };
}
