'use client';
import { useEffect, useRef, useState } from 'react';
import { Bot, Send, Trash2, User, Sparkles } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const SUGGESTIONS = ['Como está meu negócio hoje?', 'Quanto vendi nos últimos 7 dias?', 'Quais produtos estão acabando?', 'Qual a inadimplência?', 'Produtos mais vendidos do mês', 'Contas a pagar e receber da semana', 'DRE do mês', 'Quem são meus melhores clientes?', 'Estoque da camiseta', 'Pedidos pendentes'];

/** Renderização mínima de markdown (negrito, itálico, listas) */
function Md({ text }: { text: string }) {
  const html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
    .split('\n').map((l) => (/^\s*[-•]\s/.test(l) ? `<li>${l.replace(/^\s*[-•]\s/, '')}</li>` : /^\d+\.\s/.test(l) ? `<li>${l.replace(/^\d+\.\s/, '')}</li>` : l ? `<p>${l}</p>` : '')).join('')
    .replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
  return <div className="md text-sm" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function Assistant() {
  const { data } = useApi<any>('/api/ai/chat');
  const act = useAction();
  const [msgs, setMsgs] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (data) setMsgs(data.rows); }, [data]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);
  const ask = async (text: string) => {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    setBusy(true);
    const r: any = await act('POST', '/api/ai/chat', { message: text }, false);
    setBusy(false);
    if (r) setMsgs((m) => [...m, { role: 'assistant', content: r.answer }]);
  };
  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <PageHeader title="Assistente de IA" badge={<Badge tone={data?.engine === 'claude' ? 'purple' : 'gray'}>{data?.engine === 'claude' ? 'Claude' : 'motor local'}</Badge>} description="Pergunte sobre vendas, estoque, financeiro e clientes — as respostas consultam os dados reais do sistema" actions={<Button variant="outline" onClick={async () => { await act('DELETE', '/api/ai/chat', undefined, 'Conversa limpa'); setMsgs([]); }}><Trash2 /> Limpar</Button>} />
      <Card className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {!msgs.length && (
            <div className="py-10 text-center">
              <Sparkles className="mx-auto mb-3 h-10 w-10 text-primary" />
              <div className="font-semibold">Como posso ajudar?</div>
              <div className="mx-auto mt-4 flex max-w-2xl flex-wrap justify-center gap-2">{SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s)} className="rounded-full border px-3 py-1.5 text-xs hover:bg-accent">{s}</button>)}</div>
              {data?.engine !== 'claude' && <p className="mt-6 text-xs text-muted-foreground">Defina ANTHROPIC_API_KEY no .env para usar o Claude com ferramentas de consulta ao ERP. Sem a chave, um motor local de intenções em português responde com os mesmos dados.</p>}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={cn('flex gap-3', m.role === 'user' && 'flex-row-reverse')}>
              <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', m.role === 'user' ? 'bg-primary text-white' : 'bg-violet-100 text-violet-700')}>{m.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}</div>
              <div className={cn('max-w-[75%] rounded-lg px-4 py-2.5', m.role === 'user' ? 'bg-primary text-white' : 'border bg-muted/40')}>{m.role === 'user' ? <p className="text-sm">{m.content}</p> : <Md text={m.content} />}</div>
            </div>
          ))}
          {busy && <div className="flex gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-violet-700"><Bot className="h-4 w-4" /></div><div className="rounded-lg border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">Consultando os dados…</div></div>}
          <div ref={end} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="flex gap-2 border-t p-3">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ex.: quanto vendi no Mercado Livre nos últimos 30 dias?" disabled={busy} />
          <Button disabled={busy}><Send /> Enviar</Button>
        </form>
      </Card>
    </div>
  );
}
