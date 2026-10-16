/**
 * Serviço de estoque: movimentações (entrada/saída/ajuste/transferência),
 * reservas, lotes (FEFO), kits (baixa dos componentes) e saldo disponível
 * considerando o modo de estoque da organização (unificado/separado).
 */
import type { Db } from '@/lib/db';
import { prisma } from '@/lib/db';
import { round2, round3 } from '@/lib/utils';
import { fail } from '../errors';

export type StockScope = { orgId: string; companyId: string; stockMode?: string };

export async function getDefaultWarehouse(db: Db, companyId: string) {
  const wh =
    (await db.warehouse.findFirst({ where: { companyId, isDefault: true, active: true } })) ||
    (await db.warehouse.findFirst({ where: { companyId, active: true }, orderBy: { name: 'asc' } }));
  if (!wh) fail(400, 'Nenhum depósito cadastrado para a empresa. Cadastre um em Estoque > Depósitos.');
  return wh!;
}

export type MoveInput = {
  companyId: string;
  productId: string;
  warehouseId?: string | null;
  /** quantidade positiva */
  quantity: number;
  direction: 'IN' | 'OUT';
  type?: string;
  origin?: string;
  originId?: string | null;
  originLabel?: string | null;
  unitCost?: number;
  lotNumber?: string | null;
  expiresAt?: Date | null;
  notes?: string | null;
  userName?: string | null;
};

/**
 * Movimenta o estoque. Retorna a lista de produtos afetados (para disparar
 * `stock.changed`). Kits são explodidos nos componentes.
 */
export async function moveStock(db: Db, input: MoveInput, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  const qty = round3(Math.abs(input.quantity));
  if (!qty) return [];
  const product = await db.product.findUnique({ where: { id: input.productId }, include: { components: true } });
  if (!product) fail(404, 'Produto não encontrado');
  const p = product!;

  if (p.kind === 'KIT') {
    const changed: string[] = [];
    for (const c of p.components) {
      changed.push(
        ...(await moveStock(
          db,
          { ...input, productId: c.componentId, quantity: qty * c.quantity, notes: `${input.notes || ''} (componente do kit ${p.sku})`.trim(), lotNumber: null },
          depth + 1,
        )),
      );
    }
    return [...changed, p.id];
  }
  if (!p.controlsStock || p.kind === 'VARIACAO_PAI') return [];

  const warehouseId = input.warehouseId || (await getDefaultWarehouse(db, input.companyId)).id;
  const bal = await db.stockBalance.upsert({
    where: { productId_warehouseId: { productId: p.id, warehouseId } },
    create: { productId: p.id, warehouseId, quantity: 0, reserved: 0, avgCost: p.costPrice },
    update: {},
  });

  const signed = input.direction === 'IN' ? qty : -qty;
  const newQty = round3(bal.quantity + signed);
  let avgCost = bal.avgCost || p.costPrice;
  if (input.direction === 'IN' && input.unitCost && input.unitCost > 0) {
    const base = Math.max(bal.quantity, 0);
    avgCost = round2((base * avgCost + qty * input.unitCost) / (base + qty));
  }
  await db.stockBalance.update({ where: { id: bal.id }, data: { quantity: newQty, avgCost } });

  const type = input.type || (input.direction === 'IN' ? 'ENTRADA' : 'SAIDA');
  const common = {
    companyId: input.companyId,
    productId: p.id,
    warehouseId,
    type,
    unitCost: input.unitCost ?? avgCost,
    origin: input.origin || 'MANUAL',
    originId: input.originId || null,
    originLabel: input.originLabel || null,
    notes: input.notes || null,
    userName: input.userName || null,
  };

  // Controle de lotes
  if (p.controlsLot) {
    if (input.direction === 'IN') {
      const lotNumber = input.lotNumber || `L${new Date().toISOString().slice(2, 10).replace(/-/g, '')}`;
      await db.productLot.upsert({
        where: { productId_warehouseId_lotNumber: { productId: p.id, warehouseId, lotNumber } },
        create: { productId: p.id, warehouseId, lotNumber, quantity: qty, expiresAt: input.expiresAt || null, manufacturedAt: new Date() },
        update: { quantity: { increment: qty }, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}) },
      });
      await db.stockMovement.create({ data: { ...common, quantity: qty, balanceAfter: newQty, lotNumber } });
    } else {
      // FEFO: primeiro o lote que vence primeiro (ou o lote indicado)
      let remaining = qty;
      let running = bal.quantity;
      const lots = await db.productLot.findMany({
        where: { productId: p.id, warehouseId, quantity: { gt: 0 }, ...(input.lotNumber ? { lotNumber: input.lotNumber } : {}) },
        orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
      });
      for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(lot.quantity, remaining);
        await db.productLot.update({ where: { id: lot.id }, data: { quantity: round3(lot.quantity - take) } });
        running = round3(running - take);
        await db.stockMovement.create({ data: { ...common, quantity: -take, balanceAfter: running, lotNumber: lot.lotNumber } });
        remaining = round3(remaining - take);
      }
      if (remaining > 0) {
        running = round3(running - remaining);
        await db.stockMovement.create({ data: { ...common, quantity: -remaining, balanceAfter: running, notes: `${common.notes || ''} (sem lote disponível)`.trim() } });
      }
    }
  } else {
    await db.stockMovement.create({ data: { ...common, quantity: signed, balanceAfter: newQty } });
  }
  return [p.id, ...(p.parentId ? [p.parentId] : [])];
}

/** Ajuste de inventário: define o saldo final do depósito */
export async function adjustStock(db: Db, p: { companyId: string; productId: string; warehouseId: string; newQuantity: number; notes?: string; userName?: string }) {
  const bal = await db.stockBalance.findUnique({ where: { productId_warehouseId: { productId: p.productId, warehouseId: p.warehouseId } } });
  const current = bal?.quantity ?? 0;
  const diff = round3(p.newQuantity - current);
  if (!diff) return [];
  return moveStock(db, {
    companyId: p.companyId,
    productId: p.productId,
    warehouseId: p.warehouseId,
    quantity: Math.abs(diff),
    direction: diff > 0 ? 'IN' : 'OUT',
    type: 'AJUSTE',
    origin: 'INVENTARIO',
    notes: p.notes || `Ajuste de inventário: ${current} → ${p.newQuantity}`,
    userName: p.userName,
  });
}

export async function transferStock(
  db: Db,
  p: { companyId: string; productId: string; fromWarehouseId: string; toWarehouseId: string; quantity: number; notes?: string; userName?: string },
) {
  if (p.fromWarehouseId === p.toWarehouseId) fail(400, 'Depósitos de origem e destino devem ser diferentes');
  const to = await db.warehouse.findUnique({ where: { id: p.toWarehouseId } });
  const from = await db.warehouse.findUnique({ where: { id: p.fromWarehouseId } });
  const a = await moveStock(db, {
    companyId: from!.companyId,
    productId: p.productId,
    warehouseId: p.fromWarehouseId,
    quantity: p.quantity,
    direction: 'OUT',
    type: 'TRANSFERENCIA_SAIDA',
    origin: 'TRANSFERENCIA',
    notes: p.notes || `Transferência para ${to?.name}`,
    userName: p.userName,
  });
  const b = await moveStock(db, {
    companyId: to!.companyId,
    productId: p.productId,
    warehouseId: p.toWarehouseId,
    quantity: p.quantity,
    direction: 'IN',
    type: 'TRANSFERENCIA_ENTRADA',
    origin: 'TRANSFERENCIA',
    notes: p.notes || `Transferência de ${from?.name}`,
    userName: p.userName,
  });
  return [...a, ...b];
}

/** Reserva (ou libera, com quantidade negativa) estoque de um produto; kits reservam componentes */
export async function reserveStock(db: Db, companyId: string, productId: string, warehouseId: string | null | undefined, quantity: number, depth = 0): Promise<string[]> {
  if (depth > 3 || !quantity) return [];
  const p = await db.product.findUnique({ where: { id: productId }, include: { components: true } });
  if (!p) return [];
  if (p.kind === 'KIT') {
    const out: string[] = [p.id];
    for (const c of p.components) out.push(...(await reserveStock(db, companyId, c.componentId, warehouseId, quantity * c.quantity, depth + 1)));
    return out;
  }
  if (!p.controlsStock || p.kind === 'VARIACAO_PAI') return [];
  const whId = warehouseId || (await getDefaultWarehouse(db, companyId)).id;
  const bal = await db.stockBalance.upsert({
    where: { productId_warehouseId: { productId, warehouseId: whId } },
    create: { productId, warehouseId: whId, quantity: 0, reserved: 0, avgCost: p.costPrice },
    update: {},
  });
  await db.stockBalance.update({ where: { id: bal.id }, data: { reserved: Math.max(0, round3(bal.reserved + quantity)) } });
  return [p.id, ...(p.parentId ? [p.parentId] : [])];
}

export type Availability = { quantity: number; reserved: number; available: number };

/**
 * Saldo físico, reservado e disponível por produto.
 * - SEPARADO: soma apenas depósitos da empresa informada
 * - UNIFICADO: soma depósitos de todas as empresas da organização
 * Kits: menor quantidade montável a partir dos componentes. Variação pai: soma das filhas.
 */
export async function getAvailability(db: Db, scope: StockScope, productIds?: string[]): Promise<Map<string, Availability>> {
  const mode = scope.stockMode || (await db.organization.findUnique({ where: { id: scope.orgId } }))?.stockMode || 'SEPARADO';
  const whWhere = mode === 'UNIFICADO' ? { company: { organizationId: scope.orgId }, active: true, available: true } : { companyId: scope.companyId, active: true, available: true };
  const products = await db.product.findMany({
    where: { organizationId: scope.orgId, ...(productIds ? { id: { in: productIds } } : {}) },
    select: { id: true, kind: true, parentId: true, components: { select: { componentId: true, quantity: true } }, variations: { select: { id: true } } },
  });
  const needed = new Set<string>();
  for (const p of products) {
    needed.add(p.id);
    p.components.forEach((c) => needed.add(c.componentId));
    p.variations.forEach((v) => needed.add(v.id));
  }
  const balances = await db.stockBalance.groupBy({
    by: ['productId'],
    where: { productId: { in: [...needed] }, warehouse: whWhere },
    _sum: { quantity: true, reserved: true },
  });
  const base = new Map<string, Availability>();
  for (const b of balances) {
    const q = round3(b._sum.quantity || 0);
    const r = round3(b._sum.reserved || 0);
    base.set(b.productId, { quantity: q, reserved: r, available: round3(q - r) });
  }
  const zero = { quantity: 0, reserved: 0, available: 0 };
  const result = new Map<string, Availability>();
  for (const p of products) {
    if (p.kind === 'KIT' && p.components.length) {
      const avail = Math.min(...p.components.map((c) => Math.floor((base.get(c.componentId)?.available ?? 0) / c.quantity)));
      const phys = Math.min(...p.components.map((c) => Math.floor((base.get(c.componentId)?.quantity ?? 0) / c.quantity)));
      result.set(p.id, { quantity: Math.max(phys, 0), reserved: 0, available: Math.max(avail, 0) });
    } else if (p.kind === 'VARIACAO_PAI') {
      const sum = p.variations.reduce(
        (acc, v) => {
          const a = base.get(v.id) ?? zero;
          return { quantity: acc.quantity + a.quantity, reserved: acc.reserved + a.reserved, available: acc.available + a.available };
        },
        { ...zero },
      );
      result.set(p.id, sum);
    } else {
      result.set(p.id, base.get(p.id) ?? { ...zero });
    }
  }
  return result;
}

export async function availableOf(scope: StockScope, productId: string) {
  const m = await getAvailability(prisma, scope, [productId]);
  return m.get(productId)?.available ?? 0;
}
