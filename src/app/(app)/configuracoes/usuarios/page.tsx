'use client';
import { useState } from 'react';
import { Plus, Mail, ShieldOff, Copy } from 'lucide-react';
import { toast } from 'sonner';
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
  const [inv, setInv] = useState<any>(null);
  const [invited, setInvited] = useState<{ email: string; devLink?: string } | null>(null);
  const invite = async () => {
    const r = await act<{ ok: boolean; id: string; devLink?: string }>('POST', '/api/account/invite', { name: inv.name, email: inv.email, roleId: inv.roleId, companyIds: inv.companyIds }, 'Convite enviado');
    if (r) { setInvited({ email: inv.email, devLink: r.devLink }); setInv(null); }
  };
  const reset2fa = async (r: any) => {
    if (!confirm(`Remover a autenticação em dois fatores de ${r.name}? O usuário poderá entrar apenas com a senha e reativar o 2FA depois.`)) return;
    await act('POST', '/api/account/2fa', { action: 'reset-user', userId: r.id }, '2FA removido do usuário');
  };
  const save = async () => {
    const body = { name: u.name, email: u.email, roleId: u.roleId, active: u.active, companyIds: u.companyIds, ...(u.password ? { password: u.password } : {}) };
    const r = u.id ? await act('PUT', `/api/r/users/${u.id}`, body, 'Usuário salvo') : await act('POST', '/api/r/users', body, 'Usuário criado');
    if (r) setU(null);
  };
  return (
    <div>
      <PageHeader title="Usuários" description="Multiusuário com perfis de acesso e empresas permitidas" actions={<><Button variant="outline" onClick={() => setInv({ roleId: roles?.rows[0]?.id, companyIds: [me.companyId] })}><Mail /> Convidar por e-mail</Button><Button onClick={() => setU({ active: true, roleId: roles?.rows[0]?.id, companyIds: [me.companyId] })}><Plus /> Novo usuário</Button></>} />
      <DataTable loading={isLoading} rows={data?.rows} onRowClick={(r: any) => setU({ ...r, companyIds: r.companies.map((c: any) => c.companyId), password: '' })} columns={[
        { key: 'name', header: 'Nome' }, { key: 'email', header: 'E-mail' }, { key: 'role', header: 'Perfil', cell: (r: any) => <Badge tone="blue">{r.role.name}</Badge> },
        { key: 'companies', header: 'Empresas', cell: (r: any) => r.companies.map((c: any) => me.companies.find((x) => x.id === c.companyId)?.tradeName).join(', ') },
        { key: 'lastLoginAt', header: 'Último acesso', cell: (r: any) => fmtDateTime(r.lastLoginAt) }, { key: 'active', header: 'Situação', cell: (r: any) => (r.active ? <Badge tone="green">ativo</Badge> : <Badge tone="red">inativo</Badge>) },
        ...(me.user.isAdmin ? [{ key: 'actions', header: '', align: 'right' as const, cell: (r: any) => <Button size="sm" variant="ghost" title="Remove a autenticação em dois fatores (ex.: usuário perdeu o celular)" onClick={(e) => { e.stopPropagation(); reset2fa(r); }}><ShieldOff /> Remover 2FA</Button> }] : []),
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
      <Dialog open={!!inv} onOpenChange={(o) => !o && setInv(null)} title="Convidar usuário por e-mail" description="O usuário recebe um link para definir a própria senha (válido por 72 horas)" footer={<Button onClick={invite} disabled={!inv?.name || !inv?.email || !inv?.roleId}><Mail /> Enviar convite</Button>}>
        {inv && <div className="grid grid-cols-2 gap-3">
          <Field label="Nome" className="col-span-2"><Input value={inv.name || ''} onChange={(e) => setInv({ ...inv, name: e.target.value })} /></Field>
          <Field label="E-mail"><Input type="email" value={inv.email || ''} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></Field>
          <Field label="Perfil"><Select value={inv.roleId || ''} onChange={(e) => setInv({ ...inv, roleId: e.target.value })}>{roles?.rows.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
          <Field label="Empresas com acesso" className="col-span-2" hint="Se nenhuma for marcada, o acesso será à empresa atual"><div className="flex flex-wrap gap-4">{me.companies.map((c) => <Checkbox key={c.id} label={c.tradeName || c.name} checked={inv.companyIds?.includes(c.id)} onChange={(e) => setInv({ ...inv, companyIds: e.target.checked ? [...(inv.companyIds || []), c.id] : (inv.companyIds || []).filter((x: string) => x !== c.id) })} />)}</div></Field>
        </div>}
      </Dialog>
      <Dialog open={!!invited} onOpenChange={(o) => !o && setInvited(null)} title="Convite enviado" size="sm" footer={<Button onClick={() => setInvited(null)}>Fechar</Button>}>
        {invited && <div className="space-y-3 text-sm">
          <p>O convite foi enviado para <b>{invited.email}</b>. O usuário aparece na lista e poderá entrar após definir a senha.</p>
          {invited.devLink && <>
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">SMTP não configurado — link exibido para demonstração; o e-mail foi registrado na caixa de saída.</div>
            <div className="flex gap-2">
              <Input readOnly value={invited.devLink} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
              <Button variant="outline" onClick={() => { navigator.clipboard?.writeText(invited.devLink!); toast.success('Link copiado'); }}><Copy /> Copiar</Button>
            </div>
          </>}
        </div>}
      </Dialog>
    </div>
  );
}
