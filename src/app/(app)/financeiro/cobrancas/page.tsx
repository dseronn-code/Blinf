'use client';
import { useState } from 'react';
import { Plus, Copy, ExternalLink, XCircle, FileText, Receipt, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, useAction, openFile } from '@/lib/api';
import { PageHeader, DataTable, Field, SimBanner, useDemoMode } from '@/components/common/page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { money, fmtDate, fmtDateTime, toInputDate, addDays } from '@/lib/utils';

export default function Billing() {
  const { data: links } = useApi<any>('/api/finance/payment-links');
  const { data: boletos } = useApi<any>('/api/finance/entries?type=RECEBER&status=EM_ABERTO&pageSize=200');
  const act = useAction();
  const [n, setN] = useState<any>(null);
  const copy = (t: string) => { navigator.clipboard.writeText(t); toast.success('Copiado'); };
  const demo = useDemoMode();
  // Produção: mostra também os títulos por boleto/Pix ainda sem cobrança registrada
  const withBilling = (boletos?.rows || []).filter((e: any) => e.boletoLine || e.pixPayload || e.provider || (!demo && ['BOLETO', 'PIX'].includes(e.paymentMethod)));
  const gateway: { provider: string; name: string; environment: string; accountName?: string; autoCharge: boolean } | null = links?.gateway || null;
  const GW: Record<string, string> = { ASAAS: 'Asaas', MERCADO_PAGO: 'Mercado Pago' };
  const emit = async (r: any) => {
    const x: any = await act('POST', `/api/finance/entries/${r.id}/charge`, {}, false);
    if (x) toast.success(x.simulated ? 'Cobrança simulada gerada' : `Cobrança registrada no ${GW[x.provider] || x.provider}`);
  };
  return (
    <div>
      <PageHeader title="Boletos, Pix e links de pagamento" description="Cobranças registradas automaticamente nos recebíveis (boleto FEBRABAN + Pix BR Code); links de pagamento baixam a conta ao serem pagos" actions={<Button onClick={() => setN({ methods: 'TODOS', expiresAt: toInputDate(addDays(new Date(), 7)) })}><Plus /> Novo link de pagamento</Button>} />
      {gateway ? (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          <b>Cobranças reais via {gateway.name}</b>{gateway.accountName ? ` (${gateway.accountName})` : ''}{gateway.environment === 'SANDBOX' ? ' — ambiente de testes' : ''}: boletos, Pix e cartão são registrados no provedor e baixados automaticamente quando o pagamento cai.
          {gateway.autoCharge ? ' Recebíveis por boleto/Pix são emitidos automaticamente ao faturar.' : ' Emissão automática desligada: use "Emitir cobrança".'} Títulos marcados como "simulada" ainda não foram registrados.
        </div>
      ) : !demo ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <b>Sem cobrança registrada — conecte Asaas ou Mercado Pago</b> em Integrações → Contas e credenciais para emitir boletos, Pix e cartão com baixa automática. Enquanto isso, as contas a receber são lançadas normalmente; quando a conta bancária tem chave Pix cadastrada, o título recebe um Pix &quot;copia e cola&quot; estático para essa chave (o pagamento cai direto na sua conta, mas a <b>baixa é manual</b>).
        </div>
      ) : (
        <SimBanner>linha digitável, código de barras e BR Code Pix seguem os padrões reais (com dígitos verificadores e CRC16), mas não são registrados em banco algum. Use "Abrir" e pague na página pública para testar a baixa automática. Para cobrar de verdade, conecte o Asaas ou o Mercado Pago em Integrações → Contas e credenciais.</SimBanner>
      )}
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
            { key: 'provider', header: 'Cobrança', cell: (r: any) => r.provider ? <Badge tone="blue">{GW[r.provider] || r.provider}</Badge> : demo ? <Badge tone="yellow">Simulada</Badge> : r.pixPayload ? <Badge tone="gray">Pix estático · baixa manual</Badge> : <Badge tone="yellow">Sem cobrança registrada</Badge> },
            { key: 'boletoLine', header: 'Linha digitável', cell: (r: any) => r.boletoLine ? <button className="font-mono text-[10px] hover:text-primary" onClick={() => copy(r.boletoLine)}>{r.boletoLine}</button> : <span className="text-xs text-muted-foreground">{r.provider ? 'Pix / fatura' : '—'}</span> },
            { key: 'amount', header: 'Valor', align: 'right', cell: (r: any) => money(r.amount - r.paidAmount) },
            { key: 'a', header: '', align: 'right', cell: (r: any) => <div className="flex justify-end gap-1">
              {r.provider ? (r.paymentUrl && <Button size="sm" variant="outline" onClick={() => window.open(r.paymentUrl, '_blank')}><ExternalLink /> Boleto / fatura</Button>) : demo && <Button size="sm" variant="outline" onClick={() => openFile(`/api/finance/entries/${r.id}/boleto`)}><FileText /> PDF</Button>}
              {r.pixPayload && <Button size="sm" variant="outline" onClick={() => copy(r.pixPayload)}>Pix copia e cola</Button>}
              {!r.provider && gateway && <Button size="sm" variant="outline" onClick={() => emit(r)}><Receipt /> Emitir no {gateway.name}</Button>}
              {r.provider && <Button size="icon" variant="ghost" title="Cancelar cobrança" onClick={() => confirm('Cancelar a cobrança no provedor? O título continua em aberto.') && act('POST', `/api/finance/entries/${r.id}/cancel-charge`, {}, 'Cobrança cancelada')}><Ban /></Button>}
            </div> },
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
