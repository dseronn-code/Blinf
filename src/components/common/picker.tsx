'use client';
import * as Popover from '@radix-ui/react-popover';
import { useEffect, useState } from 'react';
import { ChevronsUpDown, Loader2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export type PickerOption = { id: string; label: string; sub?: string; raw?: any };

/**
 * Seletor com busca remota. `endpoint` deve aceitar ?q= e retornar { rows }.
 * `map` converte cada linha em opção.
 */
export function EntityPicker({ endpoint, value, label, onChange, map, placeholder = 'Selecione…', className, disabled, allowClear = true }: {
  endpoint: string; value?: string | null; label?: string | null; onChange: (id: string | null, raw?: any) => void; map: (r: any) => PickerOption; placeholder?: string; className?: string; disabled?: boolean; allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<PickerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<string | null | undefined>(label);
  useEffect(() => setCurrent(label), [label]);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const t = setTimeout(() => {
      const sep = endpoint.includes('?') ? '&' : '?';
      api<{ rows: any[] }>(`${endpoint}${sep}q=${encodeURIComponent(q)}&pageSize=30`).then((r) => setOpts(r.rows.map(map))).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, open, endpoint]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        <button type="button" className={cn('flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-2.5 text-left text-sm shadow-sm disabled:opacity-60', className)}>
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{value ? current || '…' : placeholder}</span>
          <span className="flex items-center gap-1">
            {value && allowClear && !disabled && <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); onChange(null); setCurrent(null); }} />}
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[280px] rounded-md border bg-popover p-1 shadow-lg">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Digite para buscar…" className="mb-1 h-8 w-full rounded border px-2 text-sm outline-none focus:ring-1 focus:ring-ring" />
          <div className="max-h-64 overflow-y-auto">
            {loading ? <div className="p-3 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div> : !opts.length ? <div className="p-3 text-center text-xs text-muted-foreground">Nada encontrado</div> : opts.map((o) => (
              <button type="button" key={o.id} onClick={() => { onChange(o.id, o.raw); setCurrent(o.label); setOpen(false); }} className={cn('block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent', o.id === value && 'bg-accent')}>
                <div className="truncate">{o.label}</div>
                {o.sub && <div className="truncate text-[11px] text-muted-foreground">{o.sub}</div>}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// Seletores prontos
import { money, fmtDoc } from '@/lib/utils';
export const productOption = (r: any): PickerOption => ({ id: r.id, label: `${r.sku} — ${r.name}`, sub: `${money(r.price)} · disp. ${r.stock?.available ?? '—'} ${r.unit || ''}`, raw: r });
export const contactOption = (r: any): PickerOption => ({ id: r.id, label: r.name, sub: [fmtDoc(r.document), r.city && `${r.city}/${r.uf}`].filter(Boolean).join(' · '), raw: r });
export const simpleOption = (r: any): PickerOption => ({ id: r.id, label: r.name || r.code, sub: r.code || undefined, raw: r });
