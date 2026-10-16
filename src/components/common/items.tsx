'use client';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EntityPicker, productOption, simpleOption } from './picker';
import { api } from '@/lib/api';
import { money, round2 } from '@/lib/utils';

export type ItemRow = { key: string; kind?: 'PRODUTO' | 'SERVICO'; productId?: string | null; serviceId?: string | null; label?: string; description?: string; quantity: number | string; unitPrice: number | string; discount?: number | string; unitCost?: number | string; lotNumber?: string; expiresAt?: string };

export const newItem = (kind: 'PRODUTO' | 'SERVICO' = 'PRODUTO'): ItemRow => ({ key: Math.random().toString(36).slice(2), kind, quantity: 1, unitPrice: '', discount: 0 });

export const itemTotal = (i: ItemRow, cost = false) => round2((Number(i.quantity) || 0) * (Number(cost ? i.unitCost : i.unitPrice) || 0) - (cost ? 0 : Number(i.discount) || 0));

/** Grade de itens (pedido, proposta, compra, OS, nota) com busca de produto/serviço */
export function ItemsEditor({ items, onChange, mode = 'sale', priceListId, allowServices = true, readOnly }: { items: ItemRow[]; onChange: (i: ItemRow[]) => void; mode?: 'sale' | 'purchase'; priceListId?: string | null; allowServices?: boolean; readOnly?: boolean }) {
  const set = (key: string, patch: Partial<ItemRow>) => onChange(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const cost = mode === 'purchase';
  const total = round2(items.reduce((a, i) => a + itemTotal(i, cost), 0));
  return (
    <div className="rounded-md border">
      <table className="table-dense w-full">
        <thead>
          <tr>
            {allowServices && !cost && <th className="w-24">Tipo</th>}
            <th>Produto / serviço</th>
            <th className="w-24 text-right">Qtd</th>
            <th className="w-32 text-right">{cost ? 'Custo unit.' : 'Preço unit.'}</th>
            {!cost && <th className="w-28 text-right">Desconto</th>}
            {cost && <th className="w-28">Lote</th>}
            {cost && <th className="w-36">Validade</th>}
            <th className="w-28 text-right">Total</th>
            {!readOnly && <th className="w-10" />}
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.key}>
              {allowServices && !cost && (
                <td>
                  <select disabled={readOnly} className="h-8 rounded border bg-card px-1 text-xs" value={i.kind || 'PRODUTO'} onChange={(e) => set(i.key, { kind: e.target.value as 'PRODUTO', productId: null, serviceId: null, label: '' })}>
                    <option value="PRODUTO">Produto</option>
                    <option value="SERVICO">Serviço</option>
                  </select>
                </td>
              )}
              <td className="min-w-[280px]">
                {(i.kind || 'PRODUTO') === 'PRODUTO' ? (
                  <EntityPicker disabled={readOnly} endpoint="/api/products?sellable=1" value={i.productId} label={i.label} map={productOption} placeholder="Buscar produto por nome, SKU ou EAN…" onChange={async (id, raw) => {
                    if (!id) return set(i.key, { productId: null, label: '' });
                    let price = cost ? raw.costPrice : raw.price;
                    if (!cost && priceListId) price = (await api(`/api/prices?productId=${id}&priceListId=${priceListId}&qty=${i.quantity}`)).price;
                    set(i.key, { productId: id, label: `${raw.sku} — ${raw.name}`, description: raw.name, ...(cost ? { unitCost: price } : { unitPrice: price }) });
                  }} />
                ) : (
                  <EntityPicker disabled={readOnly} endpoint="/api/r/services" value={i.serviceId} label={i.label} map={(r) => ({ ...simpleOption(r), sub: `${r.code} · ${money(r.price)}` })} placeholder="Buscar serviço…" onChange={(id, raw) => set(i.key, id ? { serviceId: id, label: raw.name, description: raw.name, unitPrice: raw.price } : { serviceId: null })} />
                )}
              </td>
              <td><Input disabled={readOnly} type="number" step="any" className="h-8 min-w-[72px] text-right" value={i.quantity} onChange={(e) => set(i.key, { quantity: e.target.value })} /></td>
              <td><Input disabled={readOnly} type="number" step="0.01" className="h-8 min-w-[96px] text-right" value={cost ? i.unitCost ?? '' : i.unitPrice} onChange={(e) => set(i.key, cost ? { unitCost: e.target.value } : { unitPrice: e.target.value })} /></td>
              {!cost && <td><Input disabled={readOnly} type="number" step="0.01" className="h-8 text-right" value={i.discount ?? 0} onChange={(e) => set(i.key, { discount: e.target.value })} /></td>}
              {cost && <td><Input disabled={readOnly} className="h-8" value={i.lotNumber || ''} onChange={(e) => set(i.key, { lotNumber: e.target.value })} placeholder="opcional" /></td>}
              {cost && <td><Input disabled={readOnly} type="date" className="h-8" value={i.expiresAt || ''} onChange={(e) => set(i.key, { expiresAt: e.target.value })} /></td>}
              <td className="num font-medium">{money(itemTotal(i, cost))}</td>
              {!readOnly && <td><Button variant="ghost" size="icon" onClick={() => onChange(items.filter((x) => x.key !== i.key))}><Trash2 className="text-destructive" /></Button></td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t bg-muted/30">
            <td colSpan={allowServices && !cost ? 2 : 1} className="py-2">
              {!readOnly && (
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, newItem('PRODUTO')])}><Plus /> Produto</Button>
                  {allowServices && !cost && <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, newItem('SERVICO')])}><Plus /> Serviço</Button>}
                </div>
              )}
            </td>
            <td colSpan={cost ? 4 : 3} className="text-right text-xs text-muted-foreground">Total dos itens</td>
            <td className="num font-bold">{money(total)}</td>
            {!readOnly && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Converte itens vindos da API (pedido/proposta) para linhas do editor */
export function toRows(items: any[]): ItemRow[] {
  return (items || []).map((i) => ({
    key: i.id || Math.random().toString(36).slice(2), kind: i.serviceId || i.kind === 'SERVICO' ? 'SERVICO' : 'PRODUTO', productId: i.productId, serviceId: i.serviceId,
    label: i.sku ? `${i.sku} — ${i.description}` : i.description, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount || 0, unitCost: i.unitCost,
    lotNumber: i.lotNumber || '', expiresAt: i.expiresAt ? String(i.expiresAt).slice(0, 10) : '',
  }));
}
export function fromRows(rows: ItemRow[]) {
  return rows.filter((r) => r.productId || r.serviceId).map((r) => ({ kind: r.kind || 'PRODUTO', productId: r.productId || null, serviceId: r.serviceId || null, description: r.description, quantity: Number(r.quantity), unitPrice: r.unitPrice === '' ? null : Number(r.unitPrice), discount: Number(r.discount) || 0, unitCost: Number(r.unitCost) || 0, lotNumber: r.lotNumber || null, expiresAt: r.expiresAt || null }));
}
