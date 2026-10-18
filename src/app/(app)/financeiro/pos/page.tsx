'use client';
import { useState } from 'react';
import { CreditCard, Plus } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, Field, SimBanner, StatCard, useDemoMode } from '@/components/common/page';
import { ResourceCrud } from '@/components/common/crud';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { money, fmtDateTime, round2 } from '@/lib/utils';

export default function Pos() {
  const { data } = useApi<any>('/api/finance/pos');
  const act = useAction();
  const [charge, setCharge] = useState<any>(null);
  const demo = useDemoMode();
  const rows = data?.rows || [];
  const approved = rows.filter((r: any) => r.status === 'APROVADA');
  return (
    <div>
      <PageHeader title="Maquininhas (POS integrado)" description="Vendas no cartão/Pix pela maquininha caem na conta com a taxa da adquirente lançada automaticamente" actions={<Button onClick={() => setCharge({ terminalId: data?.terminals[0]?.id, method: 'CREDITO', installments: 1 })}><CreditCard /> {demo ? 'Simular cobrança' : 'Registrar venda na maquininha'}</Button>} />
      <SimBanner>terminais e transações simulados (Stone/PagBank/Cielo); NSU e código de autorização gerados localmente.</SimBanner>
      <div className="mb-3 grid grid-cols-3 gap-3"><StatCard label="Transações aprovadas" value={approved.length} /><StatCard label="Valor bruto" value={money(approved.reduce((a: number, r: any) => a + r.amount, 0))} tone="green" /><StatCard label="Taxas" value={money(approved.reduce((a: number, r: any) => a + r.fee, 0))} tone="red" /></div>
      <Tabs defaultValue="tx">
        <TabsList><TabsTrigger value="tx">Transações</TabsTrigger><TabsTrigger value="terminais">Terminais</TabsTrigger></TabsList>
        <TabsContent value="tx">
          <DataTable rows={rows} columns={[
            { key: 'createdAt', header: 'Data', cell: (r: any) => fmtDateTime(r.createdAt) }, { key: 'terminal', header: 'Terminal' }, { key: 'method', header: 'Modalidade', cell: (r: any) => `${r.method}${r.installments > 1 ? ` ${r.installments}x` : ''}` },
            { key: 'brand', header: 'Bandeira' }, { key: 'nsu', header: 'NSU' }, { key: 'authCode', header: 'Autorização' },
            { key: 'amount', header: 'Bruto', align: 'right', cell: (r: any) => money(r.amount) }, { key: 'fee', header: 'Taxa', align: 'right', cell: (r: any) => money(r.fee) }, { key: 'netAmount', header: 'Líquido', align: 'right', cell: (r: any) => <b>{money(r.netAmount)}</b> },
            { key: 'status', header: 'Situação', cell: (r: any) => <Badge tone={r.status === 'APROVADA' ? 'green' : 'red'}>{r.status}</Badge> },
          ]} />
        </TabsContent>
        <TabsContent value="terminais">
          <ResourceCrud resource="pos-terminals" module="financeiro" title="Terminais POS" defaults={{ acquirer: 'Stone', debitFee: 1.39, creditFee: 3.19, pixFee: 0.49, active: true }}
            columns={[{ key: 'name', header: 'Terminal' }, { key: 'serial', header: 'Nº série' }, { key: 'acquirer', header: 'Adquirente' }, { key: 'debitFee', header: 'Débito', format: 'percent' }, { key: 'creditFee', header: 'Crédito', format: 'percent' }, { key: 'pixFee', header: 'Pix', format: 'percent' }]}
            fields={[{ key: 'name', label: 'Nome', required: true }, { key: 'serial', label: 'Número de série', required: true }, { key: 'acquirer', label: 'Adquirente', type: 'select', options: ['Stone', 'PagBank', 'Cielo', 'Rede', 'Getnet', 'Mercado Pago'].map((v) => ({ value: v, label: v })) }, { key: 'debitFee', label: 'Taxa débito (%)', type: 'percent' }, { key: 'creditFee', label: 'Taxa crédito (%)', type: 'percent' }, { key: 'pixFee', label: 'Taxa Pix (%)', type: 'percent' }, { key: 'active', label: 'Ativo', type: 'checkbox' }]} />
        </TabsContent>
      </Tabs>
      <Dialog open={!!charge} onOpenChange={(o) => !o && setCharge(null)} title={demo ? 'Cobrança na maquininha' : 'Venda passada na maquininha'} size="sm" footer={<Button onClick={async () => { const r: any = await act('POST', '/api/finance/pos', charge, false); if (r) { (await import('sonner')).toast[r.status === 'APROVADA' ? 'success' : 'error'](`Transação ${r.status}${r.nsu ? ` · NSU ${r.nsu}` : ''} · líquido ${money(r.netAmount)}`); setCharge(null); } }}><Plus /> {demo ? 'Cobrar' : 'Registrar'}</Button>}>
        {charge && <div className="space-y-3">
          <Field label="Terminal"><Select value={charge.terminalId} onChange={(e) => setCharge({ ...charge, terminalId: e.target.value })}>{data?.terminals.map((t: any) => <option key={t.id} value={t.id}>{t.name} ({t.acquirer})</option>)}</Select></Field>
          <Field label="Modalidade"><Select value={charge.method} onChange={(e) => setCharge({ ...charge, method: e.target.value })}><option value="CREDITO">Crédito</option><option value="DEBITO">Débito</option><option value="PIX">Pix</option></Select></Field>
          {charge.method === 'CREDITO' && <Field label="Parcelas"><Select value={charge.installments} onChange={(e) => setCharge({ ...charge, installments: Number(e.target.value) })}>{[1, 2, 3, 6, 10, 12].map((n) => <option key={n} value={n}>{n}x</option>)}</Select></Field>}
          <Field label="Valor (R$)"><Input type="number" step="0.01" value={charge.amount || ''} onChange={(e) => setCharge({ ...charge, amount: e.target.value })} /></Field>
          {!demo && <>
            <p className="text-xs text-muted-foreground">Passe o cartão na maquininha e registre aqui a venda aprovada. Os dados do comprovante são opcionais.</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="NSU (opcional)"><Input value={charge.nsu || ''} onChange={(e) => setCharge({ ...charge, nsu: e.target.value })} /></Field>
              <Field label="Autorização (opcional)"><Input value={charge.authCode || ''} onChange={(e) => setCharge({ ...charge, authCode: e.target.value })} /></Field>
            </div>
            {charge.method !== 'PIX' && <Field label="Bandeira (opcional)"><Input value={charge.brand || ''} onChange={(e) => setCharge({ ...charge, brand: e.target.value })} placeholder="Visa, Mastercard, Elo…" /></Field>}
          </>}
          {charge.amount && <p className="text-xs text-muted-foreground">Taxa estimada: {money(round2((Number(charge.amount) * ((charge.method === 'CREDITO' ? data?.terminals.find((t: any) => t.id === charge.terminalId)?.creditFee : charge.method === 'DEBITO' ? data?.terminals.find((t: any) => t.id === charge.terminalId)?.debitFee : data?.terminals.find((t: any) => t.id === charge.terminalId)?.pixFee) || 0)) / 100))}</p>}
        </div>}
      </Dialog>
    </div>
  );
}
