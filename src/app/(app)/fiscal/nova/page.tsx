'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Send } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, Field } from '@/components/common/page';
import { EntityPicker, contactOption } from '@/components/common/picker';
import { ItemsEditor, fromRows, newItem, type ItemRow } from '@/components/common/items';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

export default function NewInvoice() {
  const sp = useSearchParams();
  const router = useRouter();
  const act = useAction();
  const [model, setModel] = useState(sp.get('model') || 'NFE');
  const [inv, setInv] = useState<any>({ freight: 0, discount: 0 });
  const [items, setItems] = useState<ItemRow[]>([newItem(model === 'NFSE' ? 'SERVICO' : 'PRODUTO')]);
  const { data: natures } = useApi<any>('/api/r/natures?pageSize=100');
  const emit = async () => {
    const draft: any = await act('POST', '/api/invoices', { model, ...inv, items: fromRows(items) }, false);
    if (!draft) return;
    const r: any = await act('POST', `/api/invoices/${draft.id}/transmit`, {}, false);
    const { toast } = await import('sonner');
    if (r?.status === 'AUTORIZADA') toast.success(`Nota nº ${r.number} autorizada`);
    else toast.error(`Rejeitada: ${r?.rejectionReason}`);
    router.push(`/fiscal/notas/${draft.id}`);
  };
  return (
    <div>
      <PageHeader title="Emitir nota fiscal avulsa" description="Para remessas, devoluções, bonificações ou vendas sem pedido. Impostos calculados automaticamente." actions={<Button onClick={emit}><Send /> Gerar e transmitir</Button>} />
      <Card className="mb-3"><CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Modelo"><Select value={model} onChange={(e) => { setModel(e.target.value); setItems([newItem(e.target.value === 'NFSE' ? 'SERVICO' : 'PRODUTO')]); }}><option value="NFE">NF-e (55)</option><option value="NFCE">NFC-e (65)</option><option value="NFSE">NFS-e</option></Select></Field>
        <Field label="Natureza de operação"><Select value={inv.natureId || ''} onChange={(e) => setInv({ ...inv, natureId: e.target.value })}><option value="">Padrão do modelo</option>{natures?.rows.map((n: any) => <option key={n.id} value={n.id}>{n.name} ({n.cfopIntra})</option>)}</Select></Field>
        <Field label="Destinatário" className="md:col-span-2"><EntityPicker endpoint="/api/r/contacts" value={inv.customerId} label={inv.customerLabel} map={contactOption} onChange={(v, raw) => setInv({ ...inv, customerId: v, customerLabel: raw?.name })} /></Field>
        {model !== 'NFSE' && <Field label="Frete"><Input type="number" step="0.01" value={inv.freight} onChange={(e) => setInv({ ...inv, freight: e.target.value })} /></Field>}
        <Field label="Desconto"><Input type="number" step="0.01" value={inv.discount} onChange={(e) => setInv({ ...inv, discount: e.target.value })} /></Field>
        <Field label="Informações complementares" className="md:col-span-4"><Textarea value={inv.additionalInfo || ''} onChange={(e) => setInv({ ...inv, additionalInfo: e.target.value })} placeholder="Deixe em branco para usar o texto padrão (Simples Nacional + IBPT)" /></Field>
      </CardContent></Card>
      <ItemsEditor items={items} onChange={setItems} allowServices={model === 'NFSE'} />
      <p className="mt-2 text-xs text-muted-foreground">Notas avulsas não movimentam estoque nem financeiro automaticamente (use pedidos de venda para o fluxo completo).</p>
    </div>
  );
}
