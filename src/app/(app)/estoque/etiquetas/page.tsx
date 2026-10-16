'use client';
import { useState } from 'react';
import { Printer, Plus, Trash2 } from 'lucide-react';
import { useApi } from '@/lib/api';
import { PageHeader, Field } from '@/components/common/page';
import { EntityPicker, productOption } from '@/components/common/picker';
import { Button } from '@/components/ui/button';
import { Input, Select, Checkbox } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Labels() {
  const [items, setItems] = useState<{ id: string | null; label?: string; copies: number }[]>([{ id: null, copies: 3 }]);
  const [price, setPrice] = useState(true);
  const [wh, setWh] = useState('');
  const { data: whs } = useApi<any>('/api/r/warehouses');
  const ids = items.filter((i) => i.id);
  return (
    <div>
      <PageHeader title="Impressão de etiquetas" description="Etiquetas de produto (código de barras EAN-13/Code128 + preço) em folha A4 3x10 e etiquetas de estoque/endereçamento com QR Code" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Etiquetas de produto</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex gap-2">
                <div className="flex-1"><EntityPicker endpoint="/api/products?sellable=1" value={it.id} label={it.label} map={productOption} onChange={(v, raw) => setItems(items.map((x, j) => (j === i ? { ...x, id: v, label: raw && `${raw.sku} — ${raw.name}` } : x)))} /></div>
                <Input type="number" className="w-20" value={it.copies} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, copies: Number(e.target.value) } : x)))} />
                <Button variant="ghost" size="icon" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="text-destructive" /></Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setItems([...items, { id: null, copies: 1 }])}><Plus /> Produto</Button>
              <Checkbox label="Imprimir preço" checked={price} onChange={(e) => setPrice(e.target.checked)} />
              <Button disabled={!ids.length} onClick={() => window.open(`/api/stock/labels?type=product&price=${price ? 1 : 0}&items=${ids.map((i) => `${i.id}:${i.copies}`).join(',')}`, '_blank')}><Printer /> Gerar PDF</Button>
              <Button variant="outline" onClick={() => window.open(`/api/stock/labels?type=product&price=${price ? 1 : 0}`, '_blank')}>Todos os produtos (1 cópia)</Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Etiquetas de estoque (localização/lote)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Field label="Depósito"><Select value={wh} onChange={(e) => setWh(e.target.value)}><option value="">Todos</option>{whs?.rows.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
            <p className="text-xs text-muted-foreground">Gera etiquetas para os produtos selecionados ao lado (ou todos) com SKU, depósito, localização, lote/validade, saldo e QR Code para conferência.</p>
            <Button onClick={() => window.open(`/api/stock/labels?type=stock&warehouseId=${wh}&items=${ids.map((i) => i.id).join(',')}`, '_blank')}><Printer /> Gerar etiquetas de estoque</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
