'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Save, Send, CheckCircle2, XCircle, Printer, ShoppingCart } from 'lucide-react';
import { useApi, useAction, openFile } from '@/lib/api';
import { PageHeader, Field } from '@/components/common/page';
import { EntityPicker, contactOption } from '@/components/common/picker';
import { ItemsEditor, toRows, fromRows, newItem, itemTotal, type ItemRow } from '@/components/common/items';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { money, toInputDate, round2, addDays } from '@/lib/utils';

export default function QuoteForm() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'novo';
  const router = useRouter();
  const act = useAction();
  const { data } = useApi<any>(isNew ? null : `/api/quotes/${id}`);
  const { data: lists } = useApi<any>('/api/r/price-lists?pageSize=100');
  const { data: sellers } = useApi<any>('/api/r/sellers?kind=VENDEDOR');
  const [q, setQ] = useState<any>({ discount: 0, freight: 0, validUntil: toInputDate(addDays(new Date(), 15)) });
  const [items, setItems] = useState<ItemRow[]>([newItem()]);
  useEffect(() => { if (data) { setQ({ ...data, validUntil: toInputDate(data.validUntil), customerLabel: data.customer.name }); setItems(toRows(data.items)); } }, [data]);
  const editable = isNew || ['RASCUNHO', 'ENVIADA'].includes(q.status);
  const total = round2(items.reduce((a, i) => a + itemTotal(i), 0) - Number(q.discount || 0) + Number(q.freight || 0));
  const save = async () => {
    const body = { customerId: q.customerId, sellerId: q.sellerId, priceListId: q.priceListId, validUntil: q.validUntil, discount: q.discount, freight: q.freight, paymentTerms: q.paymentTerms, deliveryTerms: q.deliveryTerms, notes: q.notes, items: fromRows(items) };
    const r = isNew ? await act('POST', '/api/quotes', body, 'Proposta criada') : await act('PUT', `/api/quotes/${id}`, body, 'Proposta salva');
    if (r && isNew) router.replace(`/vendas/propostas/${(r as any).id}`);
  };
  const run = (a: string, m: string) => act('POST', `/api/quotes/${id}/${a}`, {}, m);
  return (
    <div>
      <PageHeader title={isNew ? 'Nova proposta comercial' : `Proposta nº ${q.number}`} badge={!isNew && <StatusBadge status={q.status} />} actions={<>
        <Button variant="outline" onClick={() => router.push('/vendas/propostas')}><ArrowLeft /> Voltar</Button>
        {!isNew && <Button variant="outline" onClick={() => openFile(`/api/quotes/${id}/pdf`)}><Printer /> PDF</Button>}
        {!isNew && q.status === 'RASCUNHO' && <Button variant="outline" onClick={() => run('send', 'Proposta enviada ao cliente (e-mail simulado)')}><Send /> Enviar</Button>}
        {!isNew && ['RASCUNHO', 'ENVIADA'].includes(q.status) && <Button variant="outline" onClick={() => run('reject', 'Proposta recusada')}><XCircle /> Recusada</Button>}
        {!isNew && ['RASCUNHO', 'ENVIADA'].includes(q.status) && <Button variant="outline" onClick={() => run('approve', 'Proposta aprovada — automação converteu em pedido')}><CheckCircle2 /> Aprovar</Button>}
        {!isNew && ['RASCUNHO', 'ENVIADA', 'APROVADA'].includes(q.status) && <Button onClick={async () => { const r: any = await run('convert', 'Pedido de venda gerado'); if (r) router.push(`/vendas/${r.id}`); }}><ShoppingCart /> Gerar pedido</Button>}
        {q.salesOrderId && <Button asChild><Link href={`/vendas/${q.salesOrderId}`}>Ver pedido gerado</Link></Button>}
        {editable && <Button variant="outline" onClick={save}><Save /> Salvar</Button>}
      </>} />
      <Card className="mb-3"><CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Cliente *" className="md:col-span-2"><EntityPicker disabled={!editable} endpoint="/api/r/contacts?type=CLIENTE" value={q.customerId} label={q.customerLabel} map={contactOption} onChange={(v, raw) => setQ({ ...q, customerId: v, customerLabel: raw?.name, priceListId: raw?.priceListId || q.priceListId })} /></Field>
        <Field label="Validade"><Input disabled={!editable} type="date" value={q.validUntil || ''} onChange={(e) => setQ({ ...q, validUntil: e.target.value })} /></Field>
        <Field label="Vendedor"><Select disabled={!editable} value={q.sellerId || ''} onChange={(e) => setQ({ ...q, sellerId: e.target.value })}><option value="">—</option>{sellers?.rows.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Lista de preço"><Select disabled={!editable} value={q.priceListId || ''} onChange={(e) => setQ({ ...q, priceListId: e.target.value })}><option value="">Padrão</option>{lists?.rows.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Condições de pagamento"><Input disabled={!editable} value={q.paymentTerms || ''} onChange={(e) => setQ({ ...q, paymentTerms: e.target.value })} /></Field>
        <Field label="Prazo de entrega" className="md:col-span-2"><Input disabled={!editable} value={q.deliveryTerms || ''} onChange={(e) => setQ({ ...q, deliveryTerms: e.target.value })} /></Field>
      </CardContent></Card>
      <ItemsEditor items={items} onChange={setItems} priceListId={q.priceListId} readOnly={!editable} />
      <Card className="mt-3"><CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Desconto"><Input disabled={!editable} type="number" step="0.01" value={q.discount} onChange={(e) => setQ({ ...q, discount: e.target.value })} /></Field>
        <Field label="Frete"><Input disabled={!editable} type="number" step="0.01" value={q.freight} onChange={(e) => setQ({ ...q, freight: e.target.value })} /></Field>
        <Field label="Total da proposta"><div className="pt-1 text-xl font-bold">{money(total)}</div></Field>
        <Field label="Observações" className="col-span-2 md:col-span-4"><Textarea disabled={!editable} value={q.notes || ''} onChange={(e) => setQ({ ...q, notes: e.target.value })} /></Field>
      </CardContent></Card>
    </div>
  );
}
