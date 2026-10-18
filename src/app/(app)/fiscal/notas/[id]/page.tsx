'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, Send, XCircle, FileText, FileCode, PenLine, ShieldCheck, WifiOff } from 'lucide-react';
import { useApi, useAction, openFile } from '@/lib/api';
import { PageHeader, DataTable, KV } from '@/components/common/page';
import { PromptDialog } from '@/components/common/prompt';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { money, num, fmtDateTime, fmtDoc } from '@/lib/utils';
import { formatAccessKey } from '@/lib/br';

const FINALIDADE: Record<number, string> = { 1: '1 - NF-e normal', 2: '2 - NF-e complementar', 3: '3 - NF-e de ajuste', 4: '4 - Devolução de mercadoria' };
const pctOf = (v: unknown) => (Number(v) ? ` (${num(Number(v), 2)}%)` : '');

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const act = useAction();
  const { data: inv } = useApi<any>(`/api/invoices/${id}`);
  const [cancel, setCancel] = useState(false);
  const [cce, setCce] = useState(false);
  if (!inv) return null;
  const isService = inv.model === 'NFSE';
  return (
    <div>
      <PageHeader title={`${inv.model === 'NFE' ? 'NF-e' : inv.model === 'NFCE' ? 'NFC-e' : 'NFS-e'} nº ${inv.number} série ${inv.series}`} badge={inv.status === 'CONTINGENCIA' ? <Badge tone="orange">Contingência</Badge> : <StatusBadge status={inv.status} />} description={inv.natureName}
        actions={<>
          <Button variant="outline" onClick={() => router.back()}><ArrowLeft /> Voltar</Button>
          {['RASCUNHO', 'REJEITADA', 'CONTINGENCIA', 'PROCESSANDO'].includes(inv.status) && <Button onClick={() => act('POST', `/api/invoices/${id}/transmit`, {}, 'Nota transmitida — veja o retorno da SEFAZ')}><Send /> {inv.status === 'PROCESSANDO' ? 'Consultar retorno' : 'Transmitir'}</Button>}
          <Button variant="outline" onClick={() => openFile(`/api/invoices/${id}/danfe`)}><FileText /> {isService ? 'PDF da NFS-e' : inv.model === 'NFCE' ? 'DANFE NFC-e' : 'DANFE'}</Button>
          {inv.xml && <Button variant="outline" onClick={() => openFile(`/api/invoices/${id}/xml`)}><FileCode /> XML</Button>}
          {inv.status === 'AUTORIZADA' && inv.model === 'NFE' && <Button variant="outline" onClick={() => setCce(true)}><PenLine /> Carta de correção</Button>}
          {inv.status !== 'CANCELADA' && <Button variant="outline" onClick={() => setCancel(true)}><XCircle /> Cancelar</Button>}
        </>} />
      {(inv.signed || inv.contingency || (inv.finalidade && inv.finalidade !== 1) || inv.returnId || inv.transferId) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {inv.signed && <Badge tone="green"><ShieldCheck className="mr-1 h-3 w-3" /> XML assinado digitalmente</Badge>}
          {inv.contingency && <Badge tone="orange"><WifiOff className="mr-1 h-3 w-3" /> Emitida em contingência</Badge>}
          {inv.finalidade && inv.finalidade !== 1 && <Badge tone="purple">Finalidade: {FINALIDADE[inv.finalidade] || inv.finalidade}</Badge>}
          {inv.returnId && <Badge tone="blue">Nota de devolução</Badge>}
          {inv.transferId && <Badge tone="teal">Transferência entre empresas</Badge>}
        </div>
      )}
      {inv.status === 'CONTINGENCIA' && <div className="mb-3 rounded border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800"><b>NFC-e emitida em contingência offline (tpEmis 9).</b> Transmita à SEFAZ em até 24 horas após a emissão (desative a contingência em Fiscal › Certificado e use “Transmitir”).</div>}
      {inv.status === 'REJEITADA' && <div className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"><b>Rejeição {inv.rejectionCode}:</b> {inv.rejectionReason}<div className="mt-1 text-xs">Corrija o cadastro (cliente, produto, empresa ou certificado) e transmita novamente.</div></div>}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-3">
          <Card><CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KV label="Destinatário" value={inv.customerName} /><KV label="CPF/CNPJ" value={fmtDoc(inv.customerDoc) || '—'} /><KV label="UF destino" value={inv.customerUf} /><KV label="Emissão" value={fmtDateTime(inv.issueDate)} />
            {inv.accessKey && <div className="col-span-2 md:col-span-4"><KV label="Chave de acesso" value={<span className="font-mono">{formatAccessKey(inv.accessKey)}</span>} /></div>}
            {inv.refAccessKey && <div className="col-span-2 md:col-span-4"><KV label="NF-e referenciada" value={<span className="font-mono">{formatAccessKey(inv.refAccessKey)}</span>} /></div>}
            {!isService && <KV label="Finalidade" value={FINALIDADE[inv.finalidade || 1] || inv.finalidade} />}
            <KV label="Protocolo" value={inv.protocol} /><KV label="Autorização" value={fmtDateTime(inv.authorizedAt)} />{inv.verificationCode && <KV label="Código de verificação" value={inv.verificationCode} />}
            {inv.order && <KV label="Pedido" value={<Link className="text-primary" href={`/vendas/${inv.order.id}`}>#{inv.order.number}</Link>} />}
          </CardContent></Card>
          <DataTable rows={inv.items} columns={[
            { key: 'code', header: 'Código' }, { key: 'description', header: 'Descrição' },
            ...(!isService ? [{ key: 'ncm', header: 'NCM' }, { key: 'cfop', header: 'CFOP' }, { key: 'cst', header: 'CST/CSOSN' }] : []),
            { key: 'quantity', header: 'Qtd', align: 'right' as const, cell: (r: any) => num(r.quantity, 3) }, { key: 'unitPrice', header: 'Unit.', align: 'right' as const, cell: (r: any) => money(r.unitPrice) }, { key: 'total', header: 'Total', align: 'right' as const, cell: (r: any) => money(r.total) },
            ...(isService ? [{ key: 'iss', header: 'ISS', align: 'right' as const, cell: (r: any) => `${money(r.issValue)} (${r.issRate}%)` }] : [
              { key: 'icms', header: 'ICMS', align: 'right' as const, cell: (r: any) => `${money(r.icmsValue)} (${r.icmsRate}%)` },
              { key: 'ipi', header: 'IPI', align: 'right' as const, cell: (r: any) => money(r.ipiValue) },
              { key: 'pc', header: 'PIS/COFINS', align: 'right' as const, cell: (r: any) => `${money(r.pisValue)} / ${money(r.cofinsValue)}` },
              ...(inv.items.some((i: any) => i.icmsStValue || i.difalValue || i.fcpValue) ? [{ key: 'st', header: 'ST / DIFAL / FCP', align: 'right' as const, cell: (r: any) => (
                <div className="text-xs leading-tight">
                  {r.icmsStValue ? <div title={`Base ST ${money(r.icmsStBase)}`}>ST {money(r.icmsStValue)}</div> : null}
                  {r.difalValue ? <div>DIFAL {money(r.difalValue)}</div> : null}
                  {r.fcpValue ? <div>FCP {money(r.fcpValue)}</div> : null}
                  {!r.icmsStValue && !r.difalValue && !r.fcpValue && '—'}
                </div>
              ) }] : []),
            ]),
            { key: 'ibscbs', header: <span title="Informativos — Reforma Tributária 2026">IBS / CBS</span>, align: 'right' as const, cell: (r: any) => (
              <div className="text-xs leading-tight text-muted-foreground">
                <div>IBS {money(r.ibsValue)}{pctOf(r.ibsRate)}</div>
                <div>CBS {money(r.cbsValue)}{pctOf(r.cbsRate)}</div>
              </div>
            ) },
          ]} />
          {inv.additionalInfo && <Card className="p-3 text-xs text-muted-foreground"><b>Informações complementares:</b> {inv.additionalInfo}</Card>}
        </div>
        <div className="space-y-3">
          <Card><CardHeader><CardTitle>Totais e impostos</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
            {[['Produtos', inv.productsTotal], ['Serviços', inv.servicesTotal], ['Frete', inv.freight], ['Desconto', -inv.discount], ['Base ICMS', inv.icmsBase], ['ICMS', inv.icmsValue], ['Base ICMS ST', inv.icmsStBase], ['ICMS ST', inv.icmsStValue], ['DIFAL (EC 87/2015)', inv.difalValue], ['FCP', inv.fcpValue], ['IPI', inv.ipiValue], ['PIS', inv.pisValue], ['COFINS', inv.cofinsValue], ['ISS', inv.issValue], ['Tributos aprox. (IBPT)', inv.approxTaxes]].filter(([, v]) => v).map(([l, v]) => <div key={l as string} className="flex justify-between"><span className="text-muted-foreground">{l}</span><span>{money(v as number)}</span></div>)}
            <div className="flex justify-between border-t pt-2 text-lg font-bold"><span>Total da nota</span><span>{money(inv.total)}</span></div>
            <div className="mt-2 rounded-md border border-dashed p-2 text-xs">
              <div className="mb-1 font-medium text-muted-foreground">Informativos — Reforma Tributária 2026</div>
              <div className="flex justify-between"><span className="text-muted-foreground">IBS</span><span>{money(inv.ibsValue)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">CBS</span><span>{money(inv.cbsValue)}</span></div>
              <p className="mt-1 text-[10px] text-muted-foreground">Destacados apenas para informação; não compõem o total da nota em 2026.</p>
            </div>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Eventos</CardTitle></CardHeader><div className="divide-y">
            {inv.events.map((e: any) => <div key={e.id} className="px-4 py-2 text-xs"><div className="flex justify-between"><Badge tone={e.type === 'REJEICAO' ? 'red' : e.type === 'AUTORIZACAO' ? 'green' : e.type === 'CANCELAMENTO' ? 'gray' : 'blue'}>{e.type}</Badge><span className="text-muted-foreground">{fmtDateTime(e.createdAt)}</span></div><div className="mt-1">{e.description}</div>{e.protocol && <div className="text-muted-foreground">Protocolo {e.protocol}</div>}</div>)}
          </div></Card>
        </div>
      </div>
      <PromptDialog open={cancel} onOpenChange={setCancel} destructive title="Cancelar nota fiscal" description={inv.model === 'NFCE' ? 'Prazo legal: 30 minutos após a autorização' : 'Prazo legal: 24 horas após a autorização'} label="Justificativa (mínimo 15 caracteres — regra SEFAZ)" minLength={inv.status === 'AUTORIZADA' ? 15 : 0} confirmText="Cancelar nota" onConfirm={(reason) => act('POST', `/api/invoices/${id}/cancel`, { reason }, 'Nota cancelada — evento 135 registrado')} />
      <PromptDialog open={cce} onOpenChange={setCce} title="Carta de correção eletrônica (CC-e)" label="Texto da correção (não pode alterar valores, impostos ou destinatário)" minLength={15} confirmText="Registrar CC-e" onConfirm={(text) => act('POST', `/api/invoices/${id}/cce`, { text }, 'Carta de correção registrada')} />
    </div>
  );
}
