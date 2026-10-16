'use client';
import { useState } from 'react';
import { useApi, qs } from '@/lib/api';
import { PageHeader, DataTable, Chips, Filters } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { fmtDateTime } from '@/lib/utils';

export default function IntegrationLogs() {
  const [type, setType] = useState('');
  const { data, isLoading } = useApi<any>(`/api/integrations/logs${qs({ type })}`, { refetchInterval: 15000 });
  return (
    <div>
      <PageHeader title="Logs de sincronização" description="Pedidos importados, estoques e preços enviados, anúncios publicados e erros de integração" />
      <Filters><Chips value={type} onChange={setType} options={[{ value: '', label: 'Todos' }, { value: 'PEDIDO', label: 'Pedidos' }, { value: 'ESTOQUE', label: 'Estoque' }, { value: 'PRECO', label: 'Preço' }, { value: 'ANUNCIO', label: 'Anúncios' }, { value: 'CONEXAO', label: 'Conexão' }, { value: 'ERRO', label: 'Erros' }]} /></Filters>
      <DataTable loading={isLoading} rows={data?.rows} columns={[{ key: 'createdAt', header: 'Data', cell: (r: any) => fmtDateTime(r.createdAt) }, { key: 'channel', header: 'Canal', cell: (r: any) => r.channel.name }, { key: 'type', header: 'Tipo', cell: (r: any) => <Badge tone={r.success ? (r.type === 'PEDIDO' ? 'green' : 'blue') : 'red'}>{r.type}</Badge> }, { key: 'message', header: 'Mensagem', cell: (r: any) => <div>{r.message}{r.payload?.changes && <div className="text-[10px] text-muted-foreground">{r.payload.changes.slice(0, 6).join(' · ')}</div>}</div> }]} />
    </div>
  );
}
