'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Save, Send, PackageCheck, XCircle, ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, Field, DataTable } from '@/components/common/page';
import { EntityPicker, contactOption } from '@/components/common/picker';
import { ItemsEditor, toRows, newItem, itemTotal, type ItemRow } from '@/components/common/items';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { money, fmtDate, toInputDate, round2, num } from '@/lib/utils';

export default function PurchaseForm() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'novo';
  const router = useRouter();
  const act = useAction();
  const { data } = useApi<any>(isNew ? null : `/api/purchases/${id}`);
  const { data: whs } = useApi<any>('/api/r/warehouses');
  const [po, setPo] = useState<any>({ installments: 1, paymentTermDays: 30, paymentMethod: 'BOLETO', freight: 0, discount: 0, otherCosts: 0 });
  const [items, setItems] = useState<ItemRow[]>([newItem()]);
  useEffect(() => {
    if (!data) return;
    setPo({ ...data, date: toInputDate(data.date), expectedDate: toInputDate(data.expectedDate), supplierLabel: data.supplier.name });
    setItems(toRows(data.items.map((i: any) => ({ ...i, sku: i.product.sku }))));
  }, [data]);
  const editable = isNew || ['ABERTO', 'ENVIADO'].includes(po.status);
  const subtotal = round2(items.reduce((a, i) => a + itemTotal(i, true), 0));
  const total = round2(subtotal + Number(po.freight || 0) + Number(po.otherCosts || 0) - Number(po.discount || 0));
  const save = async () => {
    const body = { ...po, items: items.filter((i) => i.productId).map((i) => ({ productId: i.productId, quantity: Number(i.quantity), unitCost: Number(i.unitCost), lotNumber: i.lotNumber || null, expiresAt: i.expiresAt || null })) };
    const r = isNew ? await act('POST', '/api/purchases', body, 'Pedido de compra criado') : await act('PUT', `/api/purchases/${id}`, body, 'Pedido salvo');
    if (r && isNew) router.replace(`/compras/${(r as any).id}`);
  };
  const action = (a: string, msg: string) => act('POST', `/api/purchases/${id}/${a}`, {}, msg);
  return (
    <div>
      <PageHeader title={isNew ? 'Novo pedido de compra' : `Pedido de compra nº ${po.number}`} badge={!isNew && <StatusBadge status={po.status} />}
        actions={<>
          <Button variant="outline" onClick={() => router.push('/compras')}><ArrowLeft /> Voltar</Button>
          {!isNew && po.status === 'ABERTO' && <Button variant="outline" onClick={() => action('send', 'Pedido enviado ao fornecedor (e-mail simulado)')}><Send /> Enviar ao fornecedor</Button>}
          {!isNew && ['ABERTO', 'ENVIADO', 'EM_CONFERENCIA'].includes(po.status) && <Button variant="outline" asChild><Link href={`/compras/checkin?id=${id}`}><ClipboardCheck /> Check-in</Link></Button>}
          {!isNew && ['ABERTO', 'ENVIADO', 'EM_CONFERENCIA'].includes(po.status) && <Button variant="outline" onClick={() => confirm('Confirmar recebimento? Será lançada a entrada no estoque e as contas a pagar.') && action('receive', 'Compra recebida: estoque, contas a pagar e custos atualizados')}><PackageCheck /> Receber</Button>}
          {!isNew && ['ABERTO', 'ENVIADO'].includes(po.status) && <Button variant="outline" onClick={() => confirm('Cancelar pedido?') && action('cancel', 'Pedido cancelado')}><XCircle /></Button>}
          {editable && <Button onClick={save}><Save /> Salvar</Button>}
        </>} />
      <Card className="mb-3"><CardContent className="grid grid-cols-1 gap-3 md:grid-cols-6">
        <Field label="Fornecedor *" className="md:col-span-3"><EntityPicker disabled={!editable} endpoint="/api/r/contacts?type=FORNECEDOR" value={po.supplierId} label={po.supplierLabel} map={contactOption} onChange={(v, raw) => setPo({ ...po, supplierId: v, supplierLabel: raw?.name })} /></Field>
        <Field label="Data"><Input disabled={!editable} type="date" value={po.date || toInputDate(new Date())} onChange={(e) => setPo({ ...po, date: e.target.value })} /></Field>
        <Field label="Previsão de entrega"><Input disabled={!editable} type="date" value={po.expectedDate || ''} onChange={(e) => setPo({ ...po, expectedDate: e.target.value })} /></Field>
        <Field label="Depósito de entrada"><Select disabled={!editable} value={po.warehouseId || ''} onChange={(e) => setPo({ ...po, warehouseId: e.target.value })}><option value="">Padrão</option>{whs?.rows.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
      </CardContent></Card>
      <ItemsEditor items={items} onChange={setItems} mode="purchase" allowServices={false} readOnly={!editable} />
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Card><CardContent className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="Frete"><Input disabled={!editable} type="number" step="0.01" value={po.freight} onChange={(e) => setPo({ ...po, freight: e.target.value })} /></Field>
          <Field label="Outras despesas"><Input disabled={!editable} type="number" step="0.01" value={po.otherCosts} onChange={(e) => setPo({ ...po, otherCosts: e.target.value })} /></Field>
          <Field label="Desconto"><Input disabled={!editable} type="number" step="0.01" value={po.discount} onChange={(e) => setPo({ ...po, discount: e.target.value })} /></Field>
          <Field label="Forma de pagamento"><Select disabled={!editable} value={po.paymentMethod} onChange={(e) => setPo({ ...po, paymentMethod: e.target.value })}><option value="BOLETO">Boleto</option><option value="PIX">Pix</option><option value="TRANSFERENCIA">Transferência</option><option value="CARTAO_CREDITO">Cartão</option></Select></Field>
          <Field label="Parcelas"><Input disabled={!editable} type="number" min={1} value={po.installments} onChange={(e) => setPo({ ...po, installments: e.target.value })} /></Field>
          <Field label="1º vencimento (dias)"><Input disabled={!editable} type="number" value={po.paymentTermDays} onChange={(e) => setPo({ ...po, paymentTermDays: e.target.value })} /></Field>
          <Field label="Observações" className="col-span-2 md:col-span-3"><Textarea disabled={!editable} value={po.notes || ''} onChange={(e) => setPo({ ...po, notes: e.target.value })} /></Field>
        </CardContent></Card>
        <Card><CardContent className="space-y-1 text-sm">
          <div className="flex justify-between"><span>Produtos</span><span>{money(subtotal)}</span></div>
          <div className="flex justify-between"><span>Frete + despesas</span><span>{money(Number(po.freight || 0) + Number(po.otherCosts || 0))}</span></div>
          <div className="flex justify-between"><span>Desconto</span><span>- {money(po.discount)}</span></div>
          <div className="flex justify-between border-t pt-2 text-lg font-bold"><span>Total</span><span>{money(total)}</span></div>
          {!isNew && po.status === 'RECEBIDO' && <p className="pt-2 text-xs text-green-700">✓ Recebido em {fmtDate(po.receivedAt)} — estoque {po.stockPosted ? 'lançado' : 'pendente'}, financeiro {po.financialPosted ? 'lançado' : 'pendente'}</p>}
        </CardContent></Card>
      </div>
      {!isNew && data?.entries?.length > 0 && (
        <Card className="mt-3"><CardHeader><CardTitle>Contas a pagar geradas</CardTitle></CardHeader>
          <DataTable rows={data.entries} columns={[{ key: 'description', header: 'Descrição' }, { key: 'dueDate', header: 'Vencimento', cell: (r: any) => fmtDate(r.dueDate) }, { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> }, { key: 'amount', header: 'Valor', align: 'right', cell: (r: any) => money(r.amount) }]} />
        </Card>
      )}
      {!isNew && data?.movements?.length > 0 && (
        <Card className="mt-3"><CardHeader><CardTitle>Entradas no estoque</CardTitle></CardHeader>
          <DataTable rows={data.movements} columns={[{ key: 'type', header: 'Tipo' }, { key: 'originLabel', header: 'Origem' }, { key: 'lotNumber', header: 'Lote' }, { key: 'quantity', header: 'Qtd', align: 'right', cell: (r: any) => num(r.quantity) }, { key: 'unitCost', header: 'Custo c/ rateio', align: 'right', cell: (r: any) => money(r.unitCost) }]} />
        </Card>
      )}
    </div>
  );
}
