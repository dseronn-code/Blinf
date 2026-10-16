'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, Field } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Select, Checkbox } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { fmtDateTime } from '@/lib/utils';
import { useMe } from '@/components/layout/me';

export default function Users() {
  const me = useMe();
  const { data, isLoading } = useApi<any>('/api/r/users');
  const { data: roles } = useApi<any>('/api/r/roles');
  const act = useAction();
  const [u, setU] = useState<any>(null);
  const save = async () => {
    const body = { name: u.name, email: u.email, roleId: u.roleId, active: u.active, companyIds: u.companyIds, ...(u.password ? { password: u.password } : {}) };
    const r = u.id ? await act('PUT', `/api/r/users/${u.id}`, body, 'Usuário salvo') : await act('POST', '/api/r/users', body, 'Usuário criado');
    if (r) setU(null);
  };
  return (
    <div>
      <PageHeader title="Usuários" description="Multiusuário com perfis de acesso e empresas permitidas" actions={<Button onClick={() => setU({ active: true, roleId: roles?.rows[0]?.id, companyIds: [me.companyId] })}><Plus /> Novo usuário</Button>} />
      <DataTable loading={isLoading} rows={data?.rows} onRowClick={(r: any) => setU({ ...r, companyIds: r.companies.map((c: any) => c.companyId), password: '' })} columns={[
        { key: 'name', header: 'Nome' }, { key: 'email', header: 'E-mail' }, { key: 'role', header: 'Perfil', cell: (r: any) => <Badge tone="blue">{r.role.name}</Badge> },
        { key: 'companies', header: 'Empresas', cell: (r: any) => r.companies.map((c: any) => me.companies.find((x) => x.id === c.companyId)?.tradeName).join(', ') },
        { key: 'lastLoginAt', header: 'Último acesso', cell: (r: any) => fmtDateTime(r.lastLoginAt) }, { key: 'active', header: 'Situação', cell: (r: any) => (r.active ? <Badge tone="green">ativo</Badge> : <Badge tone="red">inativo</Badge>) },
      ]} />
      <Dialog open={!!u} onOpenChange={(o) => !o && setU(null)} title={u?.id ? 'Editar usuário' : 'Novo usuário'} footer={<Button onClick={save}>Salvar</Button>}>
        {u && <div className="grid grid-cols-2 gap-3">
          <Field label="Nome" className="col-span-2"><Input value={u.name || ''} onChange={(e) => setU({ ...u, name: e.target.value })} /></Field>
          <Field label="E-mail"><Input value={u.email || ''} onChange={(e) => setU({ ...u, email: e.target.value })} /></Field>
          <Field label={u.id ? 'Nova senha (opcional)' : 'Senha'}><Input type="password" value={u.password || ''} onChange={(e) => setU({ ...u, password: e.target.value })} /></Field>
          <Field label="Perfil"><Select value={u.roleId} onChange={(e) => setU({ ...u, roleId: e.target.value })}>{roles?.rows.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
          <Field label="Situação"><Checkbox checked={u.active} onChange={(e) => setU({ ...u, active: e.target.checked })} label="Ativo" /></Field>
          <Field label="Empresas com acesso" className="col-span-2"><div className="flex flex-wrap gap-4">{me.companies.map((c) => <Checkbox key={c.id} label={c.tradeName || c.name} checked={u.companyIds?.includes(c.id)} onChange={(e) => setU({ ...u, companyIds: e.target.checked ? [...u.companyIds, c.id] : u.companyIds.filter((x: string) => x !== c.id) })} />)}</div></Field>
        </div>}
      </Dialog>
    </div>
  );
}
