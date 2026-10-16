'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Save, Receipt, Printer } from 'lucide-react';
import { useApi, useAction, openFile } from '@/lib/api';
import { PageHeader, Field, DataTable } from '@/components/common/page';
import { EntityPicker, contactOption } from '@/components/common/picker';
import { ItemsEditor, toRows, fromRows, newItem, itemTotal, type ItemRow } from '@/components/common/items';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/ui/badge';
import { money, fmtDate, fmtDateTime, toInputDate, round2 } from '@/lib/utils';

const FLOW = ['ABERTA', 'ORCAMENTO', 'APROVADA', 'EM_EXECUCAO', 'AGUARDANDO_PECA', 'CONCLUIDA', 'CANCELADA'];

export default function ServiceOrderPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'novo';
  const router = useRouter();
  const act = useAction();
  const { data } = useApi<any>(isNew ? null : `/api/service-orders/${id}`);
  const { data: techs } = useApi<any>('/api/r/sellers?kind=TECNICO');
  const [os, setOs] = useState<any>({ priority: 'NORMAL', discount: 0, problem: '' });
  const [items, setItems] = useState<ItemRow[]>([newItem('SERVICO')]);
  const [statusDlg, setStatusDlg] = useState<any>(null);
  const [inv, setInv] = useState<any>(null);
  useEffect(() => { if (data) { setOs({ ...data, dueDate: toInputDate(data.dueDate), customerLabel: data.customer.name }); setItems(toRows(data.items)); } }, [data]);
  const editable = isNew || !['FATURADA', 'CANCELADA'].includes(os.status);
  const total = round2(items.reduce((a, i) => a + itemTotal(i), 0) - Number(os.discount || 0));
  const save = async () => {
    const body = { ...os, items: fromRows(items).map((i) => ({ ...i, unitPrice: i.unitPrice ?? 0 })) };
    const r = isNew ? await act('POST', '/api/service-orders', body, 'OS aberta') : await act('PUT', `/api/service-orders/${id}`, body, 'OS salva');
    if (r && isNew) router.replace(`/servicos/${(r as any).id}`);
  };
  return (
    <div>
      <PageHeader title={isNew ? 'Nova ordem de serviço' : `OS nº ${os.number}`} badge={!isNew && <StatusBadge status={os.status} />} actions={<>
        <Button variant="outline" onClick={() => router.push('/servicos')}><ArrowLeft /> Voltar</Button>
        {!isNew && <Button variant="outline" onClick={() => openFile(`/api/service-orders/${id}/pdf`)}><Printer /> Imprimir</Button>}
        {!isNew && editable && <Button variant="outline" onClick={() => setStatusDlg({ status: os.status, note: '' })}>Alterar situação</Button>}
        {!isNew && editable && <Button variant="outline" onClick={() => setInv({ installments: 1, paymentMethod: 'PIX', emitNfse: true })}><Receipt /> Faturar OS</Button>}
        {editable && <Button onClick={save}><Save /> Salvar</Button>}
      </>} />
      <div className="grid gap-3 xl:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          <Card><CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Cliente *" className="md:col-span-2"><EntityPicker disabled={!editable} endpoint="/api/r/contacts?type=CLIENTE" value={os.customerId} label={os.customerLabel} map={contactOption} onChange={(v, raw) => setOs({ ...os, customerId: v, customerLabel: raw?.name })} /></Field>
            <Field label="Técnico"><Select disabled={!editable} value={os.technicianId || ''} onChange={(e) => setOs({ ...os, technicianId: e.target.value })}><option value="">—</option>{techs?.rows.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
            <Field label="Prioridade"><Select disabled={!editable} value={os.priority} onChange={(e) => setOs({ ...os, priority: e.target.value })}>{['BAIXA', 'NORMAL', 'ALTA', 'URGENTE'].map((p) => <option key={p}>{p}</option>)}</Select></Field>
            <Field label="Equipamento"><Input disabled={!editable} value={os.equipment || ''} onChange={(e) => setOs({ ...os, equipment: e.target.value })} /></Field>
            <Field label="Marca"><Input disabled={!editable} value={os.brand || ''} onChange={(e) => setOs({ ...os, brand: e.target.value })} /></Field>
            <Field label="Modelo"><Input disabled={!editable} value={os.model || ''} onChange={(e) => setOs({ ...os, model: e.target.value })} /></Field>
            <Field label="Nº de série"><Input disabled={!editable} value={os.serialNumber || ''} onChange={(e) => setOs({ ...os, serialNumber: e.target.value })} /></Field>
            <Field label="Acessórios entregues" className="md:col-span-2"><Input disabled={!editable} value={os.accessories || ''} onChange={(e) => setOs({ ...os, accessories: e.target.value })} /></Field>
            <Field label="Previsão de entrega"><Input disabled={!editable} type="date" value={os.dueDate || ''} onChange={(e) => setOs({ ...os, dueDate: e.target.value })} /></Field>
            <Field label="Desconto"><Input disabled={!editable} type="number" step="0.01" value={os.discount} onChange={(e) => setOs({ ...os, discount: e.target.value })} /></Field>
            <Field label="Defeito relatado *" className="md:col-span-4"><Textarea disabled={!editable} value={os.problem || ''} onChange={(e) => setOs({ ...os, problem: e.target.value })} /></Field>
            <Field label="Diagnóstico técnico" className="md:col-span-2"><Textarea disabled={!editable} value={os.diagnosis || ''} onChange={(e) => setOs({ ...os, diagnosis: e.target.value })} /></Field>
            <Field label="Solução aplicada" className="md:col-span-2"><Textarea disabled={!editable} value={os.solution || ''} onChange={(e) => setOs({ ...os, solution: e.target.value })} /></Field>
          </CardContent></Card>
          <ItemsEditor items={items} onChange={setItems} readOnly={!editable} />
        </div>
        <div className="space-y-3">
          <Card><CardContent className="space-y-1 text-sm"><div className="flex justify-between"><span>Serviços + peças</span><span>{money(total + Number(os.discount || 0))}</span></div><div className="flex justify-between"><span>Desconto</span><span>- {money(os.discount)}</span></div><div className="flex justify-between border-t pt-2 text-lg font-bold"><span>Total</span><span>{money(total)}</span></div></CardContent></Card>
          {!isNew && data?.invoice && <Card className="p-4 text-sm">NFS-e: <Link className="text-primary" href={`/fiscal/notas/${data.invoice.id}`}>nº {data.invoice.number}</Link> <StatusBadge status={data.invoice.status} /></Card>}
          {!isNew && data?.entries?.length > 0 && <Card><CardHeader><CardTitle>Contas a receber</CardTitle></CardHeader><DataTable rows={data.entries} columns={[{ key: 'dueDate', header: 'Venc.', cell: (r: any) => fmtDate(r.dueDate) }, { key: 'amount', header: 'Valor', align: 'right', cell: (r: any) => money(r.amount) }, { key: 'status', header: '', cell: (r: any) => <StatusBadge status={r.status} /> }]} /></Card>}
          {!isNew && <Card><CardHeader><CardTitle>Histórico</CardTitle></CardHeader><div className="divide-y">{data?.history.map((h: any) => <div key={h.id} className="px-4 py-2 text-xs"><div className="flex justify-between"><StatusBadge status={h.status} /><span className="text-muted-foreground">{fmtDateTime(h.createdAt)}</span></div><div className="mt-1">{h.description}</div><div className="text-muted-foreground">{h.userName}</div></div>)}</div></Card>}
        </div>
      </div>
      <Dialog open={!!statusDlg} onOpenChange={(o) => !o && setStatusDlg(null)} title="Alterar situação da OS" size="sm" footer={<Button onClick={async () => { const r = await act('POST', `/api/service-orders/${id}/status`, statusDlg, 'Situação atualizada'); if (r) setStatusDlg(null); }}>Salvar</Button>}>
        {statusDlg && <div className="space-y-3"><Select value={statusDlg.status} onChange={(e) => setStatusDlg({ ...statusDlg, status: e.target.value })}>{FLOW.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select><Textarea placeholder="Anotação do histórico" value={statusDlg.note} onChange={(e) => setStatusDlg({ ...statusDlg, note: e.target.value })} /></div>}
      </Dialog>
      <Dialog open={!!inv} onOpenChange={(o) => !o && setInv(null)} title="Faturar ordem de serviço" description="Emite NFS-e dos serviços, baixa as peças do estoque e lança as contas a receber" size="sm" footer={<Button onClick={async () => { const r = await act('POST', `/api/service-orders/${id}/invoice`, inv, 'OS faturada'); if (r) setInv(null); }}>Faturar</Button>}>
        {inv && <div className="space-y-3">
          <Field label="Forma de pagamento"><Select value={inv.paymentMethod} onChange={(e) => setInv({ ...inv, paymentMethod: e.target.value })}><option value="PIX">Pix</option><option value="BOLETO">Boleto</option><option value="CARTAO_CREDITO">Cartão</option><option value="DINHEIRO">Dinheiro</option></Select></Field>
          <Field label="Parcelas"><Input type="number" min={1} value={inv.installments} onChange={(e) => setInv({ ...inv, installments: Number(e.target.value) })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inv.emitNfse} onChange={(e) => setInv({ ...inv, emitNfse: e.target.checked })} /> Emitir NFS-e</label>
        </div>}
      </Dialog>
    </div>
  );
}
