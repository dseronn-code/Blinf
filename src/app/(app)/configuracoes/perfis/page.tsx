'use client';
import { useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, Field } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Checkbox } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MODULES, type AccessLevel } from '@/lib/permissions';
import { cn } from '@/lib/utils';

export default function Roles() {
  const { data } = useApi<any>('/api/r/roles');
  const act = useAction();
  const [sel, setSel] = useState<any>(null);
  const current = sel || data?.rows[0];
  const [draft, setDraft] = useState<any>(null);
  const r = draft && draft.id === current?.id ? draft : current ? { ...current, permissions: { ...current.permissions } } : null;
  const setPerm = (mod: string, level: AccessLevel) => setDraft({ ...r, permissions: { ...r.permissions, [mod]: level } });
  const save = async () => {
    const body = { name: r.name, description: r.description, isAdmin: r.isAdmin, permissions: r.permissions };
    const res: any = r.id ? await act('PUT', `/api/r/roles/${r.id}`, body, 'Perfil salvo') : await act('POST', '/api/r/roles', body, 'Perfil criado');
    if (res) { setSel(res); setDraft(null); }
  };
  return (
    <div>
      <PageHeader title="Perfis e permissões" description="Controle de acesso por módulo: sem acesso, visualizar ou editar" actions={<Button onClick={() => { const n = { id: undefined, name: 'Novo perfil', description: '', isAdmin: false, permissions: {} }; setSel(n); setDraft(n); }}><Plus /> Novo perfil</Button>} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit p-2">{data?.rows.map((x: any) => <button key={x.id} onClick={() => { setSel(x); setDraft(null); }} className={cn('flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-muted', current?.id === x.id && 'bg-accent font-medium')}><span>{x.name}</span><Badge>{x._count.users}</Badge></button>)}</Card>
        {r && <Card><CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3"><Field label="Nome"><Input value={r.name} onChange={(e) => setDraft({ ...r, name: e.target.value })} /></Field><Field label="Descrição"><Input value={r.description || ''} onChange={(e) => setDraft({ ...r, description: e.target.value })} /></Field></div>
          <Checkbox label="Administrador (acesso total, ignora a matriz abaixo)" checked={r.isAdmin} onChange={(e) => setDraft({ ...r, isAdmin: e.target.checked })} />
          <table className={cn('table-dense w-full rounded border', r.isAdmin && 'opacity-40')}>
            <thead><tr><th>Módulo</th><th className="text-center">Sem acesso</th><th className="text-center">Visualizar</th><th className="text-center">Editar</th></tr></thead>
            <tbody>{MODULES.map((m) => <tr key={m.key}><td>{m.label}</td>{(['none', 'view', 'edit'] as AccessLevel[]).map((lv) => <td key={lv} className="text-center"><input type="radio" disabled={r.isAdmin} name={m.key} checked={(r.permissions[m.key] || 'none') === lv} onChange={() => setPerm(m.key, lv)} /></td>)}</tr>)}</tbody>
          </table>
          <div className="flex gap-2"><Button onClick={save}><Save /> Salvar perfil</Button>{r.id && <Button variant="outline" onClick={async () => { if (confirm('Excluir perfil?')) { await act('DELETE', `/api/r/roles/${r.id}`, undefined, 'Perfil excluído'); setSel(null); } }}><Trash2 /> Excluir</Button>}</div>
        </CardContent></Card>}
      </div>
    </div>
  );
}
