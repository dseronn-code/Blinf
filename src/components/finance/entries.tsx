'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Plus, CheckCircle2, FileText, Link2, Download, Undo2, XCircle, Copy, Pencil, Trash2, Handshake, Receipt, ExternalLink, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { api, useApi, useAction, qs, openFile } from '@/lib/api';
import { PageHeader, Filters, SearchBox, Chips, DataTable, Pagination, StatCard, Field, useDemoMode } from '@/components/common/page';
import { EntityPicker, contactOption } from '@/components/common/picker';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown';
import { money, fmtDate, toInputDate, round2 } from '@/lib/utils';
import { PAYMENT_METHODS } from '@/lib/labels';

/** Provedores de cobrança real (Integrações → Contas) */
const GATEWAY_NAME: Record<string, string> = { ASAAS: 'Asaas', MERCADO_PAGO: 'Mercado Pago' };

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
  const { data: pg } = useApi<any>(type === 'RECEBER' ? '/api/finance/payment-links' : null);
  const gateway: { provider: string; name: string } | null = pg?.gateway || null;
  const act = useAction();
  const demo = useDemoMode();
  const emitCharge = async (r: any) => {
    const x: any = await act('POST', `/api/finance/entries/${r.id}/charge`, !gateway && !demo ? { method: 'PIX' } : {}, false);
    if (x) toast.success(x.simulated ? 'Cobrança simulada gerada (nenhum provedor conectado em Integrações → Contas)' : x.manual ? 'Pix copia e cola gerado para a chave da sua conta — a baixa é manual (confira o extrato)' : `Cobrança registrada no ${GATEWAY_NAME[x.provider] || x.provider}`);
  };
  const [newE, setNewE] = useState<any>(null);
  const [payE, setPayE] = useState<any>(null);
  const [link, setLink] = useState<any>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [reneg, setReneg] = useState<any>(null);
  const isR = type === 'RECEBER';
  const allocs: { costCenterId: string; percent: string | number }[] = newE?.allocations || [];
  const allocTotal = round2(allocs.reduce((a, x) => a + (Number(x.percent) || 0), 0));
  const setAlloc = (i: number, patch: Record<string, unknown>) => setNewE({ ...newE, allocations: allocs.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const create = async () => {
    if (allocs.length) {
      if (allocs.some((a) => !a.costCenterId || !(Number(a.percent) > 0))) return toast.error('Rateio: informe o centro de custo e o percentual de cada linha');
      if (new Set(allocs.map((a) => a.costCenterId)).size !== allocs.length) return toast.error('Rateio: centro de custo repetido');
      if (Math.abs(allocTotal - 100) > 0.01) return toast.error(`O rateio deve somar 100% (atual: ${allocTotal}%)`);
    }
    const allocations = allocs.map((a) => ({ costCenterId: a.costCenterId, percent: Number(a.percent) }));
    const r = newE.id
      ? await act('PUT', `/api/finance/entries/${newE.id}`, { description: newE.description, amount: newE.amount, dueDate: newE.dueDate, competenceDate: newE.competenceDate || undefined, chartAccountId: newE.chartAccountId, costCenterId: newE.costCenterId, paymentMethod: newE.paymentMethod, documentNumber: newE.documentNumber, notes: newE.notes, allocations }, 'Lançamento atualizado')
      : await act('POST', '/api/finance/entries', { ...newE, type, allocations }, 'Lançamento criado');
    if (r) setNewE(null);
  };
  const edit = async (row: any) => {
    try {
      const e = await api<any>(`/api/finance/entries/${row.id}`);
      setNewE({
        id: e.id, description: e.description, contactLabel: e.contactName, amount: e.amount, dueDate: toInputDate(e.dueDate), competenceDate: toInputDate(e.competenceDate),
        chartAccountId: e.chartAccountId || '', costCenterId: e.costCenterId || '', paymentMethod: e.paymentMethod || '', documentNumber: e.documentNumber || '', notes: e.notes || '',
        allocations: (e.allocations || []).map((a: any) => ({ costCenterId: a.costCenterId, percent: a.percent })),
      });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const openRows = (data?.rows || []).filter((r: any) => selected.includes(r.id) && ['ABERTO', 'PARCIAL'].includes(r.status));
  const renegOpen = round2(openRows.reduce((a: number, r: any) => a + r.amount - r.paidAmount, 0));
  const renegCustomers = new Set(openRows.map((r: any) => r.contactId || r.contactName));
  const renegInterest = reneg ? round2((renegOpen * (Number(reneg.interestPercent) || 0)) / 100) : 0;
  const renegTotal = reneg ? round2(renegOpen + renegInterest - (Number(reneg.discount) || 0)) : 0;
  const renegotiate = async () => {
    const r: any = await act('POST', '/api/finance/renegotiate', { entryIds: openRows.map((x: any) => x.id), installments: Number(reneg.installments) || 1, firstDueDate: reneg.firstDueDate, interestPercent: Number(reneg.interestPercent) || 0, discount: Number(reneg.discount) || 0, paymentMethod: reneg.paymentMethod }, false);
    if (!r) return;
    toast.success(`Acordo nº ${r.agreement} criado: ${money(r.total)} em ${r.entries?.length || reneg.installments} parcela(s)`);
    setReneg(null);
    setSelected([]);
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
        <Chips value={status} onChange={(v) => { setStatus(v); setPage(1); setSelected([]); }} options={[{ value: 'EM_ABERTO', label: 'Em aberto' }, { value: 'VENCIDO', label: 'Vencidos' }, { value: 'PAGO', label: isR ? 'Recebidos' : 'Pagos' }, { value: '', label: 'Todos' }, { value: 'CANCELADO', label: 'Cancelados' }]} />
        {isR && <Button variant="outline" className="ml-auto" disabled={!openRows.length} title="Selecione títulos em aberto de um mesmo cliente" onClick={() => setReneg({ installments: 1, firstDueDate: toInputDate(new Date(Date.now() + 7 * 86400000)), interestPercent: 0, discount: 0, paymentMethod: 'BOLETO' })}><Handshake /> Renegociar{openRows.length ? ` (${openRows.length})` : ''}</Button>}
      </Filters>
      <DataTable loading={isLoading} rows={data?.rows} selectable={isR} selected={selected} onSelect={setSelected} columns={[
        { key: 'dueDate', header: 'Vencimento', cell: (r: any) => <span className={r.effectiveStatus === 'VENCIDO' ? 'font-semibold text-red-600' : ''}>{fmtDate(r.dueDate)}</span> },
        { key: 'description', header: 'Descrição', cell: (r: any) => <div><div className="font-medium">{r.description}</div><div className="text-xs text-muted-foreground">{r.chartAccount?.name}{r.documentNumber ? ` · doc ${r.documentNumber}` : ''}</div></div> },
        { key: 'contactName', header: isR ? 'Cliente' : 'Fornecedor', cell: (r: any) => <span className="text-sm">{r.contactName || '—'}</span> },
        { key: 'origin', header: 'Origem', cell: (r: any) => <Badge>{r.origin}</Badge> },
        { key: 'paymentMethod', header: 'Forma', cell: (r: any) => <span className="text-xs">{PAYMENT_METHODS[r.paymentMethod] || r.paymentMethod || '—'}</span> },
        { key: 'amount', header: 'Valor', align: 'right', cell: (r: any) => money(r.amount) },
        { key: 'open', header: 'Em aberto', align: 'right', cell: (r: any) => <b>{money(r.status === 'PAGO' ? 0 : r.amount - r.paidAmount)}</b> },
        { key: 'status', header: 'Situação', cell: (r: any) => <div className="flex flex-col items-start gap-0.5"><StatusBadge status={r.effectiveStatus} />{isR && (r.provider ? <Badge tone="blue">{GATEWAY_NAME[r.provider] || r.provider}</Badge> : !demo ? (['ABERTO', 'PARCIAL'].includes(r.status) && ['BOLETO', 'PIX'].includes(r.paymentMethod) ? (r.pixPayload ? <Badge tone="gray">Pix estático · baixa manual</Badge> : <Badge tone="yellow">Sem cobrança registrada</Badge>) : null) : (r.boletoLine || r.pixPayload) && r.status !== 'PAGO' ? <Badge tone="yellow">Cobrança simulada</Badge> : null)}</div> },
        { key: 'a', header: '', align: 'right', cell: (r: any) => (
          <div className="flex justify-end gap-1">
            {['ABERTO', 'PARCIAL'].includes(r.status) && <Button size="sm" variant="outline" onClick={() => setPayE({ ...r, form: { amount: round2(r.amount - r.paidAmount), date: toInputDate(new Date()), bankAccountId: banks?.rows.find((b: any) => b.isDefault)?.id, method: r.paymentMethod, interest: 0, fine: 0, discount: 0 } })}><CheckCircle2 /> {isR ? 'Receber' : 'Pagar'}</Button>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="icon" variant="ghost">⋯</Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                {['ABERTO', 'PARCIAL'].includes(r.status) && <DropdownMenuItem onSelect={() => edit(r)}><Pencil /> Editar / rateio</DropdownMenuItem>}
                {isR && (demo || r.provider) && <DropdownMenuItem onSelect={() => openFile(`/api/finance/entries/${r.id}/boleto`)}><FileText /> {r.provider ? `Boleto / fatura (${GATEWAY_NAME[r.provider] || r.provider})` : 'Boleto (PDF)'}</DropdownMenuItem>}
                {isR && ['ABERTO', 'PARCIAL'].includes(r.status) && !r.provider && <DropdownMenuItem onSelect={() => emitCharge(r)}><Receipt /> {gateway ? `Emitir cobrança (${gateway.name})` : demo ? 'Emitir cobrança (simulada)' : 'Gerar Pix copia e cola (baixa manual)'}</DropdownMenuItem>}
                {isR && r.provider && r.paymentUrl && <DropdownMenuItem onSelect={() => window.open(r.paymentUrl, '_blank')}><ExternalLink /> Abrir no {GATEWAY_NAME[r.provider] || r.provider}</DropdownMenuItem>}
                {isR && r.provider && ['ABERTO', 'PARCIAL'].includes(r.status) && <DropdownMenuItem onSelect={() => confirm(`Cancelar a cobrança no ${GATEWAY_NAME[r.provider] || r.provider}? O título continua em aberto.`) && act('POST', `/api/finance/entries/${r.id}/cancel-charge`, {}, 'Cobrança cancelada')}><Ban /> Cancelar cobrança</DropdownMenuItem>}
                {isR && r.provider && r.paidAmount > 0 && <DropdownMenuItem onSelect={() => confirm(`Estornar o pagamento no ${GATEWAY_NAME[r.provider] || r.provider}? O valor volta ao cliente e o título é reaberto.`) && act('POST', `/api/finance/entries/${r.id}/refund-charge`, {}, 'Pagamento estornado')}><Undo2 /> Estornar no {GATEWAY_NAME[r.provider] || r.provider}</DropdownMenuItem>}
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
      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={(p) => { setPage(p); setSelected([]); }} />}

      <Dialog open={!!newE} onOpenChange={(o) => !o && setNewE(null)} title={newE?.id ? 'Editar lançamento' : isR ? 'Nova conta a receber' : 'Nova conta a pagar'} size="lg" footer={<Button onClick={create}>Salvar</Button>}>
        {newE && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Descrição *" className="col-span-2"><Input value={newE.description || ''} onChange={(e) => setNewE({ ...newE, description: e.target.value })} /></Field>
          {newE.id ? <Field label={isR ? 'Cliente' : 'Fornecedor'} className="col-span-2"><Input readOnly disabled value={newE.contactLabel || '—'} /></Field> : <Field label={isR ? 'Cliente' : 'Fornecedor'} className="col-span-2"><EntityPicker endpoint={`/api/r/contacts?type=${isR ? 'CLIENTE' : 'FORNECEDOR'}`} value={newE.contactId} label={newE.contactLabel} map={contactOption} onChange={(v, raw) => setNewE({ ...newE, contactId: v, contactLabel: raw?.name })} /></Field>}
          <Field label="Valor (R$) *"><Input type="number" step="0.01" value={newE.amount || ''} onChange={(e) => setNewE({ ...newE, amount: e.target.value })} /></Field>
          <Field label={newE.id ? 'Vencimento' : '1º vencimento'}><Input type="date" value={newE.dueDate} onChange={(e) => setNewE({ ...newE, dueDate: e.target.value })} /></Field>
          {!newE.id && <Field label="Parcelas" hint="divide o valor"><Input type="number" min={1} value={newE.installments} onChange={(e) => setNewE({ ...newE, installments: e.target.value })} /></Field>}
          {!newE.id && <Field label="Recorrência mensal" hint="repete o valor N meses"><Input type="number" min={0} value={newE.recurrence || ''} onChange={(e) => setNewE({ ...newE, recurrence: e.target.value })} /></Field>}
          <Field label="Categoria (plano de contas)" className="col-span-2"><Select value={newE.chartAccountId || ''} onChange={(e) => setNewE({ ...newE, chartAccountId: e.target.value })}><option value="">—</option>{charts?.rows.map((c: any) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</Select></Field>
          <Field label="Centro de custo" hint={allocs.length ? 'substituído pelo rateio' : undefined}><Select disabled={!!allocs.length} value={newE.costCenterId || ''} onChange={(e) => setNewE({ ...newE, costCenterId: e.target.value })}><option value="">—</option>{centers?.rows.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Forma de pagamento"><Select value={newE.paymentMethod || ''} onChange={(e) => setNewE({ ...newE, paymentMethod: e.target.value })}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Nº documento"><Input value={newE.documentNumber || ''} onChange={(e) => setNewE({ ...newE, documentNumber: e.target.value })} /></Field>
          <Field label="Competência"><Input type="date" value={newE.competenceDate || ''} onChange={(e) => setNewE({ ...newE, competenceDate: e.target.value })} /></Field>
          <Field label="Observações" className="col-span-2 md:col-span-4"><Textarea value={newE.notes || ''} onChange={(e) => setNewE({ ...newE, notes: e.target.value })} /></Field>
          <div className="col-span-2 rounded-md border p-3 md:col-span-4">
            <div className="mb-2 flex items-center justify-between">
              <div><div className="text-sm font-semibold">Rateio por centro de custo</div><p className="text-[11px] text-muted-foreground">Divide o valor do lançamento entre vários centros de custo. Os percentuais devem somar 100%.</p></div>
              <Button size="sm" variant="outline" onClick={() => setNewE({ ...newE, allocations: [...allocs, { costCenterId: '', percent: allocs.length ? round2(Math.max(0, 100 - allocTotal)) : 100 }] })}><Plus /> Adicionar centro</Button>
            </div>
            {allocs.length > 0 && <div className="space-y-2">
              {allocs.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select className="flex-1" value={a.costCenterId} onChange={(e) => setAlloc(i, { costCenterId: e.target.value })}><option value="">Selecione o centro de custo…</option>{centers?.rows.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
                  <div className="relative w-28"><Input type="number" step="0.01" min={0} max={100} className="pr-6 text-right" value={a.percent} onChange={(e) => setAlloc(i, { percent: e.target.value })} /><span className="absolute right-2 top-2 text-sm text-muted-foreground">%</span></div>
                  <span className="w-28 text-right text-xs tabular-nums text-muted-foreground">{money(round2((Number(newE.amount) || 0) * (Number(a.percent) || 0) / 100))}</span>
                  <Button size="icon" variant="ghost" onClick={() => setNewE({ ...newE, allocations: allocs.filter((_, j) => j !== i) })} title="Remover"><Trash2 /></Button>
                </div>
              ))}
              <div className={`text-right text-xs font-semibold ${Math.abs(allocTotal - 100) > 0.01 ? 'text-red-600' : 'text-green-700'}`}>Total: {allocTotal}%{Math.abs(allocTotal - 100) > 0.01 ? ' — deve somar 100%' : ''}</div>
            </div>}
          </div>
        </div>}
      </Dialog>

      <Dialog open={!!reneg} onOpenChange={(o) => !o && setReneg(null)} title="Renegociar títulos" description="Os títulos selecionados são cancelados e substituídos por um acordo com novo parcelamento" footer={<Button onClick={renegotiate} disabled={!openRows.length || renegCustomers.size > 1 || renegTotal <= 0}><Handshake /> Gerar acordo</Button>}>
        {reneg && <div className="space-y-3 text-sm">
          {renegCustomers.size > 1 && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">Os títulos selecionados são de clientes diferentes. Renegocie títulos de um único cliente por vez.</div>}
          <div className="max-h-40 divide-y overflow-y-auto rounded-md border">
            {openRows.map((r: any) => <div key={r.id} className="flex justify-between px-3 py-1.5 text-xs"><span>{r.description} <span className="text-muted-foreground">· {r.contactName || '—'} · venc. {fmtDate(r.dueDate)}</span></span><b>{money(r.amount - r.paidAmount)}</b></div>)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Parcelas"><Input type="number" min={1} value={reneg.installments} onChange={(e) => setReneg({ ...reneg, installments: e.target.value })} /></Field>
            <Field label="1º vencimento"><Input type="date" value={reneg.firstDueDate} onChange={(e) => setReneg({ ...reneg, firstDueDate: e.target.value })} /></Field>
            <Field label="Juros (%)" hint="sobre o saldo em aberto"><Input type="number" step="0.01" min={0} value={reneg.interestPercent} onChange={(e) => setReneg({ ...reneg, interestPercent: e.target.value })} /></Field>
            <Field label="Desconto (R$)"><Input type="number" step="0.01" min={0} value={reneg.discount} onChange={(e) => setReneg({ ...reneg, discount: e.target.value })} /></Field>
            <Field label="Forma de pagamento" className="col-span-2"><Select value={reneg.paymentMethod} onChange={(e) => setReneg({ ...reneg, paymentMethod: e.target.value })}><option value="BOLETO">Boleto</option><option value="PIX">Pix</option></Select></Field>
          </div>
          <div className="space-y-1 rounded-md border bg-muted/40 p-3">
            <div className="flex justify-between"><span>Saldo original ({openRows.length} título(s))</span><b>{money(renegOpen)}</b></div>
            <div className="flex justify-between"><span>+ Juros</span><span>{money(renegInterest)}</span></div>
            <div className="flex justify-between"><span>− Desconto</span><span>{money(Number(reneg.discount) || 0)}</span></div>
            <div className="flex justify-between border-t pt-1"><span>Total do acordo</span><b className={renegTotal <= 0 ? 'text-red-600' : ''}>{money(renegTotal)}</b></div>
            <div className="text-right text-xs text-muted-foreground">{Math.max(1, Number(reneg.installments) || 1)}x de {money(round2(renegTotal / Math.max(1, Number(reneg.installments) || 1)))}</div>
          </div>
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
          <p>Envie ao cliente. {gateway ? `O pagamento é processado pelo ${gateway.name} e a conta é baixada automaticamente.` : demo ? 'Ao pagar (simulado), a conta é baixada automaticamente.' : 'O cliente paga o Pix direto na chave da sua conta; confira o extrato e dê a baixa manualmente.'}</p>
          <div className="flex gap-2"><Input readOnly value={`${typeof window !== 'undefined' ? window.location.origin : ''}/pagar/${link.slug}`} /><Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/pagar/${link.slug}`); toast.success('Copiado'); }}><Copy /></Button></div>
          <Button asChild className="w-full"><a href={`/pagar/${link.slug}`} target="_blank">Abrir página de pagamento</a></Button>
        </div>}
      </Dialog>
    </div>
  );
}
