'use client';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ScanBarcode, PackageCheck, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, DataTable } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { money, fmtDate, num, cn } from '@/lib/utils';

/** Check-in de recebimento: conferência física (bipagem) antes de dar entrada */
export default function Checkin() {
  const sp = useSearchParams();
  const [id, setId] = useState(sp.get('id') || '');
  const { data: list } = useApi<any>('/api/purchases?status=ABERTO,ENVIADO,EM_CONFERENCIA');
  const { data: po } = useApi<any>(id ? `/api/purchases/${id}` : null);
  const [counts, setCounts] = useState<Record<string, { checkedQty: number; lotNumber?: string; expiresAt?: string }>>({});
  const [code, setCode] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const act = useAction();
  useEffect(() => {
    if (po) setCounts(Object.fromEntries(po.items.map((i: any) => [i.id, { checkedQty: i.checkedQty || 0, lotNumber: i.lotNumber || '', expiresAt: i.expiresAt ? i.expiresAt.slice(0, 10) : '' }])));
  }, [po]);
  const scan = (e: React.FormEvent) => {
    e.preventDefault();
    const it = po?.items.find((i: any) => i.product.sku.toLowerCase() === code.toLowerCase() || i.product.gtin === code);
    if (!it) toast.error(`Código ${code} não pertence a este pedido`);
    else setCounts((c) => ({ ...c, [it.id]: { ...c[it.id], checkedQty: (c[it.id]?.checkedQty || 0) + 1 } }));
    setCode('');
    ref.current?.focus();
  };
  const saveCheckin = async () => {
    const r: any = await act('POST', `/api/purchases/${id}/checkin`, { items: Object.entries(counts).map(([itemId, v]) => ({ itemId, ...v })) }, 'Conferência salva');
    if (r?.divergences?.length) toast.warning(`${r.divergences.length} divergência(s): o recebimento usará as quantidades conferidas`);
  };
  return (
    <div>
      <PageHeader title="Check-in de recebimento" description="Confira fisicamente as mercadorias (bipe o código de barras), informe lotes/validades e confirme o recebimento" />
      {!id ? (
        <DataTable rows={list?.rows} onRowClick={(r: any) => setId(r.id)} empty="Nenhum pedido aguardando recebimento" columns={[{ key: 'number', header: 'Nº' }, { key: 's', header: 'Fornecedor', cell: (r: any) => r.supplier.name }, { key: 'expectedDate', header: 'Previsão', cell: (r: any) => fmtDate(r.expectedDate) }, { key: 'total', header: 'Total', align: 'right', cell: (r: any) => money(r.total) }, { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> }]} />
      ) : po && (
        <div className="space-y-3">
          <Card><CardContent className="flex flex-wrap items-center gap-4">
            <div><div className="text-xs text-muted-foreground">Pedido</div><div className="font-bold">nº {po.number} · {po.supplier.name}</div></div>
            <StatusBadge status={po.status} />
            <form onSubmit={scan} className="flex flex-1 gap-2"><Input ref={ref} autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Bipe ou digite SKU/EAN e Enter" /><Button variant="outline"><ScanBarcode /> Conferir</Button></form>
            <Button variant="outline" onClick={() => setId('')}>Trocar pedido</Button>
          </CardContent></Card>
          <DataTable rows={po.items} rowClassName={(i: any) => cn(counts[i.id]?.checkedQty === i.quantity ? 'bg-green-50' : counts[i.id]?.checkedQty > i.quantity ? 'bg-red-50' : '')} columns={[
            { key: 'sku', header: 'SKU', cell: (i: any) => i.product.sku }, { key: 'description', header: 'Produto' },
            { key: 'quantity', header: 'Pedido', align: 'right', cell: (i: any) => num(i.quantity) },
            { key: 'checked', header: 'Conferido', align: 'right', cell: (i: any) => <Input type="number" className="ml-auto h-8 w-24 text-right" value={counts[i.id]?.checkedQty ?? 0} onChange={(e) => setCounts({ ...counts, [i.id]: { ...counts[i.id], checkedQty: Number(e.target.value) } })} /> },
            { key: 'diff', header: 'Situação', cell: (i: any) => { const d = (counts[i.id]?.checkedQty || 0) - i.quantity; return d === 0 ? <Badge tone="green">OK</Badge> : d < 0 ? <Badge tone="orange">Faltam {num(-d)}</Badge> : <Badge tone="red">Sobram {num(d)}</Badge>; } },
            { key: 'lot', header: 'Lote', cell: (i: any) => <Input className="h-8 w-28" disabled={!i.product.controlsLot} value={counts[i.id]?.lotNumber || ''} onChange={(e) => setCounts({ ...counts, [i.id]: { ...counts[i.id], lotNumber: e.target.value } })} placeholder={i.product.controlsLot ? 'obrigatório' : '—'} /> },
            { key: 'exp', header: 'Validade', cell: (i: any) => <Input type="date" className="h-8 w-36" disabled={!i.product.controlsLot} value={counts[i.id]?.expiresAt || ''} onChange={(e) => setCounts({ ...counts, [i.id]: { ...counts[i.id], expiresAt: e.target.value } })} /> },
          ]} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={saveCheckin}><Save /> Salvar conferência</Button>
            <Button onClick={async () => { await saveCheckin(); if (confirm('Confirmar recebimento com as quantidades conferidas?')) { await act('POST', `/api/purchases/${id}/receive`, {}, 'Recebimento concluído — estoque e financeiro lançados'); setId(''); } }}><PackageCheck /> Concluir recebimento</Button>
          </div>
        </div>
      )}
    </div>
  );
}
