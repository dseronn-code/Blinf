'use client';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Save, ArrowUp, ArrowDown, Eye, EyeOff, Monitor, Smartphone, Globe, Search as SearchIcon } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, Field, StatCard } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea, Switch, Checkbox } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ResourceCrud } from '@/components/common/crud';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { money, cn, fmtDate } from '@/lib/utils';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const COUPON_TYPE: Record<string, string> = { PERCENTUAL: 'Percentual (%)', VALOR: 'Valor (R$)', FRETE_GRATIS: 'Frete grátis' };

function Counter({ value, max }: { value: string; max: number }) {
  const n = (value || '').length;
  return <span className={cn('tabular-nums', n > max ? 'text-destructive' : 'text-muted-foreground')}>{n}/{max}</span>;
}

function Coupons() {
  return (
    <ResourceCrud
      resource="coupons"
      module="loja"
      title="Cupons de desconto"
      description="Cupons aplicados no checkout da loja virtual — percentual, valor fixo ou frete grátis"
      defaults={{ type: 'PERCENTUAL', value: 10, minAmount: 0, maxUses: 0, active: true }}
      transform={(d) => ({ ...d, code: String(d.code || '').trim().toUpperCase(), value: Number(d.value) || 0, minAmount: Number(d.minAmount) || 0, maxUses: Math.max(0, Math.floor(Number(d.maxUses) || 0)), validUntil: d.validUntil || null, active: !!d.active })}
      columns={[
        { key: 'code', header: 'Código', render: (r) => <span className="font-mono font-semibold">{r.code}</span> },
        { key: 'type', header: 'Tipo', render: (r) => COUPON_TYPE[r.type] || r.type },
        { key: 'value', header: 'Valor', align: 'right', render: (r) => r.type === 'PERCENTUAL' ? `${Number(r.value) || 0}%` : r.type === 'FRETE_GRATIS' ? '—' : money(r.value) },
        { key: 'uses', header: 'Usos', align: 'center', render: (r) => `${r.uses ?? 0}/${Number(r.maxUses) ? r.maxUses : '∞'}` },
        { key: 'validUntil', header: 'Válido até', render: (r) => r.validUntil ? fmtDate(r.validUntil) : 'Sem validade' },
        { key: 'active', header: 'Situação', render: (r) => <Badge tone={r.active ? 'green' : 'gray'}>{r.active ? 'Ativo' : 'Inativo'}</Badge> },
      ]}
      fields={[
        { key: 'code', label: 'Código', required: true, placeholder: 'BEMVINDO10' },
        { key: 'type', label: 'Tipo', type: 'select', required: true, options: Object.entries(COUPON_TYPE).map(([value, label]) => ({ value, label })) },
        { key: 'value', label: 'Valor', type: 'number', hint: '% para percentual, R$ para valor fixo (ignorado no frete grátis)' },
        { key: 'minAmount', label: 'Pedido mínimo (R$)', type: 'money' },
        { key: 'maxUses', label: 'Limite de usos', type: 'number', hint: '0 = ilimitado' },
        { key: 'validUntil', label: 'Válido até', type: 'date' },
        { key: 'active', label: 'Ativo', type: 'checkbox', hint: 'Cupom ativo' },
      ]}
    />
  );
}

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
  const [host, setHost] = useState('');
  useEffect(() => { if (data) setS({ ...data, sections: data.sections || ALL, freeShippingUfs: data.freeShippingUfs || [] }); }, [data]);
  useEffect(() => { setHost(window.location.host); }, []);
  if (!s) return null;
  const ufs: string[] = Array.isArray(s.freeShippingUfs) ? s.freeShippingUfs : [];
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
      <Tabs defaultValue="editor">
      <TabsList><TabsTrigger value="editor">Editor da loja</TabsTrigger><TabsTrigger value="cupons">Cupons de desconto</TabsTrigger></TabsList>
      <TabsContent value="cupons"><Coupons /></TabsContent>
      <TabsContent value="editor">
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
            <Field label="Frete grátis por estado (UF)" className="col-span-2" hint={ufs.length ? `Frete grátis para ${ufs.join(', ')} (qualquer valor de pedido)` : 'Nenhum estado selecionado'}>
              <div className="mb-1.5 flex gap-2 text-[11px]"><button type="button" className="text-primary hover:underline" onClick={() => set('freeShippingUfs', [...UFS])}>Marcar todos</button><button type="button" className="text-primary hover:underline" onClick={() => set('freeShippingUfs', [])}>Limpar</button></div>
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
                {UFS.map((u) => <Checkbox key={u} label={u} className="text-xs" checked={ufs.includes(u)} onChange={(e) => set('freeShippingUfs', e.target.checked ? [...ufs, u] : ufs.filter((x: string) => x !== u))} />)}
              </div>
            </Field>
            <p className="col-span-2 text-xs text-muted-foreground"><b>Entrega e pagamento:</b> com Melhor Envio/Correios conectados (Integrações → Contas e credenciais) o checkout mostra as cotações reais; sem eles, oferece entrega com frete fixo (variável de ambiente <code>STORE_FIXED_FREIGHT</code>) ou &quot;frete a combinar&quot;, além de retirada no local. Cartão e boleto exigem Asaas ou Mercado Pago conectados; sem provedor, só Pix pela chave cadastrada na conta bancária (baixa manual em Financeiro).</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><Globe className="h-4 w-4" /> Domínio próprio</CardTitle></CardHeader><CardContent className="space-y-2">
            <Field label="Domínio" hint="Sem http:// — ex.: www.minhaloja.com.br"><Input value={s.customDomain || ''} onChange={(e) => set('customDomain', e.target.value)} placeholder="www.minhaloja.com.br" /></Field>
            <div className="rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
              Aponte um registro <b>CNAME</b> do seu domínio para este servidor{host ? <> (<span className="font-mono">{host}</span>)</> : null}; o GestãoPro identifica o domínio e abre sua loja automaticamente.
              {s.customDomain && <div className="mt-1.5 font-mono text-[11px]">{s.customDomain} &nbsp;CNAME&nbsp; {host || 'este-servidor'}</div>}
            </div>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><SearchIcon className="h-4 w-4" /> SEO (Google)</CardTitle></CardHeader><CardContent className="space-y-3">
            <Field label={<span className="flex justify-between">Título da página <Counter value={s.seoTitle || ''} max={60} /></span>}><Input value={s.seoTitle || ''} onChange={(e) => set('seoTitle', e.target.value)} placeholder={s.name} /></Field>
            <Field label={<span className="flex justify-between">Meta descrição <Counter value={s.seoDescription || ''} max={160} /></span>}><Textarea value={s.seoDescription || ''} onChange={(e) => set('seoDescription', e.target.value)} placeholder={s.aboutText || 'Descreva sua loja em até 160 caracteres'} /></Field>
            <div className="rounded-md border bg-white p-3 font-sans">
              <div className="text-[11px] text-muted-foreground">Prévia no Google</div>
              <div className="mt-1 truncate text-xs text-[#202124]">{s.customDomain ? `https://${s.customDomain}` : `${host ? `https://${host}` : ''}/loja/${s.slug}`}</div>
              <div className="truncate text-lg leading-snug text-[#1a0dab]">{(s.seoTitle || s.name || '').slice(0, 60)}{(s.seoTitle || '').length > 60 ? '…' : ''}</div>
              <div className="line-clamp-2 text-xs text-[#4d5156]">{(s.seoDescription || s.aboutText || s.bannerSubtitle || '').slice(0, 160)}{(s.seoDescription || '').length > 160 ? '…' : ''}</div>
            </div>
          </CardContent></Card>
        </div>
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2 text-xs"><span>Pré-visualização (salve para atualizar)</span><div className="flex gap-1"><Button size="icon" variant={device === 'desk' ? 'secondary' : 'ghost'} onClick={() => setDevice('desk')}><Monitor /></Button><Button size="icon" variant={device === 'mobile' ? 'secondary' : 'ghost'} onClick={() => setDevice('mobile')}><Smartphone /></Button></div></div>
          <div className="flex justify-center bg-muted/30 p-3"><iframe ref={frame} src={`/loja/${data.slug}`} className={cn('h-[820px] rounded border bg-white shadow', device === 'desk' ? 'w-full' : 'w-[390px]')} /></div>
        </Card>
      </div>
      </TabsContent>
      </Tabs>
    </div>
  );
}
