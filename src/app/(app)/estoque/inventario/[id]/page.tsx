'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Printer, Save, CheckCircle2, XCircle, ScanBarcode, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, useApi, useAction, openFile } from '@/lib/api';
import { PageHeader, StatCard, Filters, Chips, SearchBox } from '@/components/common/page';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Checkbox } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { money, num, fmtDateTime, round2, round3, cn } from '@/lib/utils';

const STATUS: Record<string, [string, string]> = { ABERTO: ['Em contagem', 'yellow'], CONCLUIDO: ['Concluído', 'green'], CANCELADO: ['Cancelado', 'gray'] };
type View = 'all' | 'pending' | 'divergent';

/** Bipe curto para feedback do leitor (ignora se o navegador não suportar) */
function beep(ok: boolean) {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 1200 : 300;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
    osc.onended = () => ctx.close();
  } catch {
    /* sem áudio */
  }
}

export default function InventoryCountPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const act = useAction();
  const { data, isLoading, refetch } = useApi<any>(`/api/inventory/${id}`);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>('all');
  const [q, setQ] = useState('');
  const [code, setCode] = useState('');
  const [qty, setQty] = useState('1');
  const [scanning, setScanning] = useState(false);
  const [flash, setFlash] = useState<'ok' | 'err' | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [zero, setZero] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const open = data?.status === 'ABERTO';
  useEffect(() => {
    if (open) scanRef.current?.focus();
  }, [open]);

  const dirty = Object.keys(edits).length > 0;
  const items = useMemo(() => (data?.items || []).map((i: any) => {
    const raw = edits[i.productId];
    const counted = raw !== undefined ? (raw.trim() === '' ? null : Number(raw)) : i.counted;
    const diff = counted === null || counted === undefined || isNaN(counted) ? null : round3(counted - i.expected);
    const diffValue = diff === null ? null : round2(diff * (i.product?.costPrice || 0));
    return { ...i, counted: diff === null ? null : counted, diff, diffValue, input: raw !== undefined ? raw : i.counted === null ? '' : String(i.counted) };
  }), [data, edits]);
  const stats = useMemo(() => ({
    total: items.length,
    counted: items.filter((i: any) => i.counted !== null).length,
    divergent: items.filter((i: any) => i.diff !== null && Math.abs(i.diff) > 1e-9).length,
    impact: round2(items.reduce((a: number, i: any) => a + (i.diffValue || 0), 0)),
  }), [items]);
  const rows = items.filter((i: any) => {
    if (view === 'pending' && i.counted !== null) return false;
    if (view === 'divergent' && !(i.diff !== null && Math.abs(i.diff) > 1e-9)) return false;
    if (q) {
      const s = q.toLowerCase();
      const p = i.product || {};
      return [p.sku, p.name, p.gtin, p.location].some((v) => v && String(v).toLowerCase().includes(s));
    }
    return true;
  });

  const payload = () => Object.entries(edits).map(([productId, v]) => ({ productId, counted: v.trim() === '' ? null : Number(v) }));
  const saveCounts = async (silent = false) => {
    if (!dirty) return true;
    if (payload().some((x) => x.counted !== null && (isNaN(x.counted) || x.counted < 0))) {
      toast.error('Há quantidades contadas inválidas');
      return false;
    }
    const r = await act('POST', `/api/inventory/${id}/set`, { items: payload() }, silent ? false : 'Contagem salva');
    if (!r) return false;
    setEdits({});
    await refetch();
    return true;
  };

  const scan = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (!c || scanning) return;
    setScanning(true);
    try {
      if (dirty && !(await saveCounts(true))) return;
      const r: any = await api(`/api/inventory/${id}/scan`, { method: 'POST', json: { code: c, quantity: Number(qty) || 1 } });
      const known = (data?.items || []).find((i: any) => i.productId === r.productId);
      beep(true);
      setFlash('ok');
      setLastId(r.productId);
      toast.success(`${known ? `${known.product?.sku} — ${known.product?.name}` : 'Produto adicionado ao inventário'}: contado ${num(r.counted, 3)}`, { duration: 1800 });
      setCode('');
      setQty('1');
      await refetch();
    } catch (err) {
      beep(false);
      setFlash('err');
      toast.error((err as Error).message);
      scanRef.current?.select();
    } finally {
      setScanning(false);
      setTimeout(() => setFlash(null), 600);
      scanRef.current?.focus();
    }
  };

  const finish = async () => {
    setBusy(true);
    if (!(await saveCounts(true))) return setBusy(false);
    const r: any = await act('POST', `/api/inventory/${id}/finish`, { zeroNotCounted: zero }, false);
    setBusy(false);
    if (r) {
      toast.success(`Inventário concluído — ${r.adjusted} produto(s) ajustado(s)`);
      setFinishOpen(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    const r = await act('POST', `/api/inventory/${id}/cancel`, {}, 'Inventário cancelado');
    setBusy(false);
    if (r) {
      setEdits({});
      setCancelOpen(false);
    }
  };

  if (isLoading || !data) return <div className="py-20 text-center text-muted-foreground"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>;
  return (
    <div>
      <PageHeader title={`Inventário nº ${data.number}`} badge={<Badge tone={STATUS[data.status]?.[1]}>{STATUS[data.status]?.[0] || data.status}</Badge>}
        description={<>Depósito <b>{data.warehouse || '—'}</b> · aberto em {fmtDateTime(data.createdAt)}{data.finishedAt ? ` · encerrado em ${fmtDateTime(data.finishedAt)}` : ''}{data.notes ? ` · ${data.notes}` : ''}</>}
        actions={<>
          <Button variant="outline" onClick={() => router.push('/estoque/inventario')}><ArrowLeft /> Voltar</Button>
          <Button variant="outline" onClick={() => openFile(`/api/inventory/${id}/sheet`)}><Printer /> Imprimir folha de contagem</Button>
          {open && <Button variant="outline" className="text-destructive" onClick={() => setCancelOpen(true)}><XCircle /> Cancelar inventário</Button>}
          {open && <Button variant="outline" disabled={!dirty} onClick={() => saveCounts()}><Save /> Salvar contagem</Button>}
          {open && <Button onClick={() => { setZero(false); setFinishOpen(true); }}><CheckCircle2 /> Concluir e ajustar estoque</Button>}
        </>} />

      {open ? (
        <Card className={cn('mb-3 p-4 transition-colors', flash === 'ok' && 'border-green-500 bg-green-50', flash === 'err' && 'border-red-500 bg-red-50')}>
          <form onSubmit={scan} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[240px] flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Código de barras (GTIN) ou SKU</label>
              <div className="relative">
                <ScanBarcode className="absolute left-3 top-3 h-6 w-6 text-muted-foreground" />
                <Input ref={scanRef} autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Bipe ou digite o código e pressione Enter" className="h-12 pl-11 text-lg font-mono" />
              </div>
            </div>
            <div className="w-24">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Quantidade</label>
              <Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} className="h-12 text-right text-lg" />
            </div>
            <Button type="submit" className="h-12" disabled={scanning || !code.trim()}>{scanning ? <Loader2 className="animate-spin" /> : <ScanBarcode />} Contar</Button>
          </form>
          <p className="mt-2 text-[11px] text-muted-foreground">Cada leitura soma a quantidade ao contado do produto. Produtos lidos que não estavam na lista são incluídos automaticamente.</p>
        </Card>
      ) : (
        <div className="mb-3 rounded border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">Inventário {data.status === 'CONCLUIDO' ? 'concluído — o estoque foi ajustado conforme a contagem' : 'cancelado'}. Somente leitura.</div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Itens" value={stats.total} />
        <StatCard label="Contados" value={`${stats.counted} / ${stats.total}`} hint={`${stats.total ? Math.round((stats.counted / stats.total) * 100) : 0}% concluído`} tone="blue" />
        <StatCard label="Divergentes" value={stats.divergent} tone={stats.divergent ? 'red' : 'green'} />
        <StatCard label="Impacto em R$" value={money(stats.impact)} hint="Diferença × custo" tone={stats.impact < 0 ? 'red' : stats.impact > 0 ? 'green' : 'default'} />
      </div>

      <Filters>
        <Chips<View> value={view} onChange={setView} options={[{ value: 'all', label: `Todos (${stats.total})` }, { value: 'pending', label: `Não contados (${stats.total - stats.counted})` }, { value: 'divergent', label: `Divergentes (${stats.divergent})` }]} />
        <SearchBox value={q} onChange={setQ} placeholder="Filtrar por código, nome ou local…" />
        {dirty && <span className="text-xs font-medium text-amber-600">Alterações não salvas</span>}
      </Filters>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead>
              <tr><th>Local</th><th>Código</th><th>Produto</th><th>Un</th><th className="text-right">Sistema</th><th className="w-32 text-right">Contado</th><th className="text-right">Diferença</th><th className="text-right">Impacto</th></tr>
            </thead>
            <tbody>
              {!rows.length ? (
                <tr><td colSpan={8} className="py-10 text-center text-muted-foreground">Nenhum item neste filtro</td></tr>
              ) : rows.map((i: any) => {
                const div = i.diff !== null && Math.abs(i.diff) > 1e-9;
                return (
                  <tr key={i.id} className={cn(lastId === i.productId && 'bg-blue-50', div && i.diff < 0 && 'bg-red-50/60', div && i.diff > 0 && 'bg-green-50/60')}>
                    <td className="text-xs text-muted-foreground">{i.product?.location || '—'}</td>
                    <td><div className="font-mono text-xs">{i.product?.sku}</div>{i.product?.gtin && <div className="font-mono text-[10px] text-muted-foreground">{i.product.gtin}</div>}</td>
                    <td>{i.product?.name}</td>
                    <td className="text-xs">{i.product?.unit}</td>
                    <td className="num">{num(i.expected, 3)}</td>
                    <td>
                      {open ? (
                        <Input type="number" min={0} step="any" placeholder="—" value={i.input} onChange={(e) => setEdits({ ...edits, [i.productId]: e.target.value })} className={cn('h-8 text-right', edits[i.productId] !== undefined && 'border-amber-400')} />
                      ) : <div className="num">{i.counted === null ? '—' : num(i.counted, 3)}</div>}
                    </td>
                    <td className={cn('num font-semibold', div && i.diff < 0 && 'text-red-600', div && i.diff > 0 && 'text-green-700')}>{i.diff === null ? <span className="font-normal text-muted-foreground">não contado</span> : div ? `${i.diff > 0 ? '+' : ''}${num(i.diff, 3)}` : <Badge tone="green">OK</Badge>}</td>
                    <td className={cn('num', i.diffValue < 0 && 'text-red-600', i.diffValue > 0 && 'text-green-700')}>{i.diffValue === null ? '' : money(i.diffValue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={finishOpen} onOpenChange={setFinishOpen} size="sm" title="Concluir inventário" description="A contagem será salva e o saldo de cada produto contado será ajustado no estoque do depósito (movimento de balanço). Esta ação não pode ser desfeita." footer={
        <>
          <Button variant="outline" onClick={() => setFinishOpen(false)}>Voltar</Button>
          <Button disabled={busy} onClick={finish}><CheckCircle2 /> Concluir e ajustar</Button>
        </>
      }>
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded border p-2"><div className="text-[11px] text-muted-foreground">Contados</div><b>{stats.counted}</b></div>
            <div className="rounded border p-2"><div className="text-[11px] text-muted-foreground">Divergentes</div><b className="text-red-600">{stats.divergent}</b></div>
            <div className="rounded border p-2"><div className="text-[11px] text-muted-foreground">Impacto</div><b>{money(stats.impact)}</b></div>
          </div>
          {stats.total - stats.counted > 0 && <p className="text-xs text-amber-700">{stats.total - stats.counted} item(ns) não contado(s). Por padrão eles mantêm o saldo atual.</p>}
          <Checkbox label="Zerar itens não contados" checked={zero} onChange={(e) => setZero(e.target.checked)} />
        </div>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen} size="sm" title="Cancelar inventário" description="A contagem será descartada e nenhum ajuste de estoque será feito." footer={
        <>
          <Button variant="outline" onClick={() => setCancelOpen(false)}>Voltar</Button>
          <Button variant="destructive" disabled={busy} onClick={cancel}><XCircle /> Cancelar inventário</Button>
        </>
      }>
        <p className="text-sm">Deseja realmente cancelar o inventário nº {data.number}?</p>
      </Dialog>
    </div>
  );
}
