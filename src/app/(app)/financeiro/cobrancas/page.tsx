'use client';
import { useState } from 'react';
import { Plus, Copy, ExternalLink, XCircle, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, useAction, openFile } from '@/lib/api';
import { PageHeader, DataTable, Field, SimBanner } from '@/components/common/page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/ui/badge';
import { money, fmtDate, fmtDateTime, toInputDate, addDays } from '@/lib/utils';

export default function Billing() {
  const { data: links } = useApi<any>('/api/finance/payment-links');
  const { data: boletos } = useApi<any>('/api/finance/entries?type=RECEBER&status=EM_ABERTO&pageSize=200');
  const act = useAction();
  const [n, setN] = useState<any>(null);
  const copy = (t: string) => { navigator.clipboard.writeText(t); toast.success('Copiado'); };
  const withBilling = (boletos?.rows || []).filter((e: any) => e.boletoLine || e.pixPayload);
  return (
    <div>
      <PageHeader title="Boletos, Pix e links de pagamento" description="Cobranças registradas automaticamente nos recebíveis (boleto FEBRABAN + Pix BR Code); links de pagamento baixam a conta ao serem pagos" actions={<Button onClick={() => setN({ methods: 'TODOS', expiresAt: toInputDate(addDays(new Date(), 7)) })}><Plus /> Novo link de pagamento</Button>} />
      <SimBanner>linha digitável, código de barras e BR Code Pix seguem os padrões reais (com dígitos verificadores e CRC16), mas não são registrados em banco algum. Use "Abrir" e pague na página pública para testar a baixa automática.</SimBanner>
      <Tabs defaultValue="links">
        <TabsList><TabsTrigger value="links">Links de pagamento</TabsTrigger><TabsTrigger value="boletos">Boletos e Pix em aberto</TabsTrigger></TabsList>
        <TabsContent value="links">
          <DataTable rows={links?.rows} columns={[
            { key: 'createdAt', header: 'Criado', cell: (r: any) => fmtDate(r.createdAt) }, { key: 'description', header: 'Descrição' }, { key: 'customerName', header: 'Cliente' },
            { key: 'methods', header: 'Meios' }, { key: 'amount', header: 'Valor', align: 'right', cell: (r: any) => money(r.amount) },
            { key: 'status', header: 'Situação', cell: (r: any) => <div><StatusBadge status={r.status} />{r.paidAt && <div className="text-[10px] text-muted-foreground">{r.paidMethod} {fmtDateTime(r.paidAt)}</div>}</div> },
            { key: 'a', header: '', align: 'right', cell: (r: any) => <div className="flex justify-end gap-1"><Button size="icon" variant="ghost" onClick={() => copy(`${window.location.origin}/pagar/${r.slug}`)}><Copy /></Button><Button size="icon" variant="ghost" onClick={() => window.open(`/pagar/${r.slug}`, '_blank')}><ExternalLink /></Button>{r.status === 'ATIVO' && <Button size="icon" variant="ghost" onClick={() => act('DELETE', `/api/finance/payment-links/${r.id}`, undefined, 'Link cancelado')}><XCircle /></Button>}</div> },
          ]} />
        </TabsContent>
        <TabsContent value="boletos">
          <DataTable rows={withBilling} columns={[
            { key: 'dueDate', header: 'Vencimento', cell: (r: any) => fmtDate(r.dueDate) }, { key: 'contactName', header: 'Pagador' }, { key: 'description', header: 'Descrição' },
            { key: 'boletoLine', header: 'Linha digitável', cell: (r: any) => <button className="font-mono text-[10px] hover:text-primary" onClick={() => copy(r.boletoLine)}>{r.boletoLine}</button> },
            { key: 'amount', header: 'Valor', align: 'right', cell: (r: any) => money(r.amount - r.paidAmount) },
            { key: 'a', header: '', align: 'right', cell: (r: any) => <div className="flex justify-end gap-1"><Button size="sm" variant="outline" onClick={() => openFile(`/api/finance/entries/${r.id}/boleto`)}><FileText /> PDF</Button>{r.pixPayload && <Button size="sm" variant="outline" onClick={() => copy(r.pixPayload)}>Pix copia e cola</Button>}</div> },
          ]} />
        </TabsContent>
      </Tabs>
      <Dialog open={!!n} onOpenChange={(o) => !o && setN(null)} title="Novo link de pagamento" size="sm" footer={<Button onClick={async () => { const r = await act('POST', '/api/finance/payment-links', n, 'Link criado (conta a receber gerada)'); if (r) setN(null); }}>Criar link</Button>}>
        {n && <div className="space-y-3">
          <Field label="Descrição"><Input value={n.description || ''} onChange={(e) => setN({ ...n, description: e.target.value })} /></Field>
          <Field label="Cliente"><Input value={n.customerName || ''} onChange={(e) => setN({ ...n, customerName: e.target.value })} /></Field>
          <Field label="Valor (R$)"><Input type="number" step="0.01" value={n.amount || ''} onChange={(e) => setN({ ...n, amount: e.target.value })} /></Field>
          <Field label="Meios aceitos"><Select value={n.methods} onChange={(e) => setN({ ...n, methods: e.target.value })}><option value="TODOS">Pix, boleto e cartão</option><option value="PIX">Somente Pix</option><option value="BOLETO">Somente boleto</option><option value="CARTAO">Somente cartão</option></Select></Field>
          <Field label="Expira em"><Input type="date" value={n.expiresAt} onChange={(e) => setN({ ...n, expiresAt: e.target.value })} /></Field>
        </div>}
      </Dialog>
    </div>
  );
}
