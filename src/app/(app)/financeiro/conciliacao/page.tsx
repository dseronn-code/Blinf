'use client';
import { useState } from 'react';
import { Download, Upload, Link2, Plus, EyeOff } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, Filters, DataTable, SimBanner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { money, fmtDate } from '@/lib/utils';

export default function Reconciliation() {
  const { data: banks } = useApi<any>('/api/finance/banks');
  const [acc, setAcc] = useState('');
  const bankId = acc || banks?.rows.find((b: any) => b.isDefault)?.id || '';
  const { data, isLoading } = useApi<any>(bankId ? `/api/finance/reconcile?bankAccountId=${bankId}` : null);
  const act = useAction();
  const upload = async (f?: File) => {
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    fd.append('bankAccountId', bankId);
    const r: any = await act('POST', '/api/finance/ofx', fd, false);
    if (r) (await import('sonner')).toast.success(`${r.imported} transação(ões) importada(s), ${r.duplicated} duplicada(s) ignorada(s)`);
  };
  return (
    <div>
      <PageHeader title="Conciliação bancária" description="Importe o extrato OFX do banco e concilie cada transação com as contas a pagar/receber (sugestões por valor, data e nome)"
        actions={<><Button variant="outline" onClick={() => window.open('/api/finance/ofx', '_blank')}><Download /> Gerar OFX de exemplo</Button><label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-white"><Upload className="h-4 w-4" /> Importar OFX<input type="file" accept=".ofx,.txt" className="hidden" onChange={(e) => upload(e.target.files?.[0])} /></label></>} />
      <SimBanner>o OFX de exemplo contém transações que batem com títulos em aberto (para testar as sugestões), além de tarifa e rendimento sem título.</SimBanner>
      <Filters><Select className="w-64" value={bankId} onChange={(e) => setAcc(e.target.value)}>{banks?.rows.map((b: any) => <option key={b.id} value={b.id}>{b.name} {b.pending ? `(${b.pending} pendentes)` : ''}</option>)}</Select></Filters>
      <DataTable loading={isLoading} rows={data?.rows} empty="Nenhuma transação pendente de conciliação 🎉" columns={[
        { key: 'date', header: 'Data', cell: (r: any) => fmtDate(r.date) },
        { key: 'description', header: 'Extrato', cell: (r: any) => <div><div className="font-medium">{r.description}</div><div className="text-[10px] text-muted-foreground">FITID {r.fitId}</div></div> },
        { key: 'amount', header: 'Valor', align: 'right', cell: (r: any) => <b className={r.amount < 0 ? 'text-red-600' : 'text-green-700'}>{money(r.amount)}</b> },
        { key: 'sug', header: 'Sugestões de título', cell: (r: any) => r.suggestions.length ? (
          <div className="space-y-1">{r.suggestions.slice(0, 3).map((s: any, i: number) => (
            <div key={s.id} className="flex items-center gap-2 text-xs">
              {i === 0 && <Badge tone="green">melhor</Badge>}
              <span className="flex-1">{s.description} · {s.contactName} · venc. {fmtDate(s.dueDate)} · {money(s.open)}</span>
              <Button size="sm" variant={i === 0 ? 'default' : 'outline'} onClick={() => act('POST', '/api/finance/reconcile', { transactionId: r.id, entryId: s.id }, 'Conciliado e título baixado')}><Link2 /> Conciliar</Button>
            </div>
          ))}</div>
        ) : <span className="text-xs text-muted-foreground">Nenhum título compatível</span> },
        { key: 'a', header: '', align: 'right', cell: (r: any) => <div className="flex justify-end gap-1"><Button size="sm" variant="outline" title="Criar lançamento já baixado" onClick={() => act('POST', '/api/finance/reconcile', { transactionId: r.id, create: { description: r.description } }, 'Lançamento criado e conciliado')}><Plus /> Criar</Button><Button size="icon" variant="ghost" title="Ignorar" onClick={() => act('POST', '/api/finance/reconcile', { transactionId: r.id, ignore: true }, 'Transação ignorada')}><EyeOff /></Button></div> },
      ]} />
    </div>
  );
}
