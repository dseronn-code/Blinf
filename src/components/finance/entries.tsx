'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Plus, CheckCircle2, FileText, Link2, Download, Undo2, XCircle, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, useAction, qs, openFile } from '@/lib/api';
import { PageHeader, Filters, SearchBox, Chips, DataTable, Pagination, StatCard, Field } from '@/components/common/page';
import { EntityPicker, contactOption } from '@/components/common/picker';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown';
import { money, fmtDate, toInputDate, round2 } from '@/lib/utils';
import { PAYMENT_METHODS } from '@/lib/labels';

export function EntriesPage({ type }: { type: 'RECEBER' | 'PAGAR' }) {
  const sp = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(sp.get('status') || 'EM_ABERTO');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useApi<any>(`/api/finance/entries${qs({ type, q, status, from, to, page })}`);
  const { data: banks } = useApi<any>('/api/finance/banks');
  const { data: charts } = useApi<any>(`/api/r/chart-accounts?type=${type === 'RECEBER' ? 'RECEITA' : 'DESPESA'}&pageSize=200`);
  const { data: centers } = useApi<any>('/api/r/cost-centers');
  const act = useAction();
  const [newE, setNewE] = useState<any>(null);
  const [payE, setPayE] = useState<any>(null);
  const [link, setLink] = useState<any>(null);
  const isR = type === 'RECEBER';
  const create = async () => {
    const r = await act('POST', '/api/finance/entries', { ...newE, type }, 'Lançamento criado');
    if (r) setNewE(null);
  };
  const pay = async () => {
    const r = await act('POST', `/api/finance/entries/${payE.id}/pay`, payE.form, isR ? 'Recebimento registrado' : 'Pagamento registrado');
    if (r) setPayE(null);
  };
  return (
    <div>
      <PageHeader title={isR ? 'Contas a receber' : 'Contas a pagar'} description={isR ? 'Geradas automaticamente pelas vendas, OS, loja e marketplaces — com boleto, Pix e link de pagamento' : 'Geradas automaticamente pelas compras, NF-e de entrada, comissões e tarifas'}
        actions={<><Button variant="outline" onClick={() => openFile(`/api/reports/financeiro-${isR ? 'receber' : 'pagar'}${qs({ from, to, format: 'xlsx' })}`)}><Download /> Excel</Button><Button onClick={() => setNewE({ dueDate: toInputDate(new Date()), installments: 1, paymentMethod: isR ? 'BOLETO' : 'BOLETO' })}><Plus /> Novo lançamento</Button></>} />
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total (filtro)" value={money(data?.totals.amount)} />
        <StatCard label="Em aberto" value={money(data?.totals.open)} tone="blue" />
        <StatCard label="Vencido" value={money(data?.totals.overdue)} tone="red" />
        <StatCard label={isR ? 'Recebido' : 'Pago'} value={money(data?.totals.paid)} tone="green" />
      </div>
      <Filters>
        <SearchBox value={q} onChange={setQ} placeholder="Descrição, contato ou documento" />
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} title="Vencimento de" />
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} title="Vencimento até" />
        <Chips value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: 'EM_ABERTO', label: 'Em aberto' }, { value: 'VENCIDO', label: 'Vencidos' }, { value: 'PAGO', label: isR ? 'Recebidos' : 'Pagos' }, { value: '', label: 'Todos' }, { value: 'CANCELADO', label: 'Cancelados' }]} />
      </Filters>
      <DataTable loading={isLoading} rows={data?.rows} columns={[
        { key: 'dueDate', header: 'Vencimento', cell: (r: any) => <span className={r.effectiveStatus === 'VENCIDO' ? 'font-semibold text-red-600' : ''}>{fmtDate(r.dueDate)}</span> },
        { key: 'description', header: 'Descrição', cell: (r: any) => <div><div className="font-medium">{r.description}</div><div className="text-xs text-muted-foreground">{r.chartAccount?.name}{r.documentNumber ? ` · doc ${r.documentNumber}` : ''}</div></div> },
        { key: 'contactName', header: isR ? 'Cliente' : 'Fornecedor', cell: (r: any) => <span className="text-sm">{r.contactName || '—'}</span> },
        { key: 'origin', header: 'Origem', cell: (r: any) => <Badge>{r.origin}</Badge> },
        { key: 'paymentMethod', header: 'Forma', cell: (r: any) => <span className="text-xs">{PAYMENT_METHODS[r.paymentMethod] || r.paymentMethod || '—'}</span> },
        { key: 'amount', header: 'Valor', align: 'right', cell: (r: any) => money(r.amount) },
        { key: 'open', header: 'Em aberto', align: 'right', cell: (r: any) => <b>{money(r.status === 'PAGO' ? 0 : r.amount - r.paidAmount)}</b> },
        { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.effectiveStatus} /> },
        { key: 'a', header: '', align: 'right', cell: (r: any) => (
          <div className="flex justify-end gap-1">
            {['ABERTO', 'PARCIAL'].includes(r.status) && <Button size="sm" variant="outline" onClick={() => setPayE({ ...r, form: { amount: round2(r.amount - r.paidAmount), date: toInputDate(new Date()), bankAccountId: banks?.rows.find((b: any) => b.isDefault)?.id, method: r.paymentMethod, interest: 0, fine: 0, discount: 0 } })}><CheckCircle2 /> {isR ? 'Receber' : 'Pagar'}</Button>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="icon" variant="ghost">⋯</Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                {isR && <DropdownMenuItem onSelect={() => openFile(`/api/finance/entries/${r.id}/boleto`)}><FileText /> Boleto (PDF)</DropdownMenuItem>}
                {isR && r.status !== 'PAGO' && <DropdownMenuItem onSelect={async () => { const l: any = await act('POST', `/api/finance/entries/${r.id}/link`, {}, 'Link de pagamento criado'); if (l) setLink(l); }}><Link2 /> Gerar link de pagamento / Pix</DropdownMenuItem>}
                {r.paidAmount > 0 && <DropdownMenuItem onSelect={() => confirm('Estornar a baixa?') && act('POST', `/api/finance/entries/${r.id}/reverse`, {}, 'Baixa estornada')}><Undo2 /> Estornar baixa</DropdownMenuItem>}
                {r.status !== 'PAGO' && r.status !== 'CANCELADO' && <DropdownMenuItem onSelect={() => confirm('Cancelar lançamento?') && act('POST', `/api/finance/entries/${r.id}/cancel`, {}, 'Lançamento cancelado')}><XCircle /> Cancelar</DropdownMenuItem>}
                {r.originId && ['VENDA', 'PDV', 'LOJA', 'INTEGRACAO'].includes(r.origin) && <DropdownMenuItem asChild><Link href={`/vendas/${r.originId}`}>Ver pedido de origem</Link></DropdownMenuItem>}
                {r.originId && ['COMPRA', 'NFE_ENTRADA'].includes(r.origin) && <DropdownMenuItem asChild><Link href={`/compras/${r.originId}`}>Ver compra de origem</Link></DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) },
      ]} />
      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}

      <Dialog open={!!newE} onOpenChange={(o) => !o && setNewE(null)} title={isR ? 'Nova conta a receber' : 'Nova conta a pagar'} size="lg" footer={<Button onClick={create}>Salvar</Button>}>
        {newE && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Descrição *" className="col-span-2"><Input value={newE.description || ''} onChange={(e) => setNewE({ ...newE, description: e.target.value })} /></Field>
          <Field label={isR ? 'Cliente' : 'Fornecedor'} className="col-span-2"><EntityPicker endpoint={`/api/r/contacts?type=${isR ? 'CLIENTE' : 'FORNECEDOR'}`} value={newE.contactId} label={newE.contactLabel} map={contactOption} onChange={(v, raw) => setNewE({ ...newE, contactId: v, contactLabel: raw?.name })} /></Field>
          <Field label="Valor (R$) *"><Input type="number" step="0.01" value={newE.amount || ''} onChange={(e) => setNewE({ ...newE, amount: e.target.value })} /></Field>
          <Field label="1º vencimento"><Input type="date" value={newE.dueDate} onChange={(e) => setNewE({ ...newE, dueDate: e.target.value })} /></Field>
          <Field label="Parcelas" hint="divide o valor"><Input type="number" min={1} value={newE.installments} onChange={(e) => setNewE({ ...newE, installments: e.target.value })} /></Field>
          <Field label="Recorrência mensal" hint="repete o valor N meses"><Input type="number" min={0} value={newE.recurrence || ''} onChange={(e) => setNewE({ ...newE, recurrence: e.target.value })} /></Field>
          <Field label="Categoria (plano de contas)" className="col-span-2"><Select value={newE.chartAccountId || ''} onChange={(e) => setNewE({ ...newE, chartAccountId: e.target.value })}><option value="">—</option>{charts?.rows.map((c: any) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</Select></Field>
          <Field label="Centro de custo"><Select value={newE.costCenterId || ''} onChange={(e) => setNewE({ ...newE, costCenterId: e.target.value })}><option value="">—</option>{centers?.rows.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Forma de pagamento"><Select value={newE.paymentMethod || ''} onChange={(e) => setNewE({ ...newE, paymentMethod: e.target.value })}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Nº documento"><Input value={newE.documentNumber || ''} onChange={(e) => setNewE({ ...newE, documentNumber: e.target.value })} /></Field>
          <Field label="Competência"><Input type="date" value={newE.competenceDate || ''} onChange={(e) => setNewE({ ...newE, competenceDate: e.target.value })} /></Field>
          <Field label="Observações" className="col-span-2 md:col-span-4"><Textarea value={newE.notes || ''} onChange={(e) => setNewE({ ...newE, notes: e.target.value })} /></Field>
        </div>}
      </Dialog>

      <Dialog open={!!payE} onOpenChange={(o) => !o && setPayE(null)} title={isR ? 'Registrar recebimento' : 'Registrar pagamento'} description={payE?.description} footer={<Button onClick={pay}>Confirmar baixa</Button>}>
        {payE && <div className="grid grid-cols-2 gap-3">
          <Field label="Data"><Input type="date" value={payE.form.date} onChange={(e) => setPayE({ ...payE, form: { ...payE.form, date: e.target.value } })} /></Field>
          <Field label="Conta"><Select value={payE.form.bankAccountId || ''} onChange={(e) => setPayE({ ...payE, form: { ...payE.form, bankAccountId: e.target.value } })}>{banks?.rows.map((b: any) => <option key={b.id} value={b.id}>{b.name} ({money(b.balance)})</option>)}</Select></Field>
          <Field label="Juros"><Input type="number" step="0.01" value={payE.form.interest} onChange={(e) => setPayE({ ...payE, form: { ...payE.form, interest: e.target.value, amount: round2(payE.amount - payE.paidAmount + Number(e.target.value) + Number(payE.form.fine) - Number(payE.form.discount)) } })} /></Field>
          <Field label="Multa"><Input type="number" step="0.01" value={payE.form.fine} onChange={(e) => setPayE({ ...payE, form: { ...payE.form, fine: e.target.value, amount: round2(payE.amount - payE.paidAmount + Number(payE.form.interest) + Number(e.target.value) - Number(payE.form.discount)) } })} /></Field>
          <Field label="Desconto"><Input type="number" step="0.01" value={payE.form.discount} onChange={(e) => setPayE({ ...payE, form: { ...payE.form, discount: e.target.value, amount: round2(payE.amount - payE.paidAmount + Number(payE.form.interest) + Number(payE.form.fine) - Number(e.target.value)) } })} /></Field>
          <Field label="Valor da baixa" hint="menor que o saldo = baixa parcial"><Input type="number" step="0.01" value={payE.form.amount} onChange={(e) => setPayE({ ...payE, form: { ...payE.form, amount: e.target.value } })} /></Field>
          <Field label="Forma" className="col-span-2"><Select value={payE.form.method || ''} onChange={(e) => setPayE({ ...payE, form: { ...payE.form, method: e.target.value } })}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        </div>}
      </Dialog>

      <Dialog open={!!link} onOpenChange={(o) => !o && setLink(null)} title="Link de pagamento criado" size="sm">
        {link && <div className="space-y-2 text-sm">
          <p>Envie ao cliente. Ao pagar (simulado), a conta é baixada automaticamente.</p>
          <div className="flex gap-2"><Input readOnly value={`${typeof window !== 'undefined' ? window.location.origin : ''}/pagar/${link.slug}`} /><Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/pagar/${link.slug}`); toast.success('Copiado'); }}><Copy /></Button></div>
          <Button asChild className="w-full"><a href={`/pagar/${link.slug}`} target="_blank">Abrir página de pagamento</a></Button>
        </div>}
      </Dialog>
    </div>
  );
}
