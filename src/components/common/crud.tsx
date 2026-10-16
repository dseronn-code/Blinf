'use client';
import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useApi, useAction, qs } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { DataTable, PageHeader, SearchBox, Filters, Pagination, Field, Chips, type Column } from './page';
import { EntityPicker, simpleOption } from './picker';
import { money, fmtDate, toInputDate, cn } from '@/lib/utils';
import { useCan } from '@/components/layout/me';
import type { ModuleKey } from '@/lib/permissions';

export type FieldDef = {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'money' | 'percent' | 'select' | 'checkbox' | 'textarea' | 'date' | 'multicheck' | 'picker';
  options?: { value: string; label: string }[];
  endpoint?: string;
  pickerLabelKey?: string;
  required?: boolean;
  span?: 1 | 2 | 3;
  hint?: string;
  placeholder?: string;
};

export type ColDef = { key: string; header: string; format?: 'money' | 'date' | 'bool' | 'percent'; render?: (r: any) => React.ReactNode; align?: 'right' | 'center' };

export function ResourceCrud({ resource, title, description, module, columns, fields, defaults = {}, filter, extraActions, transform }: {
  resource: string; title: string; description?: string; module: ModuleKey; columns: ColDef[]; fields: FieldDef[]; defaults?: Record<string, unknown>;
  filter?: { key: string; options: { value: string; label: string }[] }; extraActions?: React.ReactNode; transform?: (data: Record<string, any>) => Record<string, any>;
}) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [f, setF] = useState(filter?.options[0]?.value || '');
  const { data, isLoading } = useApi<{ rows: any[]; total: number; pageSize: number }>(`/api/r/${resource}${qs({ q, page, ...(filter ? { [filter.key]: f } : {}) })}`);
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const act = useAction();
  const can = useCan();
  const canEdit = can(module, 'edit');

  const cols: Column<any>[] = [
    ...columns.map((c) => ({
      key: c.key, header: c.header, align: c.align || (c.format === 'money' || c.format === 'percent' ? 'right' : undefined),
      cell: (r: any) => (c.render ? c.render(r) : c.format === 'money' ? money(r[c.key]) : c.format === 'date' ? fmtDate(r[c.key]) : c.format === 'percent' ? `${r[c.key] ?? 0}%` : c.format === 'bool' ? (r[c.key] ? 'Sim' : 'Não') : String(r[c.key] ?? '—')),
    })) as Column<any>[],
    ...(canEdit ? [{
      key: '_a', header: '', align: 'right' as const, cell: (r: any) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" onClick={() => setEditing(r)}><Pencil /></Button>
          <Button variant="ghost" size="icon" onClick={async () => { if (confirm('Excluir este registro?')) await act('DELETE', `/api/r/${resource}/${r.id}`, undefined, 'Registro excluído'); }}><Trash2 className="text-destructive" /></Button>
        </div>
      ),
    }] : []),
  ];

  const save = async () => {
    if (!editing) return;
    const body: Record<string, any> = {};
    for (const fd of fields) body[fd.key] = editing[fd.key];
    const final = transform ? transform(body) : body;
    const r = editing.id ? await act('PUT', `/api/r/${resource}/${editing.id}`, final, 'Salvo') : await act('POST', `/api/r/${resource}`, final, 'Cadastrado');
    if (r) setEditing(null);
  };

  return (
    <div>
      <PageHeader title={title} description={description} actions={<>{extraActions}{canEdit && <Button onClick={() => setEditing({ ...defaults, ...(filter && f ? { [filter.key]: f } : {}) })}><Plus /> Incluir</Button>}</>} />
      <Filters>
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} />
        {filter && <Chips value={f} onChange={(v) => { setF(v); setPage(1); }} options={filter.options} />}
      </Filters>
      <DataTable columns={cols} rows={data?.rows} loading={isLoading} onRowClick={canEdit ? (r) => setEditing(r) : undefined} />
      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.id ? `Editar — ${title}` : `Incluir — ${title}`} size="lg" footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button><Button onClick={save}>Salvar</Button></>}>
        {editing && <FormFields fields={fields} value={editing} onChange={setEditing} />}
      </Dialog>
    </div>
  );
}

export function FormFields({ fields, value, onChange }: { fields: FieldDef[]; value: Record<string, any>; onChange: (v: Record<string, any>) => void }) {
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {fields.map((fd) => {
        const v = value[fd.key];
        const span = fd.span === 3 ? 'sm:col-span-3' : fd.span === 2 ? 'sm:col-span-2' : '';
        let input: React.ReactNode;
        switch (fd.type) {
          case 'select':
            input = <Select value={v ?? ''} onChange={(e) => set(fd.key, e.target.value)}><option value="">—</option>{fd.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>;
            break;
          case 'checkbox':
            input = <Checkbox checked={!!v} onChange={(e) => set(fd.key, e.target.checked)} label={fd.hint || 'Sim'} />;
            break;
          case 'textarea':
            input = <Textarea value={v ?? ''} onChange={(e) => set(fd.key, e.target.value)} />;
            break;
          case 'date':
            input = <Input type="date" value={toInputDate(v)} onChange={(e) => set(fd.key, e.target.value)} />;
            break;
          case 'number':
          case 'money':
          case 'percent':
            input = <Input type="number" step={fd.type === 'number' ? 'any' : '0.01'} value={v ?? ''} onChange={(e) => set(fd.key, e.target.value)} placeholder={fd.placeholder} />;
            break;
          case 'multicheck':
            input = (
              <div className="flex flex-wrap gap-3 pt-1">
                {fd.options?.map((o) => <Checkbox key={o.value} label={o.label} checked={(v || []).includes(o.value)} onChange={(e) => set(fd.key, e.target.checked ? [...(v || []), o.value] : (v || []).filter((x: string) => x !== o.value))} />)}
              </div>
            );
            break;
          case 'picker':
            input = <EntityPicker endpoint={fd.endpoint!} value={v} label={fd.pickerLabelKey ? value[fd.pickerLabelKey]?.name : undefined} onChange={(id) => set(fd.key, id)} map={simpleOption} />;
            break;
          default:
            input = <Input value={v ?? ''} onChange={(e) => set(fd.key, e.target.value)} required={fd.required} placeholder={fd.placeholder} />;
        }
        return <Field key={fd.key} label={<>{fd.label}{fd.required && <span className="text-destructive"> *</span>}</>} className={cn(span)} hint={fd.type !== 'checkbox' ? fd.hint : undefined}>{input}</Field>;
      })}
    </div>
  );
}
