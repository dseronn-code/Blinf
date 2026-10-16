'use client';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, Play, CheckCircle2, XCircle } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable, KV, Field } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { fmtDate, fmtDateTime, num, money } from '@/lib/utils';

export default function ProductionOrder() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const act = useAction();
  const { data: op } = useApi<any>(`/api/production/${id}`);
  const [finish, setFinish] = useState<string | null>(null);
  if (!op) return null;
  const run = (a: string, body: object, m: string) => act('POST', `/api/production/${id}/${a}`, body, m);
  return (
    <div>
      <PageHeader title={`Ordem de produção nº ${op.number}`} badge={<StatusBadge status={op.status} />} description={`${op.product.sku} — ${op.product.name}`} actions={<>
        <Button variant="outline" onClick={() => router.push('/producao')}><ArrowLeft /> Voltar</Button>
        {op.status === 'PLANEJADA' && <Button variant="outline" onClick={() => run('start', {}, 'Produção iniciada (disponibilidade de matéria-prima verificada)')}><Play /> Iniciar</Button>}
        {['PLANEJADA', 'EM_PRODUCAO'].includes(op.status) && <Button onClick={() => setFinish(String(op.quantity))}><CheckCircle2 /> Finalizar produção</Button>}
        {['PLANEJADA', 'EM_PRODUCAO'].includes(op.status) && <Button variant="outline" onClick={() => confirm('Cancelar OP?') && run('cancel', {}, 'OP cancelada')}><XCircle /></Button>}
      </>} />
      <Card className="mb-3"><CardContent className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <KV label="Quantidade" value={`${num(op.quantity)} ${op.product.unit}`} /><KV label="Produzido" value={num(op.producedQty)} /><KV label="Início" value={fmtDate(op.startDate)} /><KV label="Prazo" value={fmtDate(op.dueDate)} /><KV label="Responsável" value={op.responsible} /><KV label="Custo apurado" value={money(op.totalCost)} />
      </CardContent></Card>
      <Card className="mb-3"><CardHeader><CardTitle>Matérias-primas (ficha técnica × quantidade)</CardTitle></CardHeader>
        <DataTable rows={op.items} columns={[
          { key: 'description', header: 'Componente' }, { key: 'requiredQty', header: 'Necessário', align: 'right', cell: (r: any) => num(r.requiredQty, 3) },
          { key: 'available', header: 'Disponível', align: 'right', cell: (r: any) => num(r.available, 3) },
          { key: 'ok', header: 'Situação', cell: (r: any) => (op.status === 'FINALIZADA' ? <Badge tone="gray">consumido</Badge> : r.available >= r.requiredQty ? <Badge tone="green">disponível</Badge> : <Badge tone="red">falta {num(r.requiredQty - r.available, 3)}</Badge>) },
          { key: 'consumedQty', header: 'Consumido', align: 'right', cell: (r: any) => num(r.consumedQty, 3) }, { key: 'unitCost', header: 'Custo unit.', align: 'right', cell: (r: any) => money(r.unitCost) },
        ]} />
      </Card>
      {op.movements.length > 0 && <Card><CardHeader><CardTitle>Movimentações de estoque geradas</CardTitle></CardHeader><DataTable rows={op.movements} columns={[{ key: 'createdAt', header: 'Data', cell: (r: any) => fmtDateTime(r.createdAt) }, { key: 'originLabel', header: 'Origem' }, { key: 'lotNumber', header: 'Lote' }, { key: 'quantity', header: 'Qtd', align: 'right', cell: (r: any) => <span className={r.quantity < 0 ? 'text-red-600' : 'text-green-700'}>{num(r.quantity, 3)}</span> }, { key: 'unitCost', header: 'Custo', align: 'right', cell: (r: any) => money(r.unitCost) }]} /></Card>}
      <Dialog open={finish !== null} onOpenChange={(o) => !o && setFinish(null)} title="Finalizar produção" size="sm" footer={<Button onClick={async () => { const r = await run('finish', { producedQty: Number(finish) }, 'Produção finalizada: matérias-primas baixadas e produto acabado em estoque'); if (r) setFinish(null); }}>Finalizar</Button>}>
        <Field label="Quantidade efetivamente produzida" hint="O consumo de matéria-prima é proporcional"><Input type="number" value={finish ?? ''} onChange={(e) => setFinish(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}
