'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Plus, Trash2, Save, ArrowLeft } from 'lucide-react';
import { useApi, useAction, api } from '@/lib/api';
import { PageHeader, Field, DataTable } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/ui/badge';
import { UFS } from '@/lib/br';
import { money, fmtDate, toInputDate, onlyDigits } from '@/lib/utils';
import { toast } from 'sonner';

const empty = { types: ['CLIENTE'], personType: 'PF', ieIndicator: 9, active: true, creditLimit: 0, addresses: [], persons: [] };

export default function ContactForm() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'novo';
  const router = useRouter();
  const act = useAction();
  const { data } = useApi<any>(isNew ? null : `/api/r/contacts/${id}`);
  const { data: lists } = useApi<any>('/api/r/price-lists?pageSize=100');
  const { data: sellers } = useApi<any>('/api/r/sellers?pageSize=100&kind=VENDEDOR');
  const { data: orders } = useApi<any>(isNew ? null : `/api/sales-orders?customerId=${id}&pageSize=10`);
  const { data: fin } = useApi<any>(isNew ? null : `/api/finance/entries?contactId=${id}&status=EM_ABERTO`);
  const [c, setC] = useState<any>(empty);
  useEffect(() => { if (data) setC({ ...data, birthDate: toInputDate(data.birthDate) }); }, [data]);
  const set = (k: string, v: unknown) => setC((p: any) => ({ ...p, [k]: v }));

  const lookupCep = async () => {
    const cep = onlyDigits(c.zip);
    if (cep.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`).then((x) => x.json());
      if (!r.erro) setC((p: any) => ({ ...p, street: r.logradouro, district: r.bairro, city: r.localidade, uf: r.uf }));
    } catch { toast.info('Consulta de CEP indisponível (offline) — preencha manualmente'); }
  };
  const save = async () => {
    const { id: _id, organizationId, createdAt, updatedAt, priceList, seller, ...body } = c;
    const r = isNew ? await act('POST', '/api/r/contacts', body, 'Contato cadastrado') : await act('PUT', `/api/r/contacts/${id}`, body, 'Contato salvo');
    if (r && isNew) router.replace(`/cadastros/contatos/${(r as any).id}`);
  };
  void api;
  return (
    <div>
      <PageHeader title={isNew ? 'Novo contato' : c.name} description={isNew ? 'Cliente, fornecedor ou transportadora' : c.types?.join(' · ')} actions={<><Button variant="outline" onClick={() => router.push('/cadastros/contatos')}><ArrowLeft /> Voltar</Button>{!isNew && <Button variant="outline" onClick={async () => { if (confirm('Excluir contato?')) { const r = await act('DELETE', `/api/r/contacts/${id}`); if (r) router.push('/cadastros/contatos'); } }}><Trash2 /> Excluir</Button>}<Button onClick={save}><Save /> Salvar</Button></>} />
      <Tabs defaultValue="dados">
        <TabsList><TabsTrigger value="dados">Dados gerais</TabsTrigger><TabsTrigger value="enderecos">Endereços</TabsTrigger><TabsTrigger value="pessoas">Pessoas de contato</TabsTrigger>{!isNew && <TabsTrigger value="historico">Histórico</TabsTrigger>}</TabsList>
        <TabsContent value="dados">
          <Card><CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Tipo de contato" className="md:col-span-2"><div className="flex gap-4 pt-1.5">{['CLIENTE', 'FORNECEDOR', 'TRANSPORTADORA'].map((t) => <Checkbox key={t} label={t.toLowerCase()} checked={c.types?.includes(t)} onChange={(e) => set('types', e.target.checked ? [...c.types, t] : c.types.filter((x: string) => x !== t))} />)}</div></Field>
            <Field label="Pessoa"><Select value={c.personType} onChange={(e) => set('personType', e.target.value)}><option value="PF">Física</option><option value="PJ">Jurídica</option></Select></Field>
            <Field label="Situação"><Checkbox checked={c.active} onChange={(e) => set('active', e.target.checked)} label="Ativo" /></Field>
            <Field label={c.personType === 'PJ' ? 'Razão social *' : 'Nome *'} className="md:col-span-2"><Input value={c.name || ''} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Nome fantasia" className="md:col-span-2"><Input value={c.tradeName || ''} onChange={(e) => set('tradeName', e.target.value)} /></Field>
            <Field label={c.personType === 'PJ' ? 'CNPJ' : 'CPF'}><Input value={c.document || ''} onChange={(e) => set('document', e.target.value)} placeholder="somente números" /></Field>
            <Field label="Inscrição estadual"><Input value={c.ie || ''} onChange={(e) => set('ie', e.target.value)} /></Field>
            <Field label="Contribuinte ICMS"><Select value={c.ieIndicator} onChange={(e) => set('ieIndicator', Number(e.target.value))}><option value={1}>1 - Contribuinte</option><option value={2}>2 - Isento</option><option value={9}>9 - Não contribuinte</option></Select></Field>
            <Field label="Data de nascimento"><Input type="date" value={c.birthDate || ''} onChange={(e) => set('birthDate', e.target.value)} /></Field>
            <Field label="E-mail"><Input value={c.email || ''} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="Telefone"><Input value={c.phone || ''} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Celular / WhatsApp"><Input value={c.mobile || ''} onChange={(e) => set('mobile', e.target.value)} /></Field>
            <Field label="Limite de crédito (R$)" hint="0 = sem limite"><Input type="number" step="0.01" value={c.creditLimit ?? 0} onChange={(e) => set('creditLimit', e.target.value)} /></Field>
            <Field label="Lista de preço" className="md:col-span-2"><Select value={c.priceListId || ''} onChange={(e) => set('priceListId', e.target.value)}><option value="">Padrão (varejo)</option>{lists?.rows.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
            <Field label="Vendedor" className="md:col-span-2"><Select value={c.sellerId || ''} onChange={(e) => set('sellerId', e.target.value)}><option value="">—</option>{sellers?.rows.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
            <div className="md:col-span-4 mt-2 border-t pt-3 text-sm font-semibold">Endereço principal</div>
            <Field label="CEP"><Input value={c.zip || ''} onChange={(e) => set('zip', e.target.value)} onBlur={lookupCep} /></Field>
            <Field label="Logradouro" className="md:col-span-2"><Input value={c.street || ''} onChange={(e) => set('street', e.target.value)} /></Field>
            <Field label="Número"><Input value={c.number || ''} onChange={(e) => set('number', e.target.value)} /></Field>
            <Field label="Complemento"><Input value={c.complement || ''} onChange={(e) => set('complement', e.target.value)} /></Field>
            <Field label="Bairro"><Input value={c.district || ''} onChange={(e) => set('district', e.target.value)} /></Field>
            <Field label="Cidade"><Input value={c.city || ''} onChange={(e) => set('city', e.target.value)} /></Field>
            <Field label="UF"><Select value={c.uf || ''} onChange={(e) => set('uf', e.target.value)}><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
            <Field label="Observações" className="md:col-span-4"><Textarea value={c.notes || ''} onChange={(e) => set('notes', e.target.value)} /></Field>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="enderecos">
          <Card><CardContent className="space-y-3">
            {(c.addresses || []).map((a: any, i: number) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded border p-3 md:grid-cols-8">
                {(['label', 'zip', 'street', 'number', 'district', 'city', 'uf'] as const).map((k) => <Input key={k} className={k === 'street' ? 'md:col-span-2' : ''} placeholder={{ label: 'Tipo', zip: 'CEP', street: 'Logradouro', number: 'Nº', district: 'Bairro', city: 'Cidade', uf: 'UF' }[k]} value={a[k] || ''} onChange={(e) => set('addresses', c.addresses.map((x: any, j: number) => (j === i ? { ...x, [k]: e.target.value } : x)))} />)}
                <Button variant="ghost" onClick={() => set('addresses', c.addresses.filter((_: any, j: number) => j !== i))}><Trash2 className="text-destructive" /></Button>
              </div>
            ))}
            <Button variant="outline" onClick={() => set('addresses', [...(c.addresses || []), { label: 'Entrega' }])}><Plus /> Adicionar endereço</Button>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="pessoas">
          <Card><CardContent className="space-y-3">
            {(c.persons || []).map((a: any, i: number) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded border p-3 md:grid-cols-5">
                {(['name', 'role', 'email', 'phone'] as const).map((k) => <Input key={k} placeholder={{ name: 'Nome', role: 'Cargo/setor', email: 'E-mail', phone: 'Telefone' }[k]} value={a[k] || ''} onChange={(e) => set('persons', c.persons.map((x: any, j: number) => (j === i ? { ...x, [k]: e.target.value } : x)))} />)}
                <Button variant="ghost" onClick={() => set('persons', c.persons.filter((_: any, j: number) => j !== i))}><Trash2 className="text-destructive" /></Button>
              </div>
            ))}
            <Button variant="outline" onClick={() => set('persons', [...(c.persons || []), {}])}><Plus /> Adicionar pessoa de contato</Button>
          </CardContent></Card>
        </TabsContent>
        {!isNew && (
          <TabsContent value="historico" className="space-y-4">
            <h3 className="text-sm font-semibold">Últimos pedidos</h3>
            <DataTable rows={orders?.rows} onRowClick={(r: any) => router.push(`/vendas/${r.id}`)} columns={[{ key: 'number', header: 'Nº' }, { key: 'date', header: 'Data', cell: (r: any) => fmtDate(r.date) }, { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> }, { key: 'total', header: 'Total', align: 'right', cell: (r: any) => money(r.total) }]} />
            <h3 className="text-sm font-semibold">Contas em aberto ({money(fin?.totals?.open)})</h3>
            <DataTable rows={fin?.rows} columns={[{ key: 'description', header: 'Descrição' }, { key: 'dueDate', header: 'Vencimento', cell: (r: any) => fmtDate(r.dueDate) }, { key: 'st', header: 'Situação', cell: (r: any) => <StatusBadge status={r.effectiveStatus} /> }, { key: 'amount', header: 'Valor', align: 'right', cell: (r: any) => money(r.amount - r.paidAmount) }]} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
