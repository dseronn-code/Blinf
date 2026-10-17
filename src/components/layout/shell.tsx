'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';
import { Server } from 'lucide-react';
import { Bell, ChevronDown, ChevronRight, LogOut, Menu as MenuIcon, Building2, Layers, Search, ExternalLink } from 'lucide-react';
import { MENU } from './menu';
import { MeContext, type Me } from './me';
import { api, useApi } from '@/lib/api';
import { can } from '@/lib/permissions';
import { cn, fmtDoc, fmtDateTime } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown';
import { useQueryClient } from '@tanstack/react-query';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: me } = useApi<Me>('/api/me');
  const [mobile, setMobile] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMobile(false), [pathname]);
  if (!me) {
    return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Carregando GestãoPro…</div>;
  }
  return (
    <MeContext.Provider value={me}>
      <div className="flex h-screen overflow-hidden">
        <aside className={cn('fixed inset-y-0 left-0 z-40 w-64 shrink-0 transform bg-sidebar text-sidebar-foreground transition-transform lg:static lg:translate-x-0', mobile ? 'translate-x-0' : '-translate-x-full')}>
          <Sidebar me={me} />
        </aside>
        {mobile && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobile(false)} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar me={me} onMenu={() => setMobile(true)} />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1600px] p-4 lg:p-6">{children}</div>
          </main>
        </div>
      </div>
    </MeContext.Provider>
  );
}

function Sidebar({ me }: { me: Me }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const full = pathname + (search.toString() ? `?${search}` : '');
  const isActive = (href: string) => (href === '/' ? pathname === '/' : href.includes('?') ? full === href : pathname === href || (pathname.startsWith(href + '/') && href.split('/').length > 2));
  const groups = MENU.filter((g) => can(me.permissions, me.user.isAdmin, g.module));
  const [open, setOpen] = useState<string | null>(() => groups.find((g) => g.items?.some((i) => isActive(i.href.split('?')[0]) || pathname.startsWith(i.href.split('?')[0])))?.label || null);
  return (
    <div className="flex h-full flex-col">
      <Link href="/" className="flex h-14 items-center gap-2 border-b border-white/10 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary font-black text-white">G</div>
        <div className="leading-tight">
          <div className="text-[15px] font-bold text-white">GestãoPro</div>
          <div className="text-[10px] uppercase tracking-wider text-white/50">ERP online · demo</div>
        </div>
      </Link>
      <nav className="flex-1 overflow-y-auto px-2 py-3 text-[13px]">
        {groups.map((g) => {
          const Icon = g.icon;
          if (g.href) {
            return (
              <Link key={g.label} href={g.href} className={cn('mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 hover:bg-white/10', isActive(g.href) && 'bg-primary text-white hover:bg-primary')}>
                <Icon className="h-4 w-4 opacity-80" /> {g.label}
              </Link>
            );
          }
          const expanded = open === g.label;
          return (
            <div key={g.label} className="mb-0.5">
              <button onClick={() => setOpen(expanded ? null : g.label)} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 hover:bg-white/10">
                <Icon className="h-4 w-4 opacity-80" />
                <span className="flex-1 text-left">{g.label}</span>
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              {expanded && (
                <div className="ml-6 border-l border-white/10 py-1 pl-2">
                  {g.items!.map((i) => (
                    <Link key={i.href} href={i.href} className={cn('block rounded px-2.5 py-1.5 text-white/70 hover:bg-white/10 hover:text-white', isActive(i.href) && 'bg-white/10 font-medium text-white')}>
                      {i.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3 text-[11px] text-white/40">Integrações fiscais, bancárias e marketplaces <b className="text-amber-300/80">simuladas</b>.</div>
    </div>
  );
}

function Topbar({ me, onMenu }: { me: Me; onMenu: () => void }) {
  const qc = useQueryClient();
  const company = me.companies.find((c) => c.id === me.companyId)!;
  const { data: notif } = useApi<{ rows: { id: string; title: string; message: string; level: string; link: string | null; read: boolean; createdAt: string }[]; unread: number }>('/api/notifications', { refetchInterval: 30000 });
  const switchTo = async (body: object) => {
    await api('/api/me', { method: 'POST', json: body });
    await qc.invalidateQueries();
  };
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4">
      <button className="lg:hidden" onClick={onMenu}><MenuIcon className="h-5 w-5" /></button>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left hover:bg-muted">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: company.logoColor }} />
          <div className="leading-tight">
            <div className="text-sm font-semibold">{me.consolidated ? 'Visão consolidada' : company.tradeName || company.name}</div>
            <div className="text-[10px] text-muted-foreground">{me.consolidated ? `${me.companies.length} empresas` : `CNPJ ${fmtDoc(company.cnpj)} · ${company.uf}`}</div>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Empresas da conta</DropdownMenuLabel>
          {me.companies.map((c) => (
            <DropdownMenuItem key={c.id} onSelect={() => switchTo({ companyId: c.id, consolidated: false })}>
              <Building2 /> <div className="flex-1"><div className="font-medium">{c.tradeName || c.name}</div><div className="text-[10px] text-muted-foreground">{fmtDoc(c.cnpj)} · {c.taxRegime}</div></div>
              {c.id === me.companyId && !me.consolidated && <span className="text-primary">●</span>}
            </DropdownMenuItem>
          ))}
          {me.companies.length > 1 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => switchTo({ consolidated: !me.consolidated })}>
                <Layers /> {me.consolidated ? 'Sair da visão consolidada' : 'Visão consolidada (todas)'}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="relative hidden max-w-md flex-1 md:block">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <GlobalSearch />
      </div>
      <div className="flex-1" />
      <a href={`/loja/${''}`} className="hidden" />
      <DropdownMenu>
        <DropdownMenuTrigger className="relative rounded-md p-2 hover:bg-muted">
          <Bell className="h-5 w-5" />
          {!!notif?.unread && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">{notif.unread > 99 ? '99+' : notif.unread}</span>}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-96 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-sm font-semibold">Notificações</span>
            <button className="text-xs text-primary" onClick={() => api('/api/notifications', { method: 'POST', json: {} }).then(() => qc.invalidateQueries())}>Marcar todas como lidas</button>
          </div>
          <DropdownMenuSeparator />
          {notif?.rows.length ? notif.rows.map((n) => (
            <DropdownMenuItem key={n.id} onSelect={() => { api('/api/notifications', { method: 'POST', json: { id: n.id } }); if (n.link) window.location.href = n.link; }} className={cn('items-start', !n.read && 'bg-accent/40')}>
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.level === 'error' ? 'bg-red-500' : n.level === 'warning' ? 'bg-amber-500' : n.level === 'success' ? 'bg-green-500' : 'bg-blue-500')} />
              <div><div className="font-medium">{n.title}</div><div className="text-xs text-muted-foreground">{n.message}</div><div className="text-[10px] text-muted-foreground">{fmtDateTime(n.createdAt)}</div></div>
            </DropdownMenuItem>
          )) : <div className="p-4 text-center text-sm text-muted-foreground">Sem notificações</div>}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">{me.user.name[0]}</div>
          <div className="hidden text-left leading-tight sm:block"><div className="text-sm font-medium">{me.user.name}</div><div className="text-[10px] text-muted-foreground">{me.user.role}</div></div>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>{me.user.email}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => window.open('/api/v1/openapi.json', '_blank')}><ExternalLink /> Especificação da API</DropdownMenuItem>
          <DropdownMenuSeparator />
          {typeof navigator !== 'undefined' && navigator.userAgent.includes('GestaoProApp') && <DropdownMenuItem onSelect={() => { window.location.href = 'https://localhost/?trocar=1'; }}><Server /> Trocar servidor</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => signOut({ callbackUrl: '/login' })}><LogOut /> Sair</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!q.trim()) return; window.location.href = /^\d+$/.test(q) ? `/vendas?q=${q}` : `/cadastros/produtos?q=${encodeURIComponent(q)}`; }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar produto, SKU ou nº do pedido…" className="h-9 w-full rounded-md border bg-muted/40 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
    </form>
  );
}
