'use client';
import { useEffect, useState } from 'react';
import { Search, Loader2, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function PageHeader({ title, description, actions, badge }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">{title} {badge}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Pesquisar…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => v !== value && onChange(v), 350);
    return () => clearTimeout(t);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={cn('relative w-full max-w-xs', className)}>
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="pl-8" />
    </div>
  );
}

export type Column<T> = { key: string; header: React.ReactNode; cell?: (row: T) => React.ReactNode; className?: string; align?: 'right' | 'center' };

export function DataTable<T extends { id?: string }>({ columns, rows, loading, empty = 'Nenhum registro encontrado', onRowClick, footer, selectable, selected, onSelect, rowClassName }: {
  columns: Column<T>[]; rows: T[] | undefined; loading?: boolean; empty?: React.ReactNode; onRowClick?: (r: T) => void; footer?: React.ReactNode;
  selectable?: boolean; selected?: string[]; onSelect?: (ids: string[]) => void; rowClassName?: (r: T) => string;
}) {
  const all = rows?.map((r) => r.id!) || [];
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-dense w-full">
          <thead>
            <tr>
              {selectable && <th className="w-8"><input type="checkbox" checked={!!all.length && selected?.length === all.length} onChange={(e) => onSelect?.(e.target.checked ? all : [])} /></th>}
              {columns.map((c) => <th key={c.key} className={cn(c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>{c.header}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length + 1} className="py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
            ) : !rows?.length ? (
              <tr><td colSpan={columns.length + 1} className="py-10 text-center text-muted-foreground"><Inbox className="mx-auto mb-2 h-6 w-6 opacity-50" />{empty}</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.id || i} className={cn(onRowClick && 'cursor-pointer', rowClassName?.(r))} onClick={() => onRowClick?.(r)}>
                  {selectable && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected?.includes(r.id!)} onChange={(e) => onSelect?.(e.target.checked ? [...(selected || []), r.id!] : (selected || []).filter((x) => x !== r.id))} /></td>}
                  {columns.map((c) => <td key={c.key} className={cn(c.align === 'right' && 'num', c.align === 'center' && 'text-center', c.className)}>{c.cell ? c.cell(r) : String((r as Record<string, unknown>)[c.key] ?? '')}</td>)}
                </tr>
              ))
            )}
          </tbody>
          {footer && <tfoot className="border-t bg-muted/40 font-semibold">{footer}</tfoot>}
        </table>
      </div>
    </Card>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <div className="mt-2 text-xs text-muted-foreground">{total} registro(s)</div>;
  return (
    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
      <span>{total} registro(s) · página {page} de {pages}</span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Próxima</Button>
      </div>
    </div>
  );
}

export function StatCard({ label, value, hint, tone = 'default', icon: Icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'default' | 'green' | 'red' | 'blue' | 'amber'; icon?: React.ComponentType<{ className?: string }> }) {
  const color = { default: 'text-foreground', green: 'text-green-700', red: 'text-red-600', blue: 'text-blue-700', amber: 'text-amber-600' }[tone];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className={cn('mt-1 truncate text-xl font-bold tabular-nums', color)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function Filters({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors', value === o.value ? 'border-primary bg-primary text-white' : 'bg-card hover:bg-muted')}>{o.label}</button>
      ))}
    </div>
  );
}

/** Aviso de recurso simulado — só aparece no modo demonstração */
export function SimBanner({ children }: { children: React.ReactNode }) {
  const demo = useDemoMode();
  if (!demo) return null;
  return <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">🧪 <b>Simulação:</b> {children}</div>;
}

/** true no modo demonstração (vem de /api/me); em produção, recursos simulados ficam escondidos */
export function useDemoMode() {
  const { data } = useApi<{ demo?: boolean }>('/api/me');
  return !!data?.demo;
}

export function Field({ label, children, className, hint }: { label: React.ReactNode; children: React.ReactNode; className?: string; hint?: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value ?? '—'}</div>
    </div>
  );
}
