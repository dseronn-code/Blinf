'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Save, FileText, XCircle, Printer, Truck, PackageCheck, CheckCircle2, MoreHorizontal, Zap, Receipt, Undo2, Split } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, useAction, openFile, api } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { PageHeader, Field, DataTable, KV } from '@/components/common/page';
import { EntityPicker, contactOption } from '@/components/common/picker';
import { ItemsEditor, toRows, fromRows, newItem, itemTotal, type ItemRow } from '@/components/common/items';
import { PromptDialog } from '@/components/common/prompt';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown';
import { money, fmtDate, fmtDateTime, toInputDate, round2, num, cn } from '@/lib/utils';
import { PAYMENT_METHODS, ORIGIN_LABEL } from '@/lib/labels';

const FLOW = ['ABERTO', 'FATURADO', 'SEPARADO', 'ENVIADO', 'ENTREGUE'];

export default function SalesOrderPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'novo';
  const router = useRouter();
  const act = useAction();
  const { data } = useApi<any>(isNew ? null : `/api/sales-orders/${id}`);
  const { data: lists } = useApi<any>('/api/r/price-lists?pageSize=100');
  const { data: sellers } = useApi<any>('/api/r/sellers?pageSize=100');
  const { data: whs } = useApi<any>('/api/r/warehouses');
  const [o, setO] = useState<any>({ paymentMethod: 'BOLETO', installments: 1, paymentTermDays: 30, discount: 0, freight: 0, otherCosts: 0 });
  const [items, setItems] = useState<ItemRow[]>([newItem()]);
  const [cancel, setCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retOpen, setRetOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [shipOpen, setShipOpen] = useState(false);
  useEffect(() => {
    if (!data) return;
    setO({ ...data, date: toInputDate(data.date), expectedDate: toInputDate(data.expectedDate), customerLabel: data.customer.name });
    setItems(toRows(data.items));
  }, [data]);
  const editable = isNew || o.status === 'ABERTO';
  const subtotal = round2(items.reduce((a, i) => a + itemTotal(i), 0));
  const total = round2(subtotal - Number(o.discount || 0) + Number(o.freight || 0) + Number(o.otherCosts || 0));
  const save = async () => {
    const body = { customerId: o.customerId, sellerId: o.sellerId || null, priceListId: o.priceListId || null, warehouseId: o.warehouseId || null, date: o.date || undefined, expectedDate: o.expectedDate || null, items: fromRows(items), discount: o.discount, freight: o.freight, otherCosts: o.otherCosts, paymentMethod: o.paymentMethod, installments: o.installments, paymentTermDays: o.paymentTermDays, notes: o.notes, internalNotes: o.internalNotes, carrier: o.carrier, shippingService: o.shippingService };
    const r = isNew ? await act('POST', '/api/sales-orders', body, 'Pedido criado — estoque reservado') : await act('PUT', `/api/sales-orders/${id}`, body, 'Pedido salvo');
    if (r && isNew) router.replace(`/vendas/${(r as any).id}`);
  };
  const run = async (action: string, body: object = {}, msg?: string | false) => {
    setBusy(true);
    const r: any = await act('POST', `/api/sales-orders/${id}/${action}`, body, msg);
    setBusy(false);
    return r;
  };
  const invoice = async (model?: string) => {
    const r = await run('invoice', { model }, false);
    if (!r) return;
    const inv = r.invoices?.[0];
    const { toast } = await import('sonner');
    if (inv?.status === 'AUTORIZADA') toast.success(`${inv.model} nº ${inv.number} autorizada! Estoque baixado, contas lançadas e etiqueta gerada.`);
    else toast.error(`Nota rejeitada: ${inv?.rejectionReason}`);
  };
  const shipment = data?.shipments?.find((s: any) => s.status !== 'CANCELADO');
  return (
    <div>
      <PageHeader title={isNew ? 'Novo pedido de venda' : `Pedido de venda nº ${o.number}`} badge={!isNew && <StatusBadge status={o.status} />}
        description={!isNew && <>{data?.channel?.name || ORIGIN_LABEL[o.origin]}{o.externalId ? ` · ${o.externalId}` : ''} · criado em {fmtDateTime(data?.createdAt)}</>}
        actions={<>
          <Button variant="outline" onClick={() => router.push('/vendas')}><ArrowLeft /> Voltar</Button>
          {!isNew && <Button variant="outline" onClick={() => openFile(`/api/sales-orders/${id}/pdf`)}><Printer /> Imprimir</Button>}
          {!isNew && o.status === 'ABERTO' && <Button disabled={busy} onClick={() => invoice()}><FileText /> Faturar (emitir NF)</Button>}
          {!isNew && o.status === 'ABERTO' && <Button variant="outline" onClick={() => setSplitOpen(true)}><Split /> Desmembrar pedido</Button>}
          {!isNew && o.status && !['ABERTO', 'CANCELADO'].includes(o.status) && <Button variant="outline" onClick={() => setRetOpen(true)}><Undo2 /> Devolução / troca</Button>}
          {!isNew && o.status === 'FATURADO' && <Button asChild><Link href="/logistica/separacao"><PackageCheck /> Separar</Link></Button>}
          {!isNew && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline"><MoreHorizontal /> Mais ações</Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                {o.status === 'ABERTO' && <DropdownMenuItem onSelect={() => invoice('NFCE')}><Receipt /> Faturar com NFC-e</DropdownMenuItem>}
                {o.status === 'ABERTO' && <DropdownMenuItem onSelect={() => run('invoice-without-note', {}, 'Pedido faturado sem nota fiscal')}><CheckCircle2 /> Faturar sem nota fiscal</DropdownMenuItem>}
                {o.status === 'ABERTO' && !o.stockReserved && <DropdownMenuItem onSelect={() => run('reserve', {}, 'Estoque reservado')}>Reservar estoque</DropdownMenuItem>}
                {o.stockReserved && <DropdownMenuItem onSelect={() => run('release', {}, 'Reserva liberada')}>Liberar reserva</DropdownMenuItem>}
                {o.status !== 'CANCELADO' && !o.stockPosted && <DropdownMenuItem onSelect={() => run('post-stock', {}, 'Saída de estoque lançada')}>Lançar estoque</DropdownMenuItem>}
                {o.status !== 'CANCELADO' && !o.financialPosted && <DropdownMenuItem onSelect={() => run('post-financial', {}, 'Contas a receber lançadas')}>Lançar contas a receber</DropdownMenuItem>}
                {!o.commissionPosted && o.sellerId && o.status !== 'ABERTO' && <DropdownMenuItem onSelect={() => run('commission', {}, 'Comissão calculada')}>Calcular comissão</DropdownMenuItem>}
                {['FATURADO', 'SEPARADO'].includes(o.status) && !shipment && <DropdownMenuItem onSelect={() => setShipOpen(true)}><Truck /> Gerar etiqueta de envio</DropdownMenuItem>}
                {o.status === 'SEPARADO' && <DropdownMenuItem onSelect={() => run('status', { status: 'ENVIADO' }, 'Pedido enviado')}>Marcar como enviado</DropdownMenuItem>}
                {o.status === 'ENVIADO' && <DropdownMenuItem onSelect={() => run('status', { status: 'ENTREGUE' }, 'Pedido entregue')}>Marcar como entregue</DropdownMenuItem>}
                <DropdownMenuSeparator />
                {!['CANCELADO', 'ENVIADO', 'ENTREGUE'].includes(o.status) && <DropdownMenuItem className="text-destructive" onSelect={() => setCancel(true)}><XCircle /> Cancelar pedido</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {editable && <Button variant={isNew ? 'default' : 'outline'} onClick={save}><Save /> Salvar</Button>}
        </>} />

      {!isNew && o.status !== 'CANCELADO' && (
        <div className="mb-3 flex items-center gap-1 overflow-x-auto rounded-lg border bg-card p-2">
          {FLOW.map((s, i) => {
            const done = FLOW.indexOf(o.status) >= i;
            return <div key={s} className="flex items-center gap-1"><div className={cn('rounded-full px-3 py-1 text-xs font-semibold', done ? 'bg-primary text-white' : 'bg-muted text-muted-foreground')}>{i + 1}. {s === 'ABERTO' ? 'Em aberto' : s.charAt(0) + s.slice(1).toLowerCase()}</div>{i < FLOW.length - 1 && <div className={cn('h-0.5 w-6', done ? 'bg-primary' : 'bg-muted')} />}</div>;
          })}
        </div>
      )}
      {!isNew && (data?.parent || data?.children?.length > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {data?.parent && <span>Desmembrado do pedido <Link className="font-semibold underline" href={`/vendas/${data.parent.id}`}>nº {data.parent.number}</Link></span>}
          {data?.children?.length > 0 && <span className="flex flex-wrap items-center gap-1">Pedidos desmembrados: {data.children.map((c: any) => <Link key={c.id} href={`/vendas/${c.id}`} className="inline-flex items-center gap-1 font-semibold underline">nº {c.number} <StatusBadge status={c.status} /> <span className="font-normal no-underline">{money(c.total)}</span></Link>)}</span>}
        </div>
      )}
      {o.status === 'CANCELADO' && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">Pedido cancelado em {fmtDateTime(o.cancelledAt)}. {o.cancelReason}</div>}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <Card><CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Cliente *" className="md:col-span-2"><EntityPicker disabled={!editable} endpoint="/api/r/contacts?type=CLIENTE" value={o.customerId} label={o.customerLabel} map={contactOption} onChange={(v, raw) => setO({ ...o, customerId: v, customerLabel: raw?.name, priceListId: raw?.priceListId || o.priceListId, sellerId: raw?.sellerId || o.sellerId })} /></Field>
            <Field label="Data"><Input disabled={!editable} type="date" value={o.date || toInputDate(new Date())} onChange={(e) => setO({ ...o, date: e.target.value })} /></Field>
            <Field label="Previsão de entrega"><Input disabled={!editable} type="date" value={o.expectedDate || ''} onChange={(e) => setO({ ...o, expectedDate: e.target.value })} /></Field>
            <Field label="Vendedor"><Select disabled={!editable} value={o.sellerId || ''} onChange={(e) => setO({ ...o, sellerId: e.target.value })}><option value="">—</option>{sellers?.rows.filter((s: any) => s.kind === 'VENDEDOR').map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.commissionRate}%)</option>)}</Select></Field>
            <Field label="Lista de preço"><Select disabled={!editable} value={o.priceListId || ''} onChange={(e) => setO({ ...o, priceListId: e.target.value })}><option value="">Padrão</option>{lists?.rows.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
            <Field label="Depósito"><Select disabled={!editable} value={o.warehouseId || ''} onChange={(e) => setO({ ...o, warehouseId: e.target.value })}><option value="">Padrão</option>{whs?.rows.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
            <Field label="Serviço de envio"><Select disabled={!editable} value={o.shippingService || ''} onChange={(e) => setO({ ...o, shippingService: e.target.value })}><option value="">Mais barato (automático)</option>{['PAC', 'SEDEX', '.Package', 'Loggi Express', 'Standard', 'Amanhã'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
          </CardContent></Card>
          <ItemsEditor items={items} onChange={setItems} priceListId={o.priceListId} readOnly={!editable} />
          <Card><CardContent className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <Field label="Desconto (R$)"><Input disabled={!editable} type="number" step="0.01" value={o.discount} onChange={(e) => setO({ ...o, discount: e.target.value })} /></Field>
            <Field label="Frete (R$)"><Input disabled={!editable} type="number" step="0.01" value={o.freight} onChange={(e) => setO({ ...o, freight: e.target.value })} /></Field>
            <Field label="Outras despesas"><Input disabled={!editable} type="number" step="0.01" value={o.otherCosts} onChange={(e) => setO({ ...o, otherCosts: e.target.value })} /></Field>
            <Field label="Forma de pagamento"><Select disabled={!editable} value={o.paymentMethod} onChange={(e) => setO({ ...o, paymentMethod: e.target.value })}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Parcelas"><Input disabled={!editable} type="number" min={1} value={o.installments} onChange={(e) => setO({ ...o, installments: e.target.value })} /></Field>
            <Field label="1º vencimento (dias)"><Input disabled={!editable} type="number" value={o.paymentTermDays} onChange={(e) => setO({ ...o, paymentTermDays: e.target.value })} /></Field>
            <Field label="Observações (saem na nota)" className="col-span-2 md:col-span-3"><Textarea disabled={!editable} value={o.notes || ''} onChange={(e) => setO({ ...o, notes: e.target.value })} /></Field>
            <Field label="Observações internas" className="col-span-2 md:col-span-3"><Textarea disabled={!editable} value={o.internalNotes || ''} onChange={(e) => setO({ ...o, internalNotes: e.target.value })} /></Field>
          </CardContent></Card>
        </div>

        <div className="space-y-3">
          <Card><CardContent className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span>Itens</span><span>{money(subtotal)}</span></div>
            <div className="flex justify-between"><span>Desconto</span><span>- {money(o.discount)}</span></div>
            <div className="flex justify-between"><span>Frete</span><span>{money(o.freight)}</span></div>
            <div className="flex justify-between border-t pt-2 text-lg font-bold"><span>Total</span><span>{money(total)}</span></div>
            {!isNew && <div className="flex justify-between text-xs text-muted-foreground"><span>Custo (CMV)</span><span>{money(data?.totalCost)}</span></div>}
            {!isNew && data?.channelFee > 0 && <div className="flex justify-between text-xs text-muted-foreground"><span>Tarifa do canal</span><span>{money(data.channelFee)}</span></div>}
            {!isNew && <div className="flex justify-between text-xs font-semibold text-green-700"><span>Lucro bruto</span><span>{money(data?.total - data?.totalCost - data?.channelFee)}</span></div>}
          </CardContent></Card>
          {!isNew && (
            <>
              <Card><CardHeader><CardTitle>Integração entre módulos</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-2 text-xs">
                {[['Estoque reservado', o.stockReserved], ['Estoque baixado', o.stockPosted], ['Financeiro lançado', o.financialPosted], ['Comissão calculada', o.commissionPosted]].map(([l, v]) => <div key={l as string} className="flex items-center gap-1">{v ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <span className="h-3.5 w-3.5 rounded-full border" />}{l}</div>)}
              </CardContent></Card>
              {data?.invoices?.length > 0 && <Card><CardHeader><CardTitle>Notas fiscais</CardTitle></CardHeader><div className="divide-y">{data.invoices.map((inv: any) => <Link key={inv.id} href={`/fiscal/notas/${inv.id}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-muted"><span>{inv.model} nº {inv.number}</span><StatusBadge status={inv.status} /></Link>)}</div></Card>}
              {data?.returns?.length > 0 && <Card><CardHeader><CardTitle>Devoluções e trocas</CardTitle><Link href="/vendas/devolucoes" className="text-xs text-primary hover:underline">Ver todas</Link></CardHeader><div className="divide-y">{data.returns.map((r: any) => <Link key={r.id} href="/vendas/devolucoes" className="flex items-center justify-between px-4 py-1.5 text-xs hover:bg-muted"><span>{r.kind === 'TROCA' ? 'Troca' : 'Devolução'} nº {r.number} · {fmtDate(r.createdAt)}</span><span className="flex items-center gap-1">{money(r.total)} <StatusBadge status={r.status} /></span></Link>)}</div></Card>}
              {data?.entries?.length > 0 && <Card><CardHeader><CardTitle>Financeiro</CardTitle></CardHeader><div className="divide-y">{data.entries.map((e: any) => <div key={e.id} className="flex items-center justify-between px-4 py-1.5 text-xs"><span>{e.type === 'PAGAR' ? '↑' : '↓'} {fmtDate(e.dueDate)} · {e.description.replace(/.*\(/, '(')}</span><span className="flex items-center gap-1">{money(e.amount)} <StatusBadge status={e.status} /></span></div>)}</div></Card>}
              {shipment && <Card><CardHeader><CardTitle>Envio</CardTitle><Button size="sm" variant="outline" onClick={() => openFile(`/api/logistics/labels?ids=${shipment.id}`)}><Printer /> Etiqueta</Button></CardHeader><CardContent className="grid grid-cols-2 gap-2"><KV label="Transportadora" value={`${shipment.carrier} ${shipment.service}`} /><KV label="Frete" value={money(shipment.price)} /><KV label="Rastreio" value={shipment.trackingCode} /><KV label="Situação" value={<StatusBadge status={shipment.status} />} /></CardContent></Card>}
              {data?.commission && <Card className="p-4 text-sm">Comissão de <b>{data.seller?.name}</b>: {money(data.commission.amount)} ({data.commission.rate}%) <StatusBadge status={data.commission.status} /></Card>}
              {data?.logs?.length > 0 && <Card><CardHeader><CardTitle className="flex items-center gap-1"><Zap className="h-4 w-4 text-amber-500" /> Automações executadas</CardTitle></CardHeader><div className="max-h-72 divide-y overflow-y-auto">{data.logs.map((l: any) => <div key={l.id} className="px-4 py-1.5 text-xs"><div className="flex justify-between"><b>{l.key.replace(/_/g, ' ').toLowerCase()}</b><span className="text-muted-foreground">{fmtDateTime(l.createdAt)}</span></div><div className={l.success ? 'text-muted-foreground' : 'text-red-600'}>{l.message}</div></div>)}</div></Card>}
              {data?.movements?.length > 0 && <Card><CardHeader><CardTitle>Movimentos de estoque</CardTitle></CardHeader><DataTable rows={data.movements} columns={[{ key: 'type', header: 'Tipo', cell: (r: any) => <Badge tone={r.quantity < 0 ? 'red' : 'green'}>{r.type}</Badge> }, { key: 'lotNumber', header: 'Lote', cell: (r: any) => r.lotNumber || '' }, { key: 'quantity', header: 'Qtd', align: 'right', cell: (r: any) => num(r.quantity) }]} /></Card>}
            </>
          )}
        </div>
      </div>
      <PromptDialog open={cancel} onOpenChange={setCancel} destructive title="Cancelar pedido" description="Notas autorizadas serão canceladas na SEFAZ (simulada), a reserva/estoque será estornada e as contas em aberto canceladas." label="Justificativa (mín. 15 caracteres)" minLength={15} confirmText="Cancelar pedido" onConfirm={(reason) => run('cancel', { reason }, 'Pedido cancelado')} />
      {!isNew && data && <ReturnDialog open={retOpen} onOpenChange={setRetOpen} order={data} />}
      {!isNew && data && shipOpen && <ShipmentDialog order={data} onClose={() => setShipOpen(false)} />}
      {!isNew && data && <SplitDialog open={splitOpen} onOpenChange={setSplitOpen} order={data} onDone={(nid) => router.push(`/vendas/${nid}`)} />}
    </div>
  );
}

/** Devolução / troca de itens de um pedido faturado */
function ReturnDialog({ open, onOpenChange, order }: { open: boolean; onOpenChange: (o: boolean) => void; order: any }) {
  const act = useAction();
  const [kind, setKind] = useState('DEVOLUCAO');
  const [refundMethod, setRefundMethod] = useState('ESTORNO');
  const [reason, setReason] = useState('');
  const [emitInvoice, setEmitInvoice] = useState(true);
  const [lines, setLines] = useState<Record<string, { quantity: string; restock: boolean }>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setKind('DEVOLUCAO'); setRefundMethod('ESTORNO'); setReason(''); setEmitInvoice(true); setLines({}); }
  }, [open]);
  const returned: Record<string, number> = order.returned || {};
  const items: any[] = order.items || [];
  const avail = (it: any) => Math.max(0, round2(Number(it.quantity) - (Number(returned[it.id]) || 0)));
  const line = (id: string) => lines[id] || { quantity: '', restock: true };
  const setLine = (id: string, patch: Partial<{ quantity: string; restock: boolean }>) => setLines({ ...lines, [id]: { ...line(id), ...patch } });
  const selected = items.map((it) => ({ it, q: Number(line(it.id).quantity) || 0 })).filter((x) => x.q > 0);
  const invalid = selected.some((x) => x.q > avail(x.it) + 1e-9);
  const total = round2(selected.reduce((a, x) => a + x.q * Number(x.it.unitPrice || 0), 0));
  const submit = async () => {
    setBusy(true);
    const r: any = await act('POST', '/api/returns', {
      salesOrderId: order.id, kind, refundMethod: kind === 'TROCA' ? 'NENHUM' : refundMethod, reason: reason.trim(), emitInvoice,
      items: selected.map((x) => ({ salesOrderItemId: x.it.id, quantity: x.q, restock: line(x.it.id).restock })),
    }, false);
    setBusy(false);
    if (r) {
      toast.success(`${kind === 'TROCA' ? 'Troca' : 'Devolução'} nº ${r.number} registrada${emitInvoice ? ' — NF-e de devolução emitida' : ''}`);
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={`Devolução / troca — pedido nº ${order.number}`} description="Emite NF-e de devolução (CFOP 1202/2202, finalidade 4) referenciando a nota original, retorna o estoque e lança o estorno ou crédito no financeiro." footer={
      <>
        <span className="mr-auto self-center text-sm">Total: <b>{money(total)}</b></span>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Voltar</Button>
        <Button disabled={busy || !selected.length || invalid || reason.trim().length < 5} onClick={submit}><Undo2 /> Registrar {kind === 'TROCA' ? 'troca' : 'devolução'}</Button>
      </>
    }>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Tipo"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="DEVOLUCAO">Devolução</option><option value="TROCA">Troca</option></Select></Field>
          {kind !== 'TROCA' && <Field label="Reembolso"><Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}><option value="ESTORNO">Estorno ao cliente</option><option value="CREDITO">Crédito/abatimento em títulos</option><option value="NENHUM">Nenhum</option></Select></Field>}
          <Field label="Motivo *" className="md:col-span-2" hint={`${reason.trim().length}/5 caracteres mínimos`}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
          <Checkbox className="md:col-span-2" label="Emitir NF-e de devolução" checked={emitInvoice} onChange={(e) => setEmitInvoice(e.target.checked)} />
        </div>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead><tr><th>Item</th><th className="text-right">Vendido</th><th className="text-right">Disponível</th><th className="w-28 text-right">Qtd. a devolver</th><th className="text-center">Retornar ao estoque</th></tr></thead>
              <tbody>
                {items.map((it) => {
                  const a = avail(it);
                  const l = line(it.id);
                  const over = (Number(l.quantity) || 0) > a + 1e-9;
                  return (
                    <tr key={it.id}>
                      <td>{it.description || it.product?.name}</td>
                      <td className="num">{num(it.quantity, 3)}</td>
                      <td className="num">{num(a, 3)}</td>
                      <td><Input type="number" min={0} max={a} step="any" disabled={a <= 0} className={cn('h-8 text-right', over && 'border-red-500')} value={l.quantity} onChange={(e) => setLine(it.id, { quantity: e.target.value })} /></td>
                      <td className="text-center"><input type="checkbox" className="h-4 w-4" disabled={a <= 0} checked={l.restock} onChange={(e) => setLine(it.id, { restock: e.target.checked })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        {invalid && <p className="text-xs text-red-600">Há quantidades acima do disponível para devolução.</p>}
      </div>
    </Dialog>
  );
}

/** Desmembra itens (total ou parcialmente) de um pedido em aberto para um novo pedido */
function SplitDialog({ open, onOpenChange, order, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; order: any; onDone: (id: string) => void }) {
  const act = useAction();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setQty({}); }, [open]);
  const items: any[] = order.items || [];
  const selected = items.map((it) => ({ it, q: Number(qty[it.id]) || 0 })).filter((x) => x.q > 0);
  const invalid = selected.some((x) => x.q > Number(x.it.quantity) + 1e-9);
  const submit = async () => {
    setBusy(true);
    const r: any = await act('POST', `/api/sales-orders/${order.id}/split`, { items: selected.map((x) => ({ itemId: x.it.id, quantity: x.q })) }, false);
    setBusy(false);
    if (r?.id) {
      toast.success(`Pedido nº ${r.number} criado a partir do desmembramento`);
      onOpenChange(false);
      onDone(r.id);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={`Desmembrar pedido nº ${order.number}`} description="Os itens/quantidades informados são movidos para um novo pedido do mesmo cliente (ex.: entrega parcial ou faturamento separado)." footer={
      <>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Voltar</Button>
        <Button disabled={busy || !selected.length || invalid} onClick={submit}><Split /> Desmembrar</Button>
      </>
    }>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead><tr><th>Item</th><th className="text-right">Qtd. no pedido</th><th className="text-right">Unitário</th><th className="w-36 text-right">Qtd. para novo pedido</th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>{it.description || it.product?.name}</td>
                  <td className="num">{num(it.quantity, 3)}</td>
                  <td className="num">{money(it.unitPrice)}</td>
                  <td><Input type="number" min={0} max={it.quantity} step="any" className={cn('h-8 text-right', (Number(qty[it.id]) || 0) > Number(it.quantity) && 'border-red-500')} value={qty[it.id] || ''} onChange={(e) => setQty({ ...qty, [it.id]: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {invalid && <p className="mt-2 text-xs text-red-600">Quantidade maior que a do pedido.</p>}
    </Dialog>
  );
}

/** Gerar etiqueta: cota o frete do pedido e envia a opção escolhida (com conta real conectada, a etiqueta é comprada na hora) */
function ShipmentDialog({ order, onClose }: { order: any; onClose: () => void }) {
  const act = useAction();
  const [q, setQ] = useState<{ real: boolean; options: any[]; errors: string[]; package?: any } | null>(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<any>('/api/logistics/quote', { method: 'POST', json: { orderId: order.id } })
      .then((r) => { setQ(r); const i = r.options.findIndex((x: any) => order.shippingService && x.service.startsWith(order.shippingService)); setSel(Math.max(i, 0)); })
      .catch((e) => setError((e as Error).message));
  }, [order.id, order.shippingService]);
  const opt = q?.options[sel];
  const submit = async () => {
    if (!opt) return;
    setBusy(true);
    const r = await act('POST', `/api/sales-orders/${order.id}/shipment`, { option: { provider: opt.provider, carrier: opt.carrier, service: opt.service, serviceId: opt.serviceId } }, opt.simulated ? 'Etiqueta gerada' : 'Etiqueta comprada');
    setBusy(false);
    if (r !== undefined) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title={`Etiqueta de envio — pedido nº ${order.number}`}
      description={q?.package ? `Pacote: ${num(q.package.weight, 3)} kg · ${q.package.length}×${q.package.width}×${q.package.height} cm` : 'Cotando o frete…'}
      footer={<><Button variant="outline" onClick={onClose}>Voltar</Button><Button disabled={busy || !opt} onClick={submit}><Truck /> {opt && !opt.simulated ? `Comprar etiqueta (${money(opt.price)})` : 'Gerar etiqueta'}</Button></>}>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!q && !error && <p className="text-sm text-muted-foreground">Consultando transportadoras…</p>}
      {q && (
        <div className="space-y-2">
          {!q.real && <p className="rounded-md border bg-muted/40 p-2 text-xs">Cotação simulada — conecte Melhor Envio ou Correios em Integrações → Contas para comprar etiquetas reais.</p>}
          {q.errors?.length > 0 && <p className="text-xs text-amber-700">{q.errors.join(' · ')}</p>}
          {q.options.map((x: any, i: number) => (
            <label key={i} className={cn('flex cursor-pointer items-center gap-3 rounded-md border p-2 text-sm', i === sel && 'border-primary bg-primary/5')}>
              <input type="radio" checked={i === sel} onChange={() => setSel(i)} />
              <span className="flex-1"><b>{x.carrier}</b> {x.service} {x.simulated ? <Badge tone="gray">simulado</Badge> : <Badge tone="green">{x.provider === 'CORREIOS' ? 'Correios' : 'Melhor Envio'}</Badge>}</span>
              <span className="text-muted-foreground">{x.deadlineDays} dia(s)</span>
              <span className="w-24 text-right font-medium tabular-nums">{money(x.price)}</span>
            </label>
          ))}
          {!q.options.length && <p className="text-sm text-muted-foreground">Nenhuma opção de frete para este destino.</p>}
          {opt && !opt.simulated && <p className="text-xs text-muted-foreground">A etiqueta será comprada agora na conta conectada e o valor debitado do saldo da transportadora/intermediador.</p>}
        </div>
      )}
    </Dialog>
  );
}
