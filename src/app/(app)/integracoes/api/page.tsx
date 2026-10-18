'use client';
import { useState } from 'react';
import { Copy, KeyRound, Plus, Send, Trash2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, Field, useDemoMode } from '@/components/common/page';
import { ResourceCrud } from '@/components/common/crud';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Select } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { fmtDateTime } from '@/lib/utils';

const EVENTS = ['order.created', 'order.invoiced', 'order.cancelled', 'order.separated', 'order.shipped', 'order.delivered', 'invoice.authorized', 'invoice.cancelled', 'stock.changed', 'product.price_changed', 'purchase.received', 'receivable.paid', 'payable.paid', 'shipment.posted', 'shipment.delivered', 'contact.created'];
const METHOD_COLOR: Record<string, string> = { get: 'blue', post: 'green', patch: 'orange', put: 'orange', delete: 'red' };

export default function ApiPage() {
  const { data: keys } = useApi<any>('/api/api-keys');
  const { data: deliveries } = useApi<any>('/api/webhooks/deliveries');
  const { data: spec } = useApi<any>('/api/v1/openapi.json');
  const act = useAction();
  const demo = useDemoMode();
  const [newKey, setNewKey] = useState<string | null>(null);
  const [tryIt, setTryIt] = useState({ method: 'GET', path: '/products?q=camiseta', key: '', body: '' });
  const [tryRes, setTryRes] = useState<string>('');
  const copy = (t: string) => { navigator.clipboard.writeText(t); toast.success('Copiado'); };
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const send = async () => {
    const r = await fetch(`/api/v1${tryIt.path}`, { method: tryIt.method, headers: { Authorization: `Bearer ${tryIt.key}`, 'Content-Type': 'application/json' }, body: tryIt.method === 'GET' ? undefined : tryIt.body || '{}' });
    setTryRes(`HTTP ${r.status}\n\n${JSON.stringify(await r.json(), null, 2)}`);
  };
  return (
    <div>
      <PageHeader title="API REST e webhooks" description="Integre sistemas externos ao GestãoPro: produtos, estoque, pedidos, contatos, notas e financeiro" />
      <Tabs defaultValue="docs">
        <TabsList><TabsTrigger value="docs">Documentação</TabsTrigger><TabsTrigger value="keys">Chaves de API</TabsTrigger><TabsTrigger value="webhooks">Webhooks</TabsTrigger><TabsTrigger value="deliveries">Entregas</TabsTrigger></TabsList>
        <TabsContent value="docs" className="space-y-3">
          <Card><CardContent className="space-y-2 text-sm">
            <p>{spec?.info.description}</p>
            <div className="rounded bg-sidebar p-3 font-mono text-xs text-green-300">curl {origin}/api/v1/products \<br />&nbsp;&nbsp;-H &quot;Authorization: Bearer SUA_CHAVE_DE_API&quot;</div>
            <p className="text-xs text-muted-foreground">Especificação OpenAPI 3.0: <a className="text-primary" href="/api/v1/openapi.json" target="_blank">/api/v1/openapi.json</a> (importe no Postman/Insomnia).</p>
          </CardContent></Card>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card><CardHeader><CardTitle>Endpoints</CardTitle></CardHeader><div className="divide-y">
              {spec && Object.entries(spec.paths).flatMap(([path, ops]: [string, any]) => Object.entries(ops).map(([m, op]: [string, any]) => (
                <button key={path + m} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-muted" onClick={() => setTryIt({ ...tryIt, method: m.toUpperCase(), path: path.replace('{sku}', 'CAM-BAS-BRA-M').replace('{id}', '1'), body: m === 'post' && path === '/orders' ? JSON.stringify({ externalId: 'ERP-123', customer: { document: '52998224725', name: 'Cliente API', city: 'São Paulo', uf: 'SP', zip: '01310100' }, items: [{ sku: 'CAM-BAS-BRA-M', quantity: 1 }], paymentMethod: 'PIX' }, null, 2) : m === 'post' && path === '/stock' ? JSON.stringify({ sku: 'CAM-BAS-BRA-M', type: 'ENTRADA', quantity: 5 }, null, 2) : m === 'patch' ? JSON.stringify({ price: 64.9 }, null, 2) : '' })}>
                  <Badge tone={METHOD_COLOR[m]}>{m.toUpperCase()}</Badge><span className="font-mono text-xs">{path}</span><span className="flex-1 text-right text-xs text-muted-foreground">{op.summary}</span>
                </button>
              )))}
            </div></Card>
            <Card><CardHeader><CardTitle className="flex items-center gap-1"><Play className="h-4 w-4" /> Testar requisição</CardTitle></CardHeader><CardContent className="space-y-2">
              <div className="flex gap-2"><Select className="w-28" value={tryIt.method} onChange={(e) => setTryIt({ ...tryIt, method: e.target.value })}>{['GET', 'POST', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}</Select><Input value={tryIt.path} onChange={(e) => setTryIt({ ...tryIt, path: e.target.value })} className="font-mono text-xs" /></div>
              <Input value={tryIt.key} onChange={(e) => setTryIt({ ...tryIt, key: e.target.value })} className="font-mono text-xs" placeholder="Chave de API" />
              {tryIt.method !== 'GET' && <Textarea rows={6} className="font-mono text-xs" value={tryIt.body} onChange={(e) => setTryIt({ ...tryIt, body: e.target.value })} />}
              <Button onClick={send}><Send /> Enviar</Button>
              {tryRes && <pre className="max-h-80 overflow-auto rounded bg-sidebar p-3 text-[11px] text-green-200">{tryRes}</pre>}
            </CardContent></Card>
          </div>
          <Card><CardHeader><CardTitle>Webhooks</CardTitle></CardHeader><CardContent className="text-sm"><p>Eventos disponíveis: {spec?.['x-webhooks'].events.map((e: string) => <code key={e} className="mr-1 rounded bg-muted px-1 text-xs">{e}</code>)}</p><p className="mt-2 text-xs text-muted-foreground">Assinatura: {spec?.['x-webhooks'].signature}. Payload: {'{ event, createdAt, data }'}.</p></CardContent></Card>
        </TabsContent>
        <TabsContent value="keys">
          <div className="mb-3 flex justify-end"><Button onClick={async () => { const name = prompt('Nome da integração', 'Meu ERP'); if (!name) return; const r: any = await act('POST', '/api/api-keys', { name }, 'Chave criada'); if (r) setNewKey(r.key); }}><Plus /> Gerar chave</Button></div>
          <DataTable rows={keys?.rows} columns={[{ key: 'name', header: 'Nome' }, { key: 'prefix', header: 'Prefixo', cell: (r: any) => <span className="font-mono text-xs">{r.prefix}…</span> }, { key: 'createdAt', header: 'Criada', cell: (r: any) => fmtDateTime(r.createdAt) }, { key: 'lastUsedAt', header: 'Último uso', cell: (r: any) => fmtDateTime(r.lastUsedAt) }, { key: 'a', header: '', align: 'right', cell: (r: any) => <Button variant="ghost" size="icon" onClick={() => confirm('Revogar chave?') && act('DELETE', `/api/api-keys/${r.id}`, undefined, 'Chave revogada')}><Trash2 className="text-destructive" /></Button> }]} />
        </TabsContent>
        <TabsContent value="webhooks">
          <ResourceCrud resource="webhooks" module="integracoes" title="Webhooks" description={demo ? "Use uma URL contendo 'simulado' ou 'example' para entregas simuladas; URLs reais recebem POST de verdade (se WEBHOOKS_SIMULATE_ONLY=false)." : 'Cada evento é enviado por POST à URL cadastrada, assinado com o segredo (HMAC-SHA256), com novas tentativas em caso de falha.'} defaults={{ active: true, events: ['order.created'] }}
            columns={[{ key: 'url', header: 'URL' }, { key: 'events', header: 'Eventos', render: (r) => <span className="text-xs">{r.events.join(', ')}</span> }, { key: 'secret', header: 'Segredo', render: (r) => <button className="font-mono text-[10px]" onClick={(e) => { e.stopPropagation(); copy(r.secret); }}>{r.secret?.slice(0, 10)}… <Copy className="inline h-3 w-3" /></button> }, { key: 'active', header: 'Ativo', format: 'bool' }, { key: 'test', header: '', render: (r) => <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); act('POST', `/api/webhooks/${r.id}/test`, {}, 'Evento de teste enviado'); }}>Testar</Button> }]}
            fields={[{ key: 'url', label: 'URL de destino', required: true, span: 3 }, { key: 'events', label: 'Eventos', type: 'multicheck', span: 3, options: EVENTS.map((e) => ({ value: e, label: e })) }, { key: 'active', label: 'Ativo', type: 'checkbox' }]} />
        </TabsContent>
        <TabsContent value="deliveries">
          <DataTable rows={deliveries?.rows} columns={[{ key: 'createdAt', header: 'Data', cell: (r: any) => fmtDateTime(r.createdAt) }, { key: 'event', header: 'Evento', cell: (r: any) => <code className="text-xs">{r.event}</code> }, { key: 'url', header: 'URL', cell: (r: any) => <span className="text-xs">{r.webhook.url}</span> }, { key: 'statusCode', header: 'HTTP', cell: (r: any) => <Badge tone={r.success ? 'green' : 'red'}>{r.statusCode}</Badge> }, { key: 'durationMs', header: 'Tempo', align: 'right', cell: (r: any) => `${r.durationMs} ms` }, { key: 'payload', header: 'Payload', cell: (r: any) => <button className="text-xs text-primary" onClick={() => alert(JSON.stringify(r.payload, null, 2))}>ver</button> }]} />
        </TabsContent>
      </Tabs>
      <Dialog open={!!newKey} onOpenChange={(o) => !o && setNewKey(null)} title="Chave de API gerada" description="Copie agora — por segurança ela não será exibida novamente (armazenamos apenas o hash)." size="sm">
        <div className="flex gap-2"><Input readOnly value={newKey || ''} className="font-mono text-xs" /><Button variant="outline" size="icon" onClick={() => copy(newKey!)}><KeyRound /></Button></div>
        <Field label=" "><span /></Field>
      </Dialog>
    </div>
  );
}
