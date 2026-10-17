'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Truck } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, Field, Chips } from '@/components/common/page';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/input';
import { money, num, fmtDateTime, fmtDoc } from '@/lib/utils';
import { UFS } from '@/lib/br';

type Mdfe = { id: string; number: number; series: number; status: string; environment: number; accessKey: string | null; ufStart: string; ufEnd: string; route: string[]; vehiclePlate: string; driverName: string; invoiceKeys: string[]; totalValue: number; totalWeight: number; issueDate: string; createdAt: string };
type Inv = { id: string; number: number; series: number; customerName: string; customerDoc: string | null; issueDate: string; total: number; accessKey: string };

const STATUS_LABEL: Record<string, [string, string]> = { RASCUNHO: ['Rascunho', 'gray'], AUTORIZADO: ['Autorizado', 'green'], REJEITADO: ['Rejeitado', 'red'], ENCERRADO: ['Encerrado', 'blue'], CANCELADO: ['Cancelado', 'gray'], PROCESSANDO: ['Processando', 'blue'] };
const empty = { vehiclePlate: '', vehicleTara: '', vehicleUf: '', rntrc: '', driverName: '', driverCpf: '', route: '', ufEnd: '', loadCity: '', loadCityCode: '', unloadCity: '', unloadCityCode: '' };

export default function MdfeList() {
  const router = useRouter();
  const act = useAction();
  const [status, setStatus] = useState('');
  const { data, isLoading } = useApi<Mdfe[]>(`/api/mdfe${status ? `?status=${status}` : ''}`);
  const [open, setOpen] = useState(false);
  const { data: invs } = useApi<{ rows: Inv[] }>(open ? '/api/invoices?model=NFE&status=AUTORIZADA&pageSize=200' : null);
  const { data: company } = useApi<any>('/api/company');
  const [sel, setSel] = useState<string[]>([]);
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const selected = (invs?.rows || []).filter((i) => sel.includes(i.id));

  const create = async () => {
    setBusy(true);
    const r = await act<Mdfe>('POST', '/api/mdfe', { ...f, invoiceIds: sel, vehicleTara: Number(f.vehicleTara) || 0, route: f.route.split(/[\s,;]+/).filter(Boolean) }, 'Manifesto criado — confira e transmita');
    setBusy(false);
    if (r) { setOpen(false); setF(empty); setSel([]); router.push(`/fiscal/mdfe/${r.id}`); }
  };

  return (
    <div>
      <PageHeader title="MDF-e" description="Manifesto Eletrônico de Documentos Fiscais (modelo 58) para o transporte das NF-e com veículo próprio" actions={<Button onClick={() => setOpen(true)}><Plus /> Novo manifesto</Button>} />
      <div className="mb-3">
        <Chips value={status} onChange={setStatus} options={[{ value: '', label: 'Todos' }, { value: 'RASCUNHO', label: 'Rascunho' }, { value: 'AUTORIZADO', label: 'Autorizados' }, { value: 'ENCERRADO', label: 'Encerrados' }, { value: 'CANCELADO', label: 'Cancelados' }, { value: 'REJEITADO', label: 'Rejeitados' }]} />
      </div>
      <DataTable loading={isLoading} rows={data} onRowClick={(r) => router.push(`/fiscal/mdfe/${r.id}`)} empty="Nenhum manifesto emitido" columns={[
        { key: 'number', header: 'Nº', cell: (r: Mdfe) => <b className="tabular-nums">{r.number}</b> },
        { key: 'issueDate', header: 'Emissão', cell: (r: Mdfe) => fmtDateTime(r.issueDate) },
        { key: 'route', header: 'Percurso', cell: (r: Mdfe) => [r.ufStart, ...r.route, r.ufEnd].filter((u, i, a) => a.indexOf(u) === i).join(' → ') },
        { key: 'vehiclePlate', header: 'Veículo', cell: (r: Mdfe) => <span className="font-mono">{r.vehiclePlate}</span> },
        { key: 'driverName', header: 'Condutor' },
        { key: 'qty', header: 'NF-e', align: 'right', cell: (r: Mdfe) => r.invoiceKeys.length },
        { key: 'totalWeight', header: 'Peso (kg)', align: 'right', cell: (r: Mdfe) => num(r.totalWeight, 3) },
        { key: 'totalValue', header: 'Valor da carga', align: 'right', cell: (r: Mdfe) => money(r.totalValue) },
        { key: 'status', header: 'Situação', cell: (r: Mdfe) => { const [l, t] = STATUS_LABEL[r.status] || [r.status, 'gray']; return <span className="flex gap-1"><Badge tone={t}>{l}</Badge>{r.environment === 2 && r.status !== 'RASCUNHO' && <Badge tone="yellow">Homolog.</Badge>}</span>; } },
      ]} />

      <Dialog open={open} onOpenChange={setOpen} size="xl" title="Novo manifesto (MDF-e)" description="Selecione as NF-e autorizadas que seguem no mesmo veículo para a mesma UF de destino"
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button disabled={busy || !sel.length || !f.vehiclePlate || !f.driverName || !f.driverCpf} onClick={create}><Truck /> Criar manifesto</Button></>}>
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">NF-e autorizadas ({sel.length} selecionada{sel.length === 1 ? '' : 's'} · {money(selected.reduce((a, i) => a + i.total, 0))})</div>
            <div className="max-h-56 overflow-y-auto">
              <DataTable rows={invs?.rows} selectable selected={sel} onSelect={setSel} empty="Nenhuma NF-e autorizada" columns={[
                { key: 'number', header: 'Nº', cell: (r: Inv) => `${r.number}/${r.series}` },
                { key: 'customerName', header: 'Destinatário', cell: (r: Inv) => <span>{r.customerName} <span className="text-muted-foreground">{fmtDoc(r.customerDoc)}</span></span> },
                { key: 'issueDate', header: 'Emissão', cell: (r: Inv) => fmtDateTime(r.issueDate) },
                { key: 'total', header: 'Total', align: 'right', cell: (r: Inv) => money(r.total) },
              ]} />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Placa do veículo"><Input value={f.vehiclePlate} onChange={set('vehiclePlate')} placeholder="ABC1D23" className="uppercase" /></Field>
            <Field label="Tara (kg)"><Input type="number" min={0} value={f.vehicleTara} onChange={set('vehicleTara')} /></Field>
            <Field label="UF do veículo"><Select value={f.vehicleUf || company?.uf || ''} onChange={set('vehicleUf')}>{UFS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
            <Field label="RNTRC (opcional)" hint="Obrigatório para transportadoras"><Input value={f.rntrc} onChange={set('rntrc')} /></Field>
            <Field label="Condutor" className="md:col-span-2"><Input value={f.driverName} onChange={set('driverName')} /></Field>
            <Field label="CPF do condutor"><Input value={f.driverCpf} onChange={set('driverCpf')} /></Field>
            <Field label="UFs de percurso" hint="Entre a origem e o destino, ex.: MG GO"><Input value={f.route} onChange={set('route')} className="uppercase" /></Field>
            <Field label="Município de carregamento" hint={`Padrão: ${company?.city || '-'} (${company?.cityCode || 'sem código IBGE'})`}><Input value={f.loadCity} onChange={set('loadCity')} placeholder={company?.city || ''} /></Field>
            <Field label="Código IBGE carregamento"><Input value={f.loadCityCode} onChange={set('loadCityCode')} placeholder={company?.cityCode || ''} /></Field>
            <Field label="Município de descarregamento" hint="Padrão: cidade do destinatário da 1ª nota"><Input value={f.unloadCity} onChange={set('unloadCity')} /></Field>
            <Field label="Código IBGE descarregamento" hint="Vazio = busca automática"><Input value={f.unloadCityCode} onChange={set('unloadCityCode')} /></Field>
            <Field label="UF de descarregamento" hint="Vazio = UF dos destinatários"><Select value={f.ufEnd} onChange={set('ufEnd')}><option value="">Automática</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
          </div>
          <p className="text-xs text-muted-foreground">O peso bruto é calculado pelo peso cadastrado dos produtos × quantidades, e o valor da carga pela soma das notas. O manifesto deve ser <b>encerrado</b> ao fim da viagem; a NF-e não pode ser incluída em outro MDF-e enquanto este não for encerrado.</p>
        </div>
      </Dialog>
    </div>
  );
}

