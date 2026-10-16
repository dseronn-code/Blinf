'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { useApi, qs, openFile } from '@/lib/api';
import { PageHeader, Filters, StatCard, Chips } from '@/components/common/page';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { money, num, toInputDate, startOfMonth, endOfMonth, cn } from '@/lib/utils';

export default function Dre() {
  const [from, setFrom] = useState(toInputDate(startOfMonth()));
  const [to, setTo] = useState(toInputDate(endOfMonth()));
  const [regime, setRegime] = useState<'COMPETENCIA' | 'CAIXA'>('COMPETENCIA');
  const { data } = useApi<any>(`/api/finance/dre${qs({ from, to, regime })}`);
  const presets = [0, 1, 2].map((m) => { const d = new Date(); d.setMonth(d.getMonth() - m); return { label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }), from: toInputDate(startOfMonth(d)), to: toInputDate(endOfMonth(d)) }; });
  return (
    <div>
      <PageHeader title="DRE gerencial" description={regime === 'CAIXA' ? 'Demonstração do resultado pelo regime de caixa: recebimentos e pagamentos efetivamente baixados no período, classificados pelo plano de contas' : 'Demonstração do resultado por competência: receitas de vendas/OS, impostos das notas, CMV real dos itens vendidos e despesas pelo plano de contas'} actions={<><Button variant="outline" onClick={() => openFile(`/api/reports/financeiro-dre${qs({ from, to, regime, format: 'pdf' })}`)}><Download /> PDF</Button><Button variant="outline" onClick={() => openFile(`/api/reports/financeiro-dre${qs({ from, to, regime, format: 'xlsx' })}`)}>Excel</Button></>} />
      <Filters>
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} /><Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        {presets.map((p) => <Button key={p.label} size="sm" variant="outline" onClick={() => { setFrom(p.from); setTo(p.to); }}>{p.label}</Button>)}
        <Button size="sm" variant="outline" onClick={() => { const y = new Date().getFullYear(); setFrom(`${y}-01-01`); setTo(`${y}-12-31`); }}>Ano</Button>
        <div className="ml-auto flex items-center gap-2"><span className="text-xs font-medium text-muted-foreground">Regime:</span><Chips value={regime} onChange={setRegime} options={[{ value: 'COMPETENCIA', label: 'Competência' }, { value: 'CAIXA', label: 'Caixa' }]} /></div>
      </Filters>
      <p className="mb-3 text-xs text-muted-foreground">
        {regime === 'COMPETENCIA'
          ? <><b>Competência:</b> receitas e despesas entram no mês em que o fato ocorreu (venda faturada, despesa incorrida), independentemente de quando foram recebidas ou pagas. Mostra a rentabilidade real do período.</>
          : <><b>Caixa:</b> considera apenas o que efetivamente entrou e saiu das contas (recebimentos e pagamentos baixados) na data da baixa. Mostra a geração de caixa do período.</>}
      </p>
      <div className="mb-3 grid grid-cols-3 gap-3"><StatCard label="Receita bruta" value={money(data?.grossRevenue)} /><StatCard label="Lucro líquido" value={money(data?.netProfit)} tone={data?.netProfit < 0 ? 'red' : 'green'} /><StatCard label="Margem líquida" value={`${num(data?.netMargin)}%`} tone="blue" /></div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2 text-left">Conta</th><th className="px-4 py-2 text-right">Valor</th><th className="px-4 py-2 text-right">% receita</th></tr></thead>
          <tbody>
            {data?.lines.map((l: any, i: number) => (
              <tr key={i} className={cn('border-t', l.bold && 'bg-muted/30 font-semibold')}>
                <td className={cn('px-4 py-2', l.level && 'pl-10 text-muted-foreground')}>{l.label}</td>
                <td className={cn('px-4 py-2 text-right tabular-nums', l.value < 0 && 'text-red-600')}>{money(l.value)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{num(l.percent)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
