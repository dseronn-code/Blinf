'use client';
import { useState } from 'react';
import { Calculator } from 'lucide-react';
import { useAction } from '@/lib/api';
import { PageHeader, Field, DataTable, SimBanner, useDemoMode } from '@/components/common/page';
import { EntityPicker } from '@/components/common/picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { money, num } from '@/lib/utils';

export default function FreightQuote() {
  const [f, setF] = useState<any>({ toZip: '', weight: 1, height: 10, width: 15, length: 20, value: 100 });
  const [orderId, setOrderId] = useState<string | null>(null);
  const [res, setRes] = useState<any>(null);
  const act = useAction();
  const demo = useDemoMode();
  const quote = async () => setRes(await act('POST', '/api/logistics/quote', orderId ? { orderId } : f, false));
  return (
    <div>
      <PageHeader title="Cotação de frete" description={demo ? "Compare Correios (PAC/SEDEX), transportadoras do Melhor Envio e GestãoPro Envios (tarifas com desconto)" : "Compare Correios (contrato) e as transportadoras do Melhor Envio conectados à sua conta"} />
      {!demo && res && !res.real && <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">Nenhuma cotação real disponível: conecte o Melhor Envio ou os Correios em Integrações → Contas e credenciais. Sem provedor, use frete próprio/transportadora própria ou retirada, informando o valor no pedido.</div>}
      {!res?.real && <SimBanner>sem conta do Melhor Envio ou dos Correios conectada (Integrações → Contas), os preços são calculados por fórmula própria considerando peso real × cúbico (L×A×C/6000), distância por região do CEP e seguro (0,5%).</SimBanner>}
      {res?.errors?.length > 0 && <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">{res.errors.map((e: string, i: number) => <div key={i}>{e}</div>)}</div>}
      <Card className="mb-3"><CardContent className="grid grid-cols-2 gap-3 md:grid-cols-7">
        <Field label="Cotar a partir de um pedido" className="col-span-2"><EntityPicker endpoint="/api/sales-orders?status=ABERTO,FATURADO,SEPARADO" value={orderId} label={orderId ? 'Pedido selecionado' : null} onChange={(v) => setOrderId(v)} map={(r: any) => ({ id: r.id, label: `#${r.number} — ${r.customer.name}`, sub: money(r.total) })} placeholder="ou informe o pacote →" /></Field>
        <Field label="CEP destino"><Input disabled={!!orderId} value={f.toZip} onChange={(e) => setF({ ...f, toZip: e.target.value })} placeholder="00000-000" /></Field>
        <Field label="Peso (kg)"><Input disabled={!!orderId} type="number" step="0.01" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} /></Field>
        <Field label="A x L x C (cm)"><div className="flex gap-1"><Input disabled={!!orderId} value={f.height} onChange={(e) => setF({ ...f, height: e.target.value })} /><Input disabled={!!orderId} value={f.width} onChange={(e) => setF({ ...f, width: e.target.value })} /><Input disabled={!!orderId} value={f.length} onChange={(e) => setF({ ...f, length: e.target.value })} /></div></Field>
        <Field label="Valor declarado"><Input disabled={!!orderId} type="number" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
        <Field label="&nbsp;"><Button className="w-full" onClick={quote}><Calculator /> Cotar</Button></Field>
      </CardContent></Card>
      {res?.package && <p className="mb-2 text-sm text-muted-foreground">Pacote do pedido: {num(res.package.weight, 3)} kg · {res.package.height}x{res.package.width}x{res.package.length} cm</p>}
      {res && <DataTable rows={res.options.map((o: any, i: number) => ({ ...o, id: String(i) }))} columns={[
        { key: 'carrier', header: 'Transportadora', cell: (r: any) => <b>{r.carrier}</b> }, { key: 'service', header: 'Serviço' },
        { key: 'provider', header: 'Via', cell: (r: any) => <span className="flex items-center gap-1"><Badge tone={r.provider === 'GESTAO_ENVIOS' ? 'green' : r.provider === 'MELHOR_ENVIO' ? 'blue' : 'yellow'}>{r.provider.replace('_', ' ')}</Badge>{!r.simulated && <Badge tone="green">contrato</Badge>}</span> },
        { key: 'deadlineDays', header: 'Prazo', align: 'right', cell: (r: any) => `${r.deadlineDays} dia(s) úteis` }, { key: 'price', header: 'Preço', align: 'right', cell: (r: any, ) => <b>{money(r.price)}</b> },
      ]} />}
    </div>
  );
}
