'use client';
import { useState } from 'react';
import { Plus, Trash2, Pencil, Settings2 } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable } from '@/components/common/page';
import { FormFields, type FieldDef } from '@/components/common/crud';
import { Button } from '@/components/ui/button';
import { Input, Select, Checkbox } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type TField = { key: string; label: string; type: string; options?: string[]; required?: boolean };

export default function CustomEntities() {
  const { data: types } = useApi<any>('/api/r/custom-types?pageSize=100');
  const [sel, setSel] = useState<string | null>(null);
  const current = types?.rows.find((t: any) => t.id === (sel || types?.rows[0]?.id));
  const { data: records } = useApi<any>(current ? `/api/r/custom-records?typeId=${current.id}&pageSize=500` : null);
  const act = useAction();
  const [typeEdit, setTypeEdit] = useState<any>(null);
  const [rec, setRec] = useState<any>(null);
  const fields: TField[] = current?.fields || [];
  const formFields: FieldDef[] = fields.map((f) => ({ key: f.key, label: f.label, required: f.required, type: f.type === 'boolean' ? 'checkbox' : f.type === 'select' ? 'select' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text', options: f.options?.map((o) => ({ value: o, label: o })) }));
  const saveType = async () => {
    const body = { name: typeEdit.name, icon: typeEdit.icon, fields: typeEdit.fields.map((f: TField) => ({ ...f, key: f.key || f.label.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, '_').toLowerCase(), options: typeof f.options === 'string' ? (f.options as string).split(',').map((s) => s.trim()) : f.options })) };
    const r = typeEdit.id ? await act('PUT', `/api/r/custom-types/${typeEdit.id}`, body) : await act('POST', '/api/r/custom-types', body);
    if (r) { setTypeEdit(null); setSel((r as any).id); }
  };
  return (
    <div>
      <PageHeader title="Cadastros personalizados" description="Crie seus próprios cadastros com campos customizáveis (matérias-primas, embalagens, técnicos, transportadoras parceiras…)" actions={<Button onClick={() => setTypeEdit({ name: '', fields: [{ key: '', label: 'Nome', type: 'text', required: true }] })}><Plus /> Novo tipo de cadastro</Button>} />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card className="h-fit p-2">
          {types?.rows.map((t: any) => (
            <button key={t.id} onClick={() => setSel(t.id)} className={cn('flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-muted', current?.id === t.id && 'bg-accent font-medium')}>{t.name}<span className="text-xs text-muted-foreground">{t._count?.records}</span></button>
          ))}
          {!types?.rows.length && <p className="p-3 text-sm text-muted-foreground">Nenhum tipo criado</p>}
        </Card>
        {current && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{current.name}</h2>
              <div className="flex gap-2"><Button variant="outline" onClick={() => setTypeEdit({ ...current, fields: current.fields.map((f: TField) => ({ ...f, options: f.options?.join(', ') })) })}><Settings2 /> Campos</Button><Button onClick={() => setRec({ data: {} })}><Plus /> Incluir registro</Button></div>
            </div>
            <DataTable rows={records?.rows} columns={[
              ...fields.map((f) => ({ key: f.key, header: f.label, cell: (r: any) => { const v = r.data?.[f.key]; return typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v ?? '—'); } })),
              { key: '_a', header: '', align: 'right' as const, cell: (r: any) => <div className="flex justify-end gap-1"><Button variant="ghost" size="icon" onClick={() => setRec(r)}><Pencil /></Button><Button variant="ghost" size="icon" onClick={() => confirm('Excluir?') && act('DELETE', `/api/r/custom-records/${r.id}`)}><Trash2 className="text-destructive" /></Button></div> },
            ]} />
          </div>
        )}
      </div>
      <Dialog open={!!rec} onOpenChange={(o) => !o && setRec(null)} title={current?.name || ''} size="lg" footer={<Button onClick={async () => { const body = { typeId: current.id, data: rec.data }; const r = rec.id ? await act('PUT', `/api/r/custom-records/${rec.id}`, body) : await act('POST', '/api/r/custom-records', body); if (r) setRec(null); }}>Salvar</Button>}>
        {rec && <FormFields fields={formFields} value={rec.data} onChange={(d) => setRec({ ...rec, data: d })} />}
      </Dialog>
      <Dialog open={!!typeEdit} onOpenChange={(o) => !o && setTypeEdit(null)} title="Tipo de cadastro" size="lg" footer={<Button onClick={saveType}>Salvar</Button>}>
        {typeEdit && (
          <div className="space-y-3">
            <Input placeholder="Nome do cadastro (ex.: Matérias-primas)" value={typeEdit.name} onChange={(e) => setTypeEdit({ ...typeEdit, name: e.target.value })} />
            <div className="text-sm font-semibold">Campos</div>
            {typeEdit.fields.map((f: any, i: number) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input className="w-48" placeholder="Rótulo" value={f.label} onChange={(e) => setTypeEdit({ ...typeEdit, fields: typeEdit.fields.map((x: any, j: number) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <Select className="w-32" value={f.type} onChange={(e) => setTypeEdit({ ...typeEdit, fields: typeEdit.fields.map((x: any, j: number) => (j === i ? { ...x, type: e.target.value } : x)) })}>{['text', 'number', 'date', 'select', 'boolean'].map((t) => <option key={t}>{t}</option>)}</Select>
                {f.type === 'select' && <Input className="flex-1" placeholder="Opções separadas por vírgula" value={f.options || ''} onChange={(e) => setTypeEdit({ ...typeEdit, fields: typeEdit.fields.map((x: any, j: number) => (j === i ? { ...x, options: e.target.value } : x)) })} />}
                <Checkbox label="Obrigatório" checked={!!f.required} onChange={(e) => setTypeEdit({ ...typeEdit, fields: typeEdit.fields.map((x: any, j: number) => (j === i ? { ...x, required: e.target.checked } : x)) })} />
                <Button variant="ghost" size="icon" onClick={() => setTypeEdit({ ...typeEdit, fields: typeEdit.fields.filter((_: any, j: number) => j !== i) })}><Trash2 className="text-destructive" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setTypeEdit({ ...typeEdit, fields: [...typeEdit.fields, { label: '', type: 'text' }] })}><Plus /> Campo</Button>
            {typeEdit.id && <Button variant="destructive" size="sm" className="ml-2" onClick={async () => { if (confirm('Excluir tipo e todos os registros?')) { await act('DELETE', `/api/r/custom-types/${typeEdit.id}`); setTypeEdit(null); setSel(null); } }}>Excluir tipo</Button>}
          </div>
        )}
      </Dialog>
    </div>
  );
}
