'use client';
import Link from 'next/link';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TrendingUp, ShoppingCart, Wallet, AlertTriangle, Package, Truck, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { useApi } from '@/lib/api';
import { PageHeader, StatCard } from '@/components/common/page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { money, num, fmtDate } from '@/lib/utils';
import { useMe } from '@/components/layout/me';

const COLORS = ['#16a34a', '#2563eb', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#64748b'];

export default function Dashboard() {
  const me = useMe();
  const { data } = useApi<any>('/api/dashboard');
  const k = data?.kpis;
  const growth = k?.prevMonth ? ((k.salesMonth - k.prevMonth) / k.prevMonth) * 100 : 0;
  return (
    <div>
      <PageHeader title="Meu Negócio" description={`Olá, ${me.user.name.split(' ')[0]}! Acompanhe os principais indicadores ${me.consolidated ? 'consolidados de todas as empresas' : 'da empresa'}.`} actions={<><Button asChild variant="outline"><Link href="/assistente">Perguntar à IA</Link></Button><Button asChild><Link href="/vendas/novo">Novo pedido</Link></Button></>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Vendas hoje" value={money(k?.salesToday)} hint={`${k?.ordersToday ?? 0} pedido(s)`} icon={ShoppingCart} />
        <StatCard label="Vendas no mês" value={money(k?.salesMonth)} hint={<span className={growth >= 0 ? 'text-green-700' : 'text-red-600'}>{growth >= 0 ? '▲' : '▼'} {num(Math.abs(growth), 1)}% vs mês anterior</span>} tone="green" icon={TrendingUp} />
        <StatCard label="Ticket médio" value={money(k?.avgTicket)} hint={`${k?.ordersMonth ?? 0} pedidos no mês`} />
        <StatCard label="Margem bruta" value={`${num(k?.grossMargin, 1)}%`} hint="após CMV e tarifas" tone="blue" />
        <StatCard label="Saldo em contas" value={money(k?.cashBalance)} icon={Wallet} tone="blue" />
        <StatCard label="A receber vencido" value={money(k?.receivableOverdue)} tone="red" icon={ArrowDownCircle} hint={`Hoje: ${money(k?.receivableToday)}`} />
        <StatCard label="A pagar vencido" value={money(k?.payableOverdue)} tone="amber" icon={ArrowUpCircle} hint={`Hoje: ${money(k?.payableToday)}`} />
        <StatCard label="Estoque baixo" value={k?.lowStockCount ?? 0} tone={k?.lowStockCount ? 'red' : 'green'} icon={AlertTriangle} hint="produtos abaixo do mínimo" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Vendas — últimos 30 dias</CardTitle><span className="text-xs text-muted-foreground">{k?.openOrders ?? 0} pedidos em aberto · {k?.toShip ?? 0} a expedir</span></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer>
              <AreaChart data={data?.salesByDay || []}>
                <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#16a34a" stopOpacity={0.35} /><stop offset="100%" stopColor="#16a34a" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => d.slice(8, 10) + '/' + d.slice(5, 7)} fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} width={40} />
                <Tooltip formatter={(v: number) => money(v)} labelFormatter={(d) => fmtDate(d + 'T12:00:00')} />
                <Area type="monotone" dataKey="total" name="Vendas" stroke="#16a34a" fill="url(#g)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Vendas por canal (30 dias)</CardTitle></CardHeader>
          <CardContent className="flex h-72 flex-col">
            <div className="min-h-0 flex-1"><ResponsiveContainer>
              <PieChart>
                <Pie data={data?.byChannel || []} dataKey="revenue" nameKey="name" innerRadius={40} outerRadius={70} paddingAngle={2}>
                  {(data?.byChannel || []).map((_: unknown, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => money(v)} />
              </PieChart>
            </ResponsiveContainer></div>
            <div className="space-y-1 text-xs">
              {(data?.byChannel || []).slice(0, 5).map((c: any, i: number) => <div key={c.name} className="flex justify-between"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: COLORS[i] }} />{c.name}</span><span className="tabular-nums">{money(c.revenue)}</span></div>)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Produtos mais vendidos (30 dias)</CardTitle><Link href="/estoque/curva-abc" className="text-xs text-primary">Curva ABC</Link></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer>
              <BarChart data={(data?.topProducts || []).map((p: any) => ({ ...p, short: p.name.slice(0, 22) }))} layout="vertical" margin={{ left: 10 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="short" width={130} fontSize={10} />
                <Tooltip formatter={(v: number) => money(v)} />
                <Bar dataKey="revenue" name="Faturamento" fill="#2563eb" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Últimos pedidos</CardTitle><Link href="/vendas" className="text-xs text-primary">Ver todos</Link></CardHeader>
          <div className="divide-y">
            {(data?.recentOrders || []).map((o: any) => (
              <Link key={o.id} href={`/vendas/${o.id}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-muted/50">
                <div><div className="font-medium">#{o.number} · {o.customer}</div><div className="text-xs text-muted-foreground">{o.channel || o.origin} · {fmtDate(o.date)}</div></div>
                <div className="text-right"><div className="tabular-nums font-medium">{money(o.total)}</div><StatusBadge status={o.status} /></div>
              </Link>
            ))}
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-1.5"><Package className="h-4 w-4" /> Estoque crítico</CardTitle><Link href="/estoque?situation=BAIXO" className="text-xs text-primary">Ver estoque</Link></CardHeader>
            <div className="divide-y">
              {(data?.lowStock || []).length ? data.lowStock.map((p: any) => (
                <div key={p.id} className="flex justify-between px-4 py-1.5 text-sm"><span className="truncate pr-2">{p.name}</span><span className={p.available <= 0 ? 'font-bold text-red-600' : 'text-amber-600'}>{num(p.available)} / {num(p.minStock)}</span></div>
              )) : <div className="p-4 text-sm text-muted-foreground">Nenhum produto abaixo do mínimo 🎉</div>}
            </div>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-1.5"><Wallet className="h-4 w-4" /> Saldos</CardTitle><Link href="/financeiro/fluxo" className="text-xs text-primary">Fluxo de caixa</Link></CardHeader>
            <div className="divide-y">
              {(data?.balances || []).map((b: any) => <div key={b.id} className="flex justify-between px-4 py-1.5 text-sm"><span>{b.name}</span><span className="tabular-nums font-medium">{money(b.balance)}</span></div>)}
            </div>
            <div className="flex justify-between border-t px-4 py-2 text-xs text-muted-foreground"><span>A receber no mês: <b className="text-green-700">{money(k?.receivableMonth)}</b></span><span>A pagar: <b className="text-red-600">{money(k?.payableMonth)}</b></span></div>
          </Card>
          <Card className="p-4 text-sm"><Truck className="mb-1 h-4 w-4 text-primary" /><b>{k?.toShip ?? 0}</b> pedidos faturados aguardando separação/envio. <Link href="/logistica/separacao" className="text-primary">Separar agora →</Link></Card>
        </div>
      </div>
    </div>
  );
}
