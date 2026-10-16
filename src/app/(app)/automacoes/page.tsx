'use client';
import { useState } from 'react';
import { Zap, Play } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, Chips, Filters, StatCard } from '@/components/common/page';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fmtDateTime } from '@/lib/utils';
import { useCan } from '@/components/layout/me';

export default function Automations() {
  const { data } = useApi<any>('/api/automations', { refetchInterval: 20000 });
  const act = useAction();
  const can = useCan();
  const [group, setGroup] = useState('');
  const list = (data?.automations || []).filter((a: any) => !group || a.group === group);
  const groups = [...new Set((data?.automations || []).map((a: any) => a.group))] as string[];
  return (
    <div>
      <PageHeader title="Automações" description="Regras que conectam os módulos: cada evento (pedido, nota, compra, pagamento, envio, estoque) dispara ações reais. Ative ou desative conforme seu processo." actions={<Button variant="outline" onClick={() => act('POST', '/api/automations/run', {}, 'Rotina diária executada')}><Play /> Executar rotina diária</Button>} />
      <div className="mb-3 grid grid-cols-3 gap-3">
        <StatCard label="Automações disponíveis" value={data?.automations.length ?? 0} icon={Zap} />
        <StatCard label="Ativas" value={data?.automations.filter((a: any) => a.active).length ?? 0} tone="green" />
        <StatCard label="Execuções registradas" value={data?.automations.reduce((s: number, a: any) => s + a.runs, 0) ?? 0} tone="blue" />
      </div>
      <Filters><Chips value={group} onChange={setGroup} options={[{ value: '', label: 'Todas' }, ...groups.map((g) => ({ value: g, label: g }))]} /></Filters>
      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((a: any) => (
          <Card key={a.key} className="flex flex-col p-4">
            <div className="mb-1 flex items-start justify-between gap-2"><div className="font-semibold leading-tight">{a.name}</div><Switch checked={a.active} disabled={!can('automacoes', 'edit')} onChange={(v) => act('PUT', '/api/automations', { key: a.key, active: v }, v ? 'Automação ativada' : 'Automação desativada')} /></div>
            <p className="flex-1 text-xs text-muted-foreground">{a.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px]"><Badge tone="purple">quando: {a.event}</Badge><Badge>{a.group}</Badge><span className="ml-auto text-muted-foreground">{a.runs} execuções{a.lastRunAt ? ` · ${fmtDateTime(a.lastRunAt)}` : ''}</span></div>
          </Card>
        ))}
      </div>
      <h3 className="mb-2 text-sm font-semibold">Últimas execuções</h3>
      <DataTable rows={data?.logs} columns={[{ key: 'createdAt', header: 'Data', cell: (r: any) => fmtDateTime(r.createdAt) }, { key: 'name', header: 'Automação' }, { key: 'event', header: 'Evento', cell: (r: any) => <code className="text-xs">{r.event}</code> }, { key: 'success', header: 'Resultado', cell: (r: any) => <Badge tone={r.success ? 'green' : 'red'}>{r.success ? 'sucesso' : 'erro'}</Badge> }, { key: 'message', header: 'Detalhe', cell: (r: any) => <span className="text-xs">{r.message}</span> }]} />
    </div>
  );
}
