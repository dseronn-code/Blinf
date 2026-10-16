'use client';
import { useEffect, useRef, useState } from 'react';
import { Save, RotateCcw, Send, Mail } from 'lucide-react';
import { useApi, useAction, api } from '@/lib/api';
import { PageHeader, Field, SimBanner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/** Modelos de e-mail (como no Bling): assunto + conteúdo HTML com variáveis e pré-visualização */
export default function EmailTemplates() {
  const { data } = useApi<any>('/api/email-templates');
  const act = useAction();
  const [key, setKey] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const [active, setActive] = useState(true);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [to, setTo] = useState('');
  const [focus, setFocus] = useState<'subject' | 'html'>('html');
  const area = useRef<HTMLTextAreaElement>(null);
  const subj = useRef<HTMLInputElement>(null);
  const cur = data?.rows?.find((r: any) => r.key === key);

  useEffect(() => { if (data?.rows?.length && !key) setKey(data.rows[0].key); }, [data, key]);
  useEffect(() => { if (cur) { setSubject(cur.subject); setHtml(cur.html); setActive(cur.active); } }, [cur?.key, cur?.subject, cur?.html, cur?.active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pré-visualização com dados de exemplo (atualiza após uma pausa na digitação)
  useEffect(() => {
    if (!key) return;
    const t = setTimeout(() => api('/api/email-templates', { method: 'POST', json: { action: 'preview', key, subject, html } }).then(setPreview).catch(() => {}), 400);
    return () => clearTimeout(t);
  }, [key, subject, html]);

  const insert = (v: string) => {
    const tag = `{{${v}}}`;
    const el = focus === 'subject' ? subj.current : area.current;
    const val = focus === 'subject' ? subject : html;
    const set = focus === 'subject' ? setSubject : setHtml;
    const start = el?.selectionStart ?? val.length, end = el?.selectionEnd ?? val.length;
    set(val.slice(0, start) + tag + val.slice(end));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + tag.length, start + tag.length); });
  };

  return (
    <div>
      <PageHeader title="Modelos de e-mail" description="Personalize os e-mails enviados aos clientes: pedidos, notas fiscais, rastreio, cobranças, OS e acessos" />
      {data && !data.realEmail && <SimBanner>nenhum SMTP configurado — os e-mails ficam registrados na caixa de saída como simulados. Conecte o SMTP da empresa em Integrações → Contas.</SimBanner>}
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card><CardContent className="space-y-1 p-2">
          {data?.rows?.map((r: any) => (
            <button key={r.key} onClick={() => setKey(r.key)} className={cn('block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted', key === r.key && 'bg-muted ring-1 ring-primary')}>
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{r.name}</span>{r.custom && <Badge tone={r.active ? 'blue' : 'gray'}>{r.active ? 'personalizado' : 'inativo'}</Badge>}</div>
              <div className="text-xs text-muted-foreground">{r.description}</div>
            </button>
          ))}
        </CardContent></Card>
        {cur && (
          <div className="grid gap-4 xl:grid-cols-2">
            <Card><CardHeader><CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4" />{cur.name}</CardTitle></CardHeader><CardContent className="space-y-3">
              <Field label="Assunto"><Input ref={subj} value={subject} onFocus={() => setFocus('subject')} onChange={(e) => setSubject(e.target.value)} /></Field>
              <Field label="Conteúdo (HTML)" hint="Use {{#variavel}}...{{/variavel}} para mostrar um trecho só quando a variável tiver valor.">
                <textarea ref={area} value={html} onFocus={() => setFocus('html')} onChange={(e) => setHtml(e.target.value)} rows={16} className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" spellCheck={false} />
              </Field>
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Variáveis (clique para inserir no {focus === 'subject' ? 'assunto' : 'conteúdo'})</div>
                <div className="flex flex-wrap gap-1">{data.vars.map((v: any) => <button key={v.key} title={v.label} onClick={() => insert(v.key)} className="rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] hover:bg-primary hover:text-primary-foreground">{`{{${v.key}}}`}</button>)}</div>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Usar este modelo personalizado</label>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => act('PUT', '/api/email-templates', { key, subject, html, active }, 'Modelo salvo')}><Save /> Salvar</Button>
                {cur.custom && <Button variant="outline" onClick={() => act('PUT', '/api/email-templates', { key, reset: true }, 'Modelo padrão restaurado')}><RotateCcw /> Restaurar padrão</Button>}
              </div>
              <div className="flex gap-2 border-t pt-3">
                <Input placeholder="e-mail para teste" value={to} onChange={(e) => setTo(e.target.value)} />
                <Button variant="outline" disabled={!to} onClick={async () => { const r = await act<any>('POST', '/api/email-templates', { action: 'test', key, subject, html, to }, false); if (r) toast.success(r.simulated ? 'Teste registrado na caixa de saída (simulado — sem SMTP)' : `Teste enviado para ${to}`); }}><Send /> Enviar teste</Button>
              </div>
            </CardContent></Card>
            <Card><CardHeader><CardTitle>Pré-visualização</CardTitle><p className="text-xs text-muted-foreground">Com dados de exemplo · Assunto: <b>{preview?.subject}</b></p></CardHeader><CardContent>
              <iframe title="Pré-visualização do e-mail" sandbox="" srcDoc={preview?.html || ''} className="h-[640px] w-full rounded-md border bg-white" />
            </CardContent></Card>
          </div>
        )}
      </div>
    </div>
  );
}
