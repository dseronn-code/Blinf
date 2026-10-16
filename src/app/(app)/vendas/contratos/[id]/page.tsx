'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Save, Receipt, Pause, Play, XCircle, Percent } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, Field, DataTable, KV } from '@/components/common/page';
import { EntityPicker, contactOption } from '@/components/common/picker';
import { ItemsEditor, toRows, newItem, itemTotal, type ItemRow } from '@/components/common/items';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { useCan } from '@/components/layout/me';
import { money, fmtDate, fmtDateTime, toInputDate, round2 } from '@/lib/utils';
import { INTERVAL_LABEL, INVOICE_LABEL, ContractStatus } from '../shared';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const periodLabel = (p: string) => (p.startsWith('REAJ-') ? `Reajuste ${p.slice(5)}` : `${p.slice(5)}/${p.slice(0, 4)}`);

/** Itens do editor → itens do contrato (desconto da linha incorporado ao preço unitário) */
function toContractItems(rows: ItemRow[]) {
  return rows
    .filter((r) => r.productId || r.serviceId || r.description)
    .map((r) => {
      const quantity = Number(r.quantity) || 0;
      const unitPrice = quantity ? round2(itemTotal(r) / quantity) : 0;
      return { kind: r.kind || 'SERVICO', serviceId: r.serviceId || null, productId: r.productId || null, description: r.description || r.label || '', quantity, unitPrice };
    });
}

export default function ContractPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'novo';
  const router = useRouter();
  const act = useAction();
  const canEdit = useCan()('vendas', 'edit');
  const { data } = useApi<any>(isNew ? null : `/api/contracts/${id}`);
  const { data: sellers } = useApi<any>('/api/r/sellers');
  const [c, setC] = useState<any>({ interval: 'MENSAL', billingDay: 10, startDate: ymd(new Date()), paymentMethod: 'BOLETO', invoiceModel: 'NFSE', adjustPercent: 0, description: '' });
  const [items, setItems] = useState<ItemRow[]>([newItem('SERVICO')]);
  const [bill, setBill] = useState<{ period: string } | null>(null);
  useEffect(() => {
    if (!data) return;
    setC({ ...data, startDate: toInputDate(data.startDate), endDate: toInputDate(data.endDate), customerLabel: data.customer?.name });
    setItems(toRows(data.items));
  }, [data]);
  const editable = canEdit && (isNew || c.status !== 'ENCERRADO');
  const total = round2(items.reduce((a, i) => a + itemTotal(i), 0));
  const set = (patch: any) => setC((x: any) => ({ ...x, ...patch }));

  const save = async () => {
    const body = { ...c, items: toContractItems(items), billingDay: Number(c.billingDay), adjustPercent: Number(c.adjustPercent) || 0, endDate: c.endDate || null };
    const r = isNew ? await act<any>('POST', '/api/contracts', body, 'Contrato cadastrado') : await act('PUT', `/api/contracts/${id}`, body, 'Contrato salvo');
    if (r && isNew) router.replace(`/vendas/contratos/${r.id}`);
  };
  const action = (a: string, msg: string) => act('POST', `/api/contracts/${id}/${a}`, {}, msg);
  const doBill = async () => {
    const r = await act<any>('POST', `/api/contracts/${id}/bill`, { period: bill?.period || undefined }, false);
    if (r) {
      (r.created ? toast.success : toast.info)(r.message);
      setBill(null);
    }
  };
  const billings = (data?.billings || []) as any[];

  return (
    <div>
      <PageHeader title={isNew ? 'Novo contrato' : `Contrato nº ${c.number ?? ''}`} badge={!isNew && c.status && <ContractStatus status={c.status} />} description={!isNew && data?.customer?.name} actions={<>
        <Button variant="outline" onClick={() => router.push('/vendas/contratos')}><ArrowLeft /> Voltar</Button>
        {!isNew && canEdit && c.status === 'ATIVO' && <Button variant="outline" onClick={() => setBill({ period: '' })}><Receipt /> Faturar agora</Button>}
        {!isNew && canEdit && c.status === 'ATIVO' && <Button variant="outline" onClick={() => action('suspend', 'Contrato suspenso')}><Pause /> Suspender</Button>}
        {!isNew && canEdit && c.status === 'SUSPENSO' && <Button variant="outline" onClick={() => action('activate', 'Contrato reativado')}><Play /> Reativar</Button>}
        {!isNew && canEdit && c.status !== 'ENCERRADO' && Number(c.adjustPercent) > 0 && <Button variant="outline" onClick={() => action('adjust', 'Reajuste verificado')}><Percent /> Aplicar reajuste</Button>}
        {!isNew && canEdit && c.status !== 'ENCERRADO' && <Button variant="outline" onClick={() => confirm('Encerrar o contrato? Não haverá novas cobranças.') && action('close', 'Contrato encerrado')}><XCircle /> Encerrar</Button>}
        {editable && <Button onClick={save}><Save /> Salvar</Button>}
      </>} />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <Card><CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Cliente *" className="md:col-span-2"><EntityPicker disabled={!editable} endpoint="/api/r/contacts?type=CLIENTE" value={c.customerId} label={c.customerLabel} map={contactOption} onChange={(v, raw) => set({ customerId: v, customerLabel: raw?.name })} /></Field>
            <Field label="Descrição *" className="md:col-span-2"><Input disabled={!editable} value={c.description || ''} onChange={(e) => set({ description: e.target.value })} placeholder="Ex.: Suporte de TI mensal" /></Field>
            <Field label="Periodicidade"><Select disabled={!editable} value={c.interval} onChange={(e) => set({ interval: e.target.value })}>{Object.entries(INTERVAL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Dia da cobrança" hint="Em meses mais curtos, usa o último dia"><Input disabled={!editable} type="number" min={1} max={31} value={c.billingDay} onChange={(e) => set({ billingDay: e.target.value })} /></Field>
            <Field label="Início *"><Input disabled={!editable} type="date" value={c.startDate || ''} onChange={(e) => set({ startDate: e.target.value })} /></Field>
            <Field label="Término" hint="Vazio = prazo indeterminado"><Input disabled={!editable} type="date" value={c.endDate || ''} onChange={(e) => set({ endDate: e.target.value })} /></Field>
            <Field label="Forma de pagamento"><Select disabled={!editable} value={c.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value })}><option value="BOLETO">Boleto</option><option value="PIX">Pix</option><option value="CARTAO_CREDITO">Cartão de crédito</option><option value="DEBITO_AUTOMATICO">Débito automático</option><option value="TRANSFERENCIA">Transferência</option></Select></Field>
            <Field label="Nota fiscal"><Select disabled={!editable} value={c.invoiceModel} onChange={(e) => set({ invoiceModel: e.target.value })}>{Object.entries(INVOICE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Reajuste anual (%)" hint="Aplicado no aniversário do contrato"><Input disabled={!editable} type="number" step="0.01" value={c.adjustPercent} onChange={(e) => set({ adjustPercent: e.target.value })} /></Field>
            <Field label="Vendedor"><Select disabled={!editable} value={c.sellerId || ''} onChange={(e) => set({ sellerId: e.target.value || null })}><option value="">—</option>{sellers?.rows?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Field label="Observações" className="md:col-span-4"><Textarea disabled={!editable} value={c.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
          </CardContent></Card>
          <ItemsEditor items={items} onChange={setItems} readOnly={!editable} />
          {!isNew && (
            <Card>
              <CardHeader><CardTitle>Histórico de faturamentos</CardTitle></CardHeader>
              <DataTable rows={billings} empty="Nenhum período faturado ainda" columns={[
                { key: 'period', header: 'Período', cell: (r: any) => (r.adjustment ? <Badge tone="purple">{periodLabel(r.period)}</Badge> : <b>{periodLabel(r.period)}</b>) },
                { key: 'createdAt', header: 'Gerado em', cell: (r: any) => fmtDateTime(r.createdAt) },
                { key: 'amount', header: 'Valor', align: 'right', cell: (r: any) => money(r.amount) },
                { key: 'entry', header: 'Conta a receber', cell: (r: any) => (r.entry ? <span className="flex items-center gap-2">{fmtDate(r.entry.dueDate)} <StatusBadge status={r.entry.status} /></span> : r.adjustment ? 'Novo valor do contrato' : '—') },
                { key: 'invoice', header: 'Nota', cell: (r: any) => (r.invoice ? <Link className="text-primary hover:underline" href={`/fiscal/notas/${r.invoice.id}`} onClick={(e) => e.stopPropagation()}>{r.invoice.model === 'NFSE' ? 'NFS-e' : 'NF-e'} nº {r.invoice.number} <StatusBadge status={r.invoice.status} /></Link> : '—') },
              ]} />
            </Card>
          )}
        </div>
        <div className="space-y-3">
          <Card><CardContent className="space-y-2 text-sm">
            <div className="flex justify-between text-lg font-bold"><span>Valor por cobrança</span><span>{money(total)}</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Periodicidade</span><span>{INTERVAL_LABEL[c.interval]}</span></div>
            {!isNew && <div className="flex justify-between text-muted-foreground"><span>Equivalente mensal (MRR)</span><span>{money(data?.monthly)}</span></div>}
          </CardContent></Card>
          {!isNew && data && (
            <Card><CardContent className="grid grid-cols-2 gap-3">
              <KV label="Próxima cobrança" value={c.status === 'ATIVO' ? fmtDate(data.nextBillingDate) : '—'} />
              <KV label="Períodos faturados" value={billings.filter((b) => !b.adjustment).length} />
              <KV label="Total faturado" value={money(billings.filter((b) => !b.adjustment).reduce((s, b) => s + b.amount, 0))} />
              <KV label="Em aberto" value={money(billings.reduce((s, b) => s + (b.entry && b.entry.status !== 'PAGO' && b.entry.status !== 'CANCELADO' ? b.entry.amount - b.entry.paidAmount : 0), 0))} />
            </CardContent></Card>
          )}
          <Card className="p-4 text-xs text-muted-foreground">
            A rotina diária <b>Faturar contratos</b> (Automações) gera a conta a receber com boleto/Pix e a nota de cada contrato ativo alguns dias antes do vencimento. Cada período é faturado uma única vez.
          </Card>
        </div>
      </div>
      <Dialog open={!!bill} onOpenChange={(o) => !o && setBill(null)} title="Faturar contrato" description="Gera a conta a receber e a nota fiscal do período" size="sm" footer={<Button onClick={doBill}><Receipt /> Faturar</Button>}>
        {bill && <div className="space-y-3">
          <Field label="Período (AAAA-MM)" hint={`Vazio = próxima cobrança (${data ? fmtDate(data.nextBillingDate) : ''})`}><Input type="month" value={bill.period} onChange={(e) => setBill({ period: e.target.value })} /></Field>
        </div>}
      </Dialog>
    </div>
  );
}
