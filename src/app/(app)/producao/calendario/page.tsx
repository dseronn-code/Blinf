'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApi } from '@/lib/api';
import { PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const COLORS: Record<string, string> = { PLANEJADA: 'bg-slate-200 text-slate-800', EM_PRODUCAO: 'bg-blue-200 text-blue-900', FINALIZADA: 'bg-green-200 text-green-900', CANCELADA: 'bg-red-100 text-red-800 line-through' };

export default function ProductionCalendar() {
  const { data } = useApi<any>('/api/production');
  const [ref, setRef] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const first = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const inRange = (op: any, d: Date) => { const s = key(new Date(op.startDate)); const e = key(new Date(op.dueDate || op.startDate)); const k = key(d); return k >= s && k <= e; };
  return (
    <div>
      <PageHeader title="Calendário de produção" description="Ordens por período (início → prazo) e situação" actions={<div className="flex items-center gap-2"><Button variant="outline" size="icon" onClick={() => setRef(new Date(ref.getFullYear(), ref.getMonth() - 1, 1))}><ChevronLeft /></Button><span className="w-40 text-center font-semibold capitalize">{ref.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span><Button variant="outline" size="icon" onClick={() => setRef(new Date(ref.getFullYear(), ref.getMonth() + 1, 1))}><ChevronRight /></Button></div>} />
      <div className="mb-2 flex gap-2 text-xs">{Object.entries(COLORS).map(([k, c]) => <span key={k} className={cn('rounded px-2 py-0.5', c)}>{k.replace('_', ' ').toLowerCase()}</span>)}</div>
      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b bg-muted/60 text-center text-xs font-semibold">{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => <div key={d} className="py-2">{d}</div>)}</div>
        <div className="grid grid-cols-7">
          {days.map((d) => (
            <div key={key(d)} className={cn('min-h-[104px] border-b border-r p-1', d.getMonth() !== ref.getMonth() && 'bg-muted/30 text-muted-foreground', key(d) === key(new Date()) && 'bg-accent/50')}>
              <div className="text-right text-xs">{d.getDate()}</div>
              {(data?.rows || []).filter((op: any) => inRange(op, d)).slice(0, 4).map((op: any) => <Link key={op.id} href={`/producao/${op.id}`} className={cn('mb-0.5 block truncate rounded px-1 text-[10px]', COLORS[op.status])}>OP {op.number} · {op.product?.name} ({op.quantity})</Link>)}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
