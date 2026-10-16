'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, Field } from '@/components/common/page';
import { EntityPicker, productOption } from '@/components/common/picker';
import { Button } from '@/components/ui/button';
import { Input, Select, Checkbox } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { money, fmtDate, toInputDate } from '@/lib/utils';

const TYPES: Record<string, [string, string]> = { VAREJO: ['Varejo', 'green'], ATACADO: ['Atacado', 'blue'], PROMOCAO: ['Promoção', 'red'], CANAL: ['Por canal', 'purple'] };

export default function PriceLists() {
  const { data, isLoading } = useApi<any>('/api/r/price-lists?pageSize=100');
  const act = useAction();
  const [e, setE] = useState<any>(null);
  const save = async () => {
    const body = { name: e.name, type: e.type, adjustPercent: e.adjustPercent, minQuantity: e.minQuantity, validFrom: e.validFrom || null, validUntil: e.validUntil || null, active: e.active, items: (e.items || []).map((i: any) => ({ productId: i.productId, price: i.price })) };
    const r = e.id ? await act('PUT', `/api/r/price-lists/${e.id}`, body, 'Lista salva — preços sincronizados com os canais') : await act('POST', '/api/r/price-lists', body, 'Lista criada');
    if (r) setE(null);
  };
  return (
    <div>
      <PageHeader title="Listas de preço" description="Atacado, varejo, promoções com vigência e preços por canal de venda. Use ajuste % geral e/ou preço fixo por produto." actions={<Button onClick={() => setE({ type: 'VAREJO', adjustPercent: 0, minQuantity: 0, active: true, items: [] })}><Plus /> Nova lista</Button>} />
      <DataTable loading={isLoading} rows={data?.rows} onRowClick={(r: any) => setE({ ...r, validFrom: toInputDate(r.validFrom), validUntil: toInputDate(r.validUntil), items: r.items.map((i: any) => ({ productId: i.productId, price: i.price, label: `${i.product.sku} — ${i.product.name}`, base: i.product.price })) })} columns={[
        { key: 'name', header: 'Lista' }, { key: 'type', header: 'Tipo', cell: (r: any) => <Badge tone={TYPES[r.type]?.[1]}>{TYPES[r.type]?.[0]}</Badge> },
        { key: 'adjustPercent', header: 'Ajuste geral', align: 'right', cell: (r: any) => `${r.adjustPercent > 0 ? '+' : ''}${r.adjustPercent}%` },
        { key: 'minQuantity', header: 'Qtd mínima', align: 'right' }, { key: 'items', header: 'Preços fixos', align: 'right', cell: (r: any) => r.items.length },
        { key: 'vig', header: 'Vigência', cell: (r: any) => (r.validFrom || r.validUntil ? `${fmtDate(r.validFrom)} a ${fmtDate(r.validUntil)}` : 'Sempre') },
        { key: 'contacts', header: 'Clientes', align: 'right', cell: (r: any) => r._count?.contacts },
        { key: 'active', header: 'Situação', cell: (r: any) => (r.active ? <Badge tone="green">Ativa</Badge> : <Badge>Inativa</Badge>) },
      ]} />
      <Dialog open={!!e} onOpenChange={(o) => !o && setE(null)} title={e?.id ? 'Editar lista de preço' : 'Nova lista de preço'} size="lg" footer={<>{e?.id && <Button variant="outline" className="mr-auto" onClick={async () => { if (confirm('Excluir lista?')) { await act('DELETE', `/api/r/price-lists/${e.id}`); setE(null); } }}><Trash2 /> Excluir</Button>}<Button variant="outline" onClick={() => setE(null)}>Cancelar</Button><Button onClick={save}>Salvar</Button></>}>
        {e && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Field label="Nome" className="md:col-span-2"><Input value={e.name || ''} onChange={(x) => setE({ ...e, name: x.target.value })} /></Field>
              <Field label="Tipo"><Select value={e.type} onChange={(x) => setE({ ...e, type: x.target.value })}>{Object.entries(TYPES).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
              <Field label="Situação"><Checkbox checked={e.active} label="Ativa" onChange={(x) => setE({ ...e, active: x.target.checked })} /></Field>
              <Field label="Ajuste geral (%)" hint="ex.: -15 (desconto) ou 12 (acréscimo)"><Input type="number" step="0.01" value={e.adjustPercent} onChange={(x) => setE({ ...e, adjustPercent: x.target.value })} /></Field>
              <Field label="Quantidade mínima"><Input type="number" value={e.minQuantity} onChange={(x) => setE({ ...e, minQuantity: x.target.value })} /></Field>
              <Field label="Vigência — início"><Input type="date" value={e.validFrom || ''} onChange={(x) => setE({ ...e, validFrom: x.target.value })} /></Field>
              <Field label="Vigência — fim"><Input type="date" value={e.validUntil || ''} onChange={(x) => setE({ ...e, validUntil: x.target.value })} /></Field>
            </div>
            <div className="text-sm font-semibold">Preços fixos por produto</div>
            {(e.items || []).map((i: any, idx: number) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="flex-1"><EntityPicker endpoint="/api/products?sellable=1" value={i.productId} label={i.label} map={productOption} onChange={(v, raw) => setE({ ...e, items: e.items.map((x: any, j: number) => (j === idx ? { ...x, productId: v, label: raw && `${raw.sku} — ${raw.name}`, base: raw?.price, price: x.price || raw?.price } : x)) })} /></div>
                <span className="w-24 text-right text-xs text-muted-foreground">base {money(i.base)}</span>
                <Input type="number" step="0.01" className="w-28" value={i.price ?? ''} onChange={(x) => setE({ ...e, items: e.items.map((y: any, j: number) => (j === idx ? { ...y, price: x.target.value } : y)) })} />
                <Button variant="ghost" size="icon" onClick={() => setE({ ...e, items: e.items.filter((_: any, j: number) => j !== idx) })}><Trash2 className="text-destructive" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setE({ ...e, items: [...(e.items || []), { productId: null }] })}><Plus /> Produto</Button>
          </div>
        )}
      </Dialog>
    </div>
  );
}
