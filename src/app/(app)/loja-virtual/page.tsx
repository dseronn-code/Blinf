'use client';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Save, ArrowUp, ArrowDown, Eye, EyeOff, Monitor, Smartphone } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, Field, StatCard } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea, Switch } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { money, cn } from '@/lib/utils';

const SECTION_LABEL: Record<string, string> = { banner: 'Banner principal', destaques: 'Produtos em destaque', categorias: 'Categorias', todos: 'Todos os produtos', sobre: 'Sobre a loja' };
const ALL = Object.keys(SECTION_LABEL);

export default function StoreEditor() {
  const { data } = useApi<any>('/api/store');
  const { data: lists } = useApi<any>('/api/r/price-lists');
  const { data: whs } = useApi<any>('/api/r/warehouses');
  const act = useAction();
  const [s, setS] = useState<any>(null);
  const [device, setDevice] = useState<'desk' | 'mobile'>('desk');
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => { if (data) setS({ ...data, sections: data.sections || ALL }); }, [data]);
  if (!s) return null;
  const set = (k: string, v: unknown) => setS({ ...s, [k]: v });
  const move = (i: number, d: number) => { const arr = [...s.sections]; const [x] = arr.splice(i, 1); arr.splice(i + d, 0, x); set('sections', arr); };
  const save = async () => {
    const { id, companyId, updatedAt, stats, ...body } = s;
    const r = await act('PUT', '/api/store', body, 'Loja publicada');
    if (r && frame.current) frame.current.src = `/loja/${s.slug}?t=${Date.now()}`;
  };
  return (
    <div>
      <PageHeader title="Loja virtual" description="Editor visual da loja nativa — catálogo, estoque, preços e pedidos 100% integrados ao ERP" actions={<><Button variant="outline" asChild><a href={`/loja/${s.slug}`} target="_blank"><ExternalLink /> Abrir loja</a></Button><Button onClick={save}><Save /> Salvar e publicar</Button></>} />
      <div className="mb-3 grid grid-cols-3 gap-3"><StatCard label="Pedidos da loja" value={data.stats.orders} /><StatCard label="Faturamento da loja" value={money(data.stats.revenue)} tone="green" /><StatCard label="Endereço" value={<span className="text-sm">/loja/{s.slug}</span>} /></div>
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <div className="space-y-3">
          <Card><CardHeader><CardTitle>Identidade</CardTitle><div className="flex items-center gap-2 text-xs">Publicada <Switch checked={s.published} onChange={(v) => set('published', v)} /></div></CardHeader><CardContent className="grid grid-cols-2 gap-3">
            <Field label="Nome da loja"><Input value={s.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Endereço (slug)"><Input value={s.slug} onChange={(e) => set('slug', e.target.value)} /></Field>
            <Field label="Logotipo (texto)" className="col-span-2"><Input value={s.logoText || ''} onChange={(e) => set('logoText', e.target.value)} /></Field>
            <Field label="Cor principal"><div className="flex gap-2"><input type="color" value={s.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} className="h-9 w-12 rounded border" /><Input value={s.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} /></div></Field>
            <Field label="Cor de destaque"><div className="flex gap-2"><input type="color" value={s.accentColor} onChange={(e) => set('accentColor', e.target.value)} className="h-9 w-12 rounded border" /><Input value={s.accentColor} onChange={(e) => set('accentColor', e.target.value)} /></div></Field>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Banner e conteúdo</CardTitle></CardHeader><CardContent className="space-y-3">
            <Field label="Título do banner"><Input value={s.bannerTitle} onChange={(e) => set('bannerTitle', e.target.value)} /></Field>
            <Field label="Subtítulo"><Input value={s.bannerSubtitle} onChange={(e) => set('bannerSubtitle', e.target.value)} /></Field>
            <Field label="Imagem do banner (URL)"><Input value={s.bannerImage || ''} onChange={(e) => set('bannerImage', e.target.value)} placeholder="opcional" /></Field>
            <Field label="Sobre a loja"><Textarea value={s.aboutText || ''} onChange={(e) => set('aboutText', e.target.value)} /></Field>
            <Field label="WhatsApp"><Input value={s.whatsapp || ''} onChange={(e) => set('whatsapp', e.target.value)} /></Field>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Seções da página inicial</CardTitle></CardHeader><CardContent className="space-y-1">
            {[...s.sections, ...ALL.filter((k) => !s.sections.includes(k))].map((k: string) => {
              const i = s.sections.indexOf(k); const on = i >= 0;
              return <div key={k} className={cn('flex items-center gap-2 rounded border px-3 py-2 text-sm', !on && 'opacity-50')}><span className="flex-1">{SECTION_LABEL[k]}</span>{on && <><Button size="icon" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button><Button size="icon" variant="ghost" disabled={i === s.sections.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button></>}<Button size="icon" variant="ghost" onClick={() => set('sections', on ? s.sections.filter((x: string) => x !== k) : [...s.sections, k])}>{on ? <Eye /> : <EyeOff />}</Button></div>;
            })}
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Comercial</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3">
            <Field label="Lista de preço da loja"><Select value={s.priceListId || ''} onChange={(e) => set('priceListId', e.target.value)}><option value="">Preço padrão</option>{lists?.rows.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
            <Field label="Depósito"><Select value={s.warehouseId || ''} onChange={(e) => set('warehouseId', e.target.value)}><option value="">Padrão</option>{whs?.rows.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
            <Field label="Frete grátis acima de (R$)"><Input type="number" value={s.freeShippingAbove} onChange={(e) => set('freeShippingAbove', e.target.value)} /></Field>
            <Field label="Desconto no Pix (%)"><Input type="number" value={s.pixDiscount} onChange={(e) => set('pixDiscount', e.target.value)} /></Field>
          </CardContent></Card>
        </div>
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2 text-xs"><span>Pré-visualização (salve para atualizar)</span><div className="flex gap-1"><Button size="icon" variant={device === 'desk' ? 'secondary' : 'ghost'} onClick={() => setDevice('desk')}><Monitor /></Button><Button size="icon" variant={device === 'mobile' ? 'secondary' : 'ghost'} onClick={() => setDevice('mobile')}><Smartphone /></Button></div></div>
          <div className="flex justify-center bg-muted/30 p-3"><iframe ref={frame} src={`/loja/${data.slug}`} className={cn('h-[820px] rounded border bg-white shadow', device === 'desk' ? 'w-full' : 'w-[390px]')} /></div>
        </Card>
      </div>
    </div>
  );
}
