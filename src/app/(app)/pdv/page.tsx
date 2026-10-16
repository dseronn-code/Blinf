'use client';
import { useEffect, useRef, useState } from 'react';
import { Banknote, CreditCard, QrCode, ScanBarcode, Trash2, Minus, Plus, Printer, Lock, Unlock, ArrowDownToLine, ArrowUpFromLine, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api, useApi, useAction, openFile } from '@/lib/api';
import { PageHeader, StatCard, DataTable, Field } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { money, num, round2, fmtDateTime, cn } from '@/lib/utils';
import { PAYMENT_METHODS } from '@/lib/labels';

type CartItem = { productId: string; sku: string; name: string; price: number; quantity: number; discount: number; available: number };
const METHODS = [
  { key: 'DINHEIRO', label: 'Dinheiro', icon: Banknote },
  { key: 'PIX', label: 'Pix', icon: QrCode },
  { key: 'CARTAO_DEBITO', label: 'Débito', icon: CreditCard },
  { key: 'CARTAO_CREDITO', label: 'Crédito', icon: CreditCard },
];

export default function PDV() {
  const { data } = useApi<any>('/api/pdv');
  const act = useAction();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [code, setCode] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [discount, setDiscount] = useState(0);
  const [doc, setDoc] = useState('');
  const [pay, setPay] = useState<{ method: string; amount: string; installments: number }[]>([]);
  const [cash, setCash] = useState<{ action: string } | null>(null);
  const [cashAmount, setCashAmount] = useState('');
  const [done, setDone] = useState<any>(null);
  const [wh, setWh] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const session = data?.session;
  useEffect(() => { if (data?.warehouses && !wh) setWh(data.warehouses.find((w: any) => w.code === 'LOJA')?.id || data.warehouses.find((w: any) => w.isDefault)?.id || ''); }, [data, wh]);
  const subtotal = round2(cart.reduce((a, i) => a + i.price * i.quantity - i.discount, 0));
  const total = round2(subtotal - discount);
  const paid = round2(pay.reduce((a, p) => a + (Number(p.amount) || 0), 0));
  const change = round2(Math.max(0, paid - total));
  const missing = round2(Math.max(0, total - paid));

  const add = (p: any) => {
    setCart((c) => {
      const ex = c.find((i) => i.productId === p.id);
      if (ex) return c.map((i) => (i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i));
      return [...c, { productId: p.id, sku: p.sku, name: p.name, price: p.price, quantity: 1, discount: 0, available: p.stock?.available ?? 0 }];
    });
    setCode('');
    setResults([]);
    ref.current?.focus();
  };
  const scan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    // Suporta "3*SKU" para multiplicar quantidade
    const [qtyStr, term] = code.includes('*') ? code.split('*') : ['1', code];
    const r = await api<any>(`/api/products?sellable=1&q=${encodeURIComponent(term.trim())}&pageSize=10`);
    const exact = r.rows.find((p: any) => p.gtin === term.trim() || p.sku.toLowerCase() === term.trim().toLowerCase());
    if (exact) {
      add(exact);
      if (Number(qtyStr) > 1) setCart((c) => c.map((i) => (i.productId === exact.id ? { ...i, quantity: i.quantity + Number(qtyStr) - 1 } : i)));
    } else if (r.rows.length === 1) add(r.rows[0]);
    else if (r.rows.length) setResults(r.rows);
    else toast.error('Produto não encontrado');
  };
  const finish = async () => {
    if (!cart.length) return toast.error('Carrinho vazio');
    const payments = pay.length ? pay.map((p) => ({ method: p.method, amount: Number(p.amount), installments: p.installments })) : [{ method: 'DINHEIRO', amount: total }];
    const r: any = await act('POST', '/api/pdv/sale', { items: cart.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.price, discount: i.discount })), discount, payments, customerDoc: doc, warehouseId: wh }, false);
    if (r) {
      setDone(r);
      setCart([]); setPay([]); setDiscount(0); setDoc('');
    }
  };
  const addPay = (method: string) => setPay((p) => [...p, { method, amount: String(missing || total), installments: 1 }]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); ref.current?.focus(); }
      if (e.key === 'F9') { e.preventDefault(); finish(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  if (!data) return null;
  if (!session) {
    return (
      <div>
        <PageHeader title="PDV / Frente de caixa" description="Abra o caixa para começar a vender" />
        <div className="grid gap-4 md:grid-cols-[360px_1fr]">
          <Card><CardHeader><CardTitle>Abertura de caixa</CardTitle></CardHeader><CardContent className="space-y-3">
            <Field label="Fundo de troco (R$)"><Input type="number" step="0.01" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} /></Field>
            <Button className="w-full" onClick={() => act('POST', '/api/pdv', { action: 'open', amount: Number(cashAmount) || 0 }, 'Caixa aberto')}><Unlock /> Abrir caixa</Button>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Últimos fechamentos</CardTitle></CardHeader>
            <DataTable rows={data.history} columns={[{ key: 'register', header: 'Caixa' }, { key: 'userName', header: 'Operador' }, { key: 'openedAt', header: 'Abertura', cell: (r: any) => fmtDateTime(r.openedAt) }, { key: 'closedAt', header: 'Fechamento', cell: (r: any) => fmtDateTime(r.closedAt) }, { key: 'expectedAmount', header: 'Esperado', align: 'right', cell: (r: any) => money(r.expectedAmount) }, { key: 'closingAmount', header: 'Contado', align: 'right', cell: (r: any) => money(r.closingAmount) }, { key: 'diff', header: 'Diferença', align: 'right', cell: (r: any) => <span className={(r.closingAmount - r.expectedAmount) < 0 ? 'text-red-600' : ''}>{money(r.closingAmount - r.expectedAmount)}</span> }]} />
          </Card>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">PDV · {session.register}</h1>
          <p className="text-xs text-muted-foreground">Operador {session.userName} · aberto {fmtDateTime(session.openedAt)} · F2 buscar · F9 finalizar · use 3*SKU para quantidade</p>
        </div>
        <div className="flex items-center gap-2">
          <Select className="w-48" value={wh} onChange={(e) => setWh(e.target.value)}>{data.warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
          <Button variant="outline" onClick={() => setCash({ action: 'suprimento' })}><ArrowDownToLine /> Suprimento</Button>
          <Button variant="outline" onClick={() => setCash({ action: 'sangria' })}><ArrowUpFromLine /> Sangria</Button>
          <Button variant="outline" onClick={() => setCash({ action: 'close' })}><Lock /> Fechar caixa</Button>
        </div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Vendas na sessão" value={data.summary?.sales ?? 0} />
        <StatCard label="Total vendido" value={money(data.summary?.total)} tone="green" />
        {['DINHEIRO', 'PIX', 'CARTAO_CREDITO'].map((m) => <StatCard key={m} label={PAYMENT_METHODS[m]} value={money(data.summary?.byMethod?.[m] || 0)} />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card className="flex min-h-[520px] flex-col">
          <CardContent className="relative">
            <form onSubmit={scan} className="flex gap-2">
              <div className="relative flex-1"><ScanBarcode className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" /><Input ref={ref} autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Leia o código de barras ou digite SKU / nome do produto" className="h-11 pl-10 text-base" /></div>
              <Button className="h-11"><Search /> Buscar</Button>
            </form>
            {results.length > 0 && (
              <div className="absolute left-4 right-4 z-10 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover shadow-lg">
                {results.map((p) => <button key={p.id} onClick={() => add(p)} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-accent"><span><span className="font-mono text-xs">{p.sku}</span> {p.name}</span><span>{money(p.price)} · disp. {num(p.stock?.available)}</span></button>)}
              </div>
            )}
          </CardContent>
          <div className="flex-1 overflow-y-auto border-t">
            <table className="table-dense w-full">
              <thead><tr><th>Produto</th><th className="text-right">Preço</th><th className="text-center">Qtd</th><th className="text-right">Desc.</th><th className="text-right">Total</th><th /></tr></thead>
              <tbody>
                {cart.map((i) => (
                  <tr key={i.productId}>
                    <td><div className="font-medium">{i.name}</div><div className="text-xs text-muted-foreground">{i.sku} · disponível {num(i.available)}</div></td>
                    <td className="num">{money(i.price)}</td>
                    <td className="text-center"><div className="inline-flex items-center gap-1"><Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setCart(cart.map((x) => (x.productId === i.productId ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))}><Minus /></Button><span className="w-8 text-center font-semibold">{i.quantity}</span><Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setCart(cart.map((x) => (x.productId === i.productId ? { ...x, quantity: x.quantity + 1 } : x)))}><Plus /></Button></div></td>
                    <td className="num"><Input type="number" step="0.01" className="ml-auto h-7 w-20 text-right" value={i.discount} onChange={(e) => setCart(cart.map((x) => (x.productId === i.productId ? { ...x, discount: Number(e.target.value) } : x)))} /></td>
                    <td className="num font-semibold">{money(i.price * i.quantity - i.discount)}</td>
                    <td><Button size="icon" variant="ghost" onClick={() => setCart(cart.filter((x) => x.productId !== i.productId))}><Trash2 className="text-destructive" /></Button></td>
                  </tr>
                ))}
                {!cart.length && <tr><td colSpan={6} className="py-20 text-center text-muted-foreground">Leia um produto para iniciar a venda</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="flex flex-col">
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-sidebar p-4 text-white"><div className="text-xs uppercase text-white/60">Total a pagar</div><div className="text-4xl font-bold tabular-nums">{money(total)}</div><div className="text-xs text-white/60">{cart.reduce((a, i) => a + i.quantity, 0)} itens · subtotal {money(subtotal)}</div></div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Desconto geral (R$)"><Input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} /></Field>
              <Field label="CPF/CNPJ na nota"><Input value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="opcional" /></Field>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Forma de pagamento</div>
              <div className="grid grid-cols-4 gap-2">{METHODS.map((m) => <button key={m.key} onClick={() => addPay(m.key)} className="flex flex-col items-center gap-1 rounded-md border py-2 text-xs hover:border-primary hover:bg-accent"><m.icon className="h-5 w-5" />{m.label}</button>)}</div>
            </div>
            {pay.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="w-24">{PAYMENT_METHODS[p.method]}</span>
                <Input type="number" step="0.01" className="h-8" value={p.amount} onChange={(e) => setPay(pay.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                {p.method === 'CARTAO_CREDITO' && <Select className="h-8 w-20" value={p.installments} onChange={(e) => setPay(pay.map((x, j) => (j === i ? { ...x, installments: Number(e.target.value) } : x)))}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}x</option>)}</Select>}
                <Button size="icon" variant="ghost" onClick={() => setPay(pay.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            ))}
            <div className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
              <div className="flex justify-between"><span>Recebido</span><span>{money(paid)}</span></div>
              <div className="flex justify-between"><span>Falta</span><span className={missing ? 'text-red-600' : ''}>{money(missing)}</span></div>
              <div className="flex justify-between text-base font-bold"><span>Troco</span><span className="text-green-700">{money(change)}</span></div>
            </div>
            <Button className="h-12 w-full text-base" disabled={!cart.length || (pay.length > 0 && missing > 0)} onClick={finish}>Finalizar venda (F9)</Button>
            <p className="text-center text-[11px] text-muted-foreground">Emite NFC-e (simulada), baixa o estoque e lança no caixa/financeiro automaticamente. Cartões passam na maquininha POS simulada.</p>
          </CardContent>
        </Card>
      </div>
      <Dialog open={!!done} onOpenChange={(o) => !o && setDone(null)} title="Venda finalizada!" size="sm" footer={<>{done?.invoice && <Button variant="outline" onClick={() => openFile(`/api/invoices/${done.invoice.id}/danfe`)}><Printer /> Imprimir NFC-e</Button>}<Button onClick={() => { setDone(null); ref.current?.focus(); }}>Nova venda</Button></>}>
        {done && <div className="space-y-2 text-center">
          <div className="text-sm text-muted-foreground">Pedido nº {done.order?.number}</div>
          <div className="text-3xl font-bold">{money(done.order?.total)}</div>
          {done.change > 0 && <div className="rounded-md bg-green-50 p-3 text-lg font-bold text-green-700">Troco: {money(done.change)}</div>}
          {done.invoice ? <div className={cn('text-sm', done.invoice.status === 'AUTORIZADA' ? 'text-green-700' : 'text-red-600')}>NFC-e nº {done.invoice.number} — {done.invoice.status}{done.invoice.rejectionReason ? `: ${done.invoice.rejectionReason}` : ''}</div> : <div className="text-xs text-muted-foreground">Venda sem documento fiscal (automação de NFC-e desativada)</div>}
        </div>}
      </Dialog>
      <Dialog open={!!cash} onOpenChange={(o) => !o && setCash(null)} title={cash?.action === 'close' ? 'Fechamento de caixa' : cash?.action === 'sangria' ? 'Sangria' : 'Suprimento'} size="sm" footer={<Button onClick={async () => { const r = await act('POST', '/api/pdv', { action: cash!.action, amount: Number(cashAmount) }, cash!.action === 'close' ? 'Caixa fechado' : 'Movimento registrado'); if (r) { setCash(null); setCashAmount(''); } }}>Confirmar</Button>}>
        {cash?.action === 'close' && <p className="mb-2 text-sm">Dinheiro esperado em caixa: <b>{money(data.summary?.expectedCash)}</b>. Informe o valor contado:</p>}
        <Input type="number" step="0.01" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} autoFocus placeholder="Valor (R$)" />
      </Dialog>
    </div>
  );
}
