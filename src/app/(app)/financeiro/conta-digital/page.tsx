'use client';
import { useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, Send, Landmark, QrCode, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, Field, SimBanner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { money, fmtDateTime, cn } from '@/lib/utils';

export default function DigitalAccount() {
  const { data: banks } = useApi<any>('/api/finance/banks');
  const digital = banks?.rows.find((b: any) => b.type === 'CONTA_DIGITAL');
  const [accId, setAccId] = useState<string>('');
  const acc = banks?.rows.find((b: any) => b.id === (accId || digital?.id));
  const { data: tx } = useApi<any>(acc ? `/api/finance/transactions?bankAccountId=${acc.id}&pageSize=200` : null);
  const act = useAction();
  const [tr, setTr] = useState<any>(null);
  const [receipt, setReceipt] = useState<any>(null);
  const send = async () => {
    const r: any = await act('POST', '/api/finance/transfer', { ...tr, fromId: acc.id }, 'Transferência realizada');
    if (r) { setTr(null); if (r.receipt) setReceipt(r.receipt); }
  };
  return (
    <div>
      <PageHeader title="Conta Digital PJ" description="Saldo, extrato, Pix, TED e transferências entre contas — integrada ao financeiro (boletos e Pix recebidos caem aqui)" />
      <SimBanner>conta digital fictícia "GestãoPro Bank"; transferências e Pix não movimentam dinheiro real.</SimBanner>
      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_2fr]">
        <Card className="bg-gradient-to-br from-emerald-700 to-emerald-900 text-white">
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between"><span className="text-sm text-white/70">{acc?.name}</span><Landmark className="h-5 w-5 text-white/70" /></div>
            <div className="text-3xl font-bold tabular-nums">{money(acc?.balance)}</div>
            <div className="text-xs text-white/70">Ag. {acc?.agency} · Conta {acc?.accountNumber} · Banco {acc?.bankCode}</div>
            {acc?.pixKey && <div className="flex items-center gap-2 text-xs"><QrCode className="h-4 w-4" /> Chave Pix: {acc.pixKey}<button onClick={() => { navigator.clipboard.writeText(acc.pixKey); toast.success('Chave copiada'); }}><Copy className="h-3.5 w-3.5" /></button></div>}
            <div className="flex gap-2 pt-2">
              <Button size="sm" variant="secondary" onClick={() => setTr({ kind: 'PIX' })}><Send /> Pix</Button>
              <Button size="sm" variant="secondary" onClick={() => setTr({ kind: 'TED' })}>TED</Button>
              <Button size="sm" variant="secondary" onClick={() => setTr({ kind: 'INTERNA' })}>Entre contas</Button>
            </div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {banks?.rows.map((b: any) => (
            <button key={b.id} onClick={() => setAccId(b.id)} className={cn('rounded-lg border bg-card p-3 text-left hover:border-primary', acc?.id === b.id && 'border-primary ring-1 ring-primary')}>
              <div className="text-xs text-muted-foreground">{b.name}</div>
              <div className="text-lg font-bold tabular-nums">{money(b.balance)}</div>
              {b.pending > 0 && <Badge tone="orange">{b.pending} a conciliar</Badge>}
            </button>
          ))}
          <div className="rounded-lg border border-dashed p-3 text-sm"><div className="text-xs text-muted-foreground">Saldo total</div><div className="text-lg font-bold">{money(banks?.total)}</div></div>
        </div>
      </div>
      <h3 className="mb-2 text-sm font-semibold">Extrato — {acc?.name}</h3>
      <DataTable rows={tx?.rows} columns={[
        { key: 'date', header: 'Data', cell: (r: any) => fmtDateTime(r.date) },
        { key: 'description', header: 'Descrição', cell: (r: any) => <div className="flex items-center gap-2">{r.amount >= 0 ? <ArrowDownLeft className="h-4 w-4 text-green-600" /> : <ArrowUpRight className="h-4 w-4 text-red-600" />}{r.description}</div> },
        { key: 'source', header: 'Tipo', cell: (r: any) => <Badge>{r.source}</Badge> },
        { key: 'reconciled', header: 'Conciliado', cell: (r: any) => (r.reconciled ? <Badge tone="green">sim</Badge> : <Badge tone="orange">pendente</Badge>) },
        { key: 'amount', header: 'Valor', align: 'right', cell: (r: any) => <b className={r.amount < 0 ? 'text-red-600' : 'text-green-700'}>{money(r.amount)}</b> },
        { key: 'balanceAfter', header: 'Saldo', align: 'right', cell: (r: any) => money(r.balanceAfter) },
      ]} />
      <Dialog open={!!tr} onOpenChange={(o) => !o && setTr(null)} title={tr?.kind === 'PIX' ? 'Enviar Pix' : tr?.kind === 'TED' ? 'Enviar TED (tarifa R$ 8,50)' : 'Transferência entre contas'} size="sm" footer={<Button onClick={send}>Confirmar</Button>}>
        {tr && <div className="space-y-3">
          {tr.kind === 'INTERNA' ? <Field label="Conta de destino"><Select value={tr.toId || ''} onChange={(e) => setTr({ ...tr, toId: e.target.value })}><option value="">—</option>{banks?.rows.filter((b: any) => b.id !== acc?.id).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
            : <Field label={tr.kind === 'PIX' ? 'Chave Pix do favorecido' : 'Favorecido (banco/agência/conta)'}><Input value={tr.recipient || ''} onChange={(e) => setTr({ ...tr, recipient: e.target.value })} /></Field>}
          <Field label="Valor (R$)"><Input type="number" step="0.01" value={tr.amount || ''} onChange={(e) => setTr({ ...tr, amount: e.target.value })} /></Field>
          <Field label="Descrição"><Input value={tr.description || ''} onChange={(e) => setTr({ ...tr, description: e.target.value })} /></Field>
        </div>}
      </Dialog>
      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)} title="Comprovante (simulado)" size="sm">
        {receipt && <div className="space-y-1 text-sm"><div className="text-2xl font-bold">{money(receipt.amount)}</div><div>Para: {receipt.recipient}</div><div>Data: {fmtDateTime(receipt.date)}</div><div className="break-all font-mono text-xs">ID: {receipt.e2e}</div></div>}
      </Dialog>
    </div>
  );
}
