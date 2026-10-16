'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus, Save, Trash2, Wand2, Tag, Upload, Star, Loader2, ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, useAction, openFile, api } from '@/lib/api';
import { PageHeader, Field, DataTable } from '@/components/common/page';
import { EntityPicker, productOption, contactOption } from '@/components/common/picker';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { money, num, fmtDate, fmtDateTime, round2 } from '@/lib/utils';
import { KIND_LABEL } from '@/lib/labels';

const blank = { kind: 'SIMPLES', unit: 'UN', origin: 0, price: 0, costPrice: 0, ipiRate: 0, weight: 0.3, width: 15, height: 10, length: 20, controlsStock: true, controlsLot: false, minStock: 0, maxStock: 0, active: true, featured: false, components: [] };

export default function ProductForm() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'novo';
  const router = useRouter();
  const act = useAction();
  const { data } = useApi<any>(isNew ? null : `/api/products/${id}`);
  const { data: cats } = useApi<any>('/api/r/categories?pageSize=200');
  const { data: whs } = useApi<any>('/api/r/warehouses');
  const [p, setP] = useState<any>(blank);
  const [attrs, setAttrs] = useState<{ name: string; values: string }[]>([{ name: 'Cor', values: '' }, { name: 'Tamanho', values: '' }]);
  const [initial, setInitial] = useState({ quantity: '', warehouseId: '' });
  useEffect(() => {
    if (!data) return;
    setP({ ...data, components: data.components.map((c: any) => ({ componentId: c.componentId, quantity: c.quantity, label: `${c.component.sku} — ${c.component.name}`, cost: c.component.costPrice })) });
    if (data.kind === 'VARIACAO_PAI' && data.attributes) setAttrs(Object.entries(data.attributes as Record<string, string[]>).map(([name, v]) => ({ name, values: v.join(', ') })));
  }, [data]);
  const set = (k: string, v: unknown) => setP((x: any) => ({ ...x, [k]: v }));
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const images: string[] = Array.isArray(p.images) ? p.images : [];
  const uploadImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const added: string[] = [];
    for (const f of Array.from(files)) {
      if (!/^image\/(png|jpe?g|webp|gif)$/.test(f.type)) { toast.error(`${f.name}: use PNG, JPG, WEBP ou GIF`); continue; }
      if (f.size > 4 * 1024 * 1024) { toast.error(`${f.name}: arquivo maior que 4 MB`); continue; }
      const fd = new FormData();
      fd.append('file', f);
      try {
        const r = await api<{ id: string; url: string }>('/api/files', { method: 'POST', body: fd });
        added.push(r.url);
      } catch (e) { toast.error(`${f.name}: ${(e as Error).message}`); }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    if (added.length) {
      setP((x: any) => { const imgs = [...(Array.isArray(x.images) ? x.images : []), ...added]; return { ...x, images: imgs, imageUrl: x.imageUrl || imgs[0] }; });
      toast.success(`${added.length} imagem(ns) enviada(s) — clique em Salvar para gravar no produto`);
    }
  };
  const removeImage = (url: string) => setP((x: any) => { const imgs = (x.images || []).filter((u: string) => u !== url); return { ...x, images: imgs, imageUrl: x.imageUrl === url ? imgs[0] || null : x.imageUrl }; });
  const markup = p.costPrice ? round2(((p.price - p.costPrice) / p.costPrice) * 100) : 0;
  const margin = p.price ? round2(((p.price - p.costPrice) / p.price) * 100) : 0;
  const hasComposition = p.kind === 'KIT' || p.kind === 'FABRICADO';

  const save = async () => {
    const { id: _i, organizationId, createdAt, updatedAt, category, parent, variations, balances, lots, priceItems, listings, movements, stock, _count, ...body } = p;
    body.components = hasComposition ? p.components.map((c: any) => ({ componentId: c.componentId, quantity: c.quantity })) : undefined;
    if (isNew && Number(initial.quantity) > 0) body.initialStock = initial;
    const r = isNew ? await act('POST', '/api/products', body, 'Produto cadastrado') : await act('PUT', `/api/products/${id}`, body, 'Produto salvo');
    if (r && isNew) router.replace(`/cadastros/produtos/${(r as any).id}`);
  };
  const genVariations = async () => {
    const attributes = Object.fromEntries(attrs.filter((a) => a.name && a.values).map((a) => [a.name, a.values.split(',').map((s) => s.trim()).filter(Boolean)]));
    const r = await act('PUT', `/api/products/${id}`, { action: 'generate-variations', attributes }, false);
    if (r) (await import('sonner')).toast.success(`${(r as any).created} variação(ões) criada(s)`);
  };

  return (
    <div>
      <PageHeader title={isNew ? 'Novo produto' : p.name} badge={!isNew && <Badge tone={KIND_LABEL[p.kind]?.[1]}>{KIND_LABEL[p.kind]?.[0]}</Badge>} description={!isNew && data?.parent ? <>Variação de <Link className="text-primary" href={`/cadastros/produtos/${data.parent.id}`}>{data.parent.name}</Link></> : p.sku}
        actions={<><Button variant="outline" onClick={() => router.push('/cadastros/produtos')}><ArrowLeft /> Voltar</Button>{!isNew && <Button variant="outline" onClick={() => openFile(`/api/stock/labels?type=product&items=${id}:3`)}><Tag /> Etiquetas</Button>}{!isNew && <Button variant="outline" onClick={async () => { if (confirm('Excluir produto? (com histórico será inativado)')) { const r = await act('DELETE', `/api/products/${id}`); if (r) router.push('/cadastros/produtos'); } }}><Trash2 /></Button>}<Button onClick={save}><Save /> Salvar</Button></>} />
      {!isNew && data?.stock && (
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
          {[['Estoque físico', num(data.stock.quantity)], ['Reservado', num(data.stock.reserved)], ['Disponível', num(data.stock.available)], ['Preço', money(p.price)], ['Margem', `${num(margin)}%`]].map(([l, v]) => <Card key={l as string} className="p-3"><div className="text-xs text-muted-foreground">{l}</div><div className="text-lg font-bold">{v}</div></Card>)}
        </div>
      )}
      <Tabs defaultValue="dados">
        <TabsList>
          <TabsTrigger value="dados">Dados básicos</TabsTrigger>
          <TabsTrigger value="precos">Preços e custos</TabsTrigger>
          <TabsTrigger value="estoque">Estoque</TabsTrigger>
          <TabsTrigger value="fiscal">Tributação</TabsTrigger>
          {(p.kind === 'VARIACAO_PAI' || p.kind === 'SIMPLES') && !isNew && <TabsTrigger value="variacoes">Variações</TabsTrigger>}
          {hasComposition && <TabsTrigger value="composicao">{p.kind === 'KIT' ? 'Composição do kit' : 'Ficha técnica'}</TabsTrigger>}
          {!isNew && <TabsTrigger value="canais">Canais de venda</TabsTrigger>}
        </TabsList>
        <TabsContent value="dados">
          <Card><CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Código (SKU) *"><Input value={p.sku || ''} onChange={(e) => set('sku', e.target.value)} /></Field>
            <Field label="Descrição *" className="md:col-span-3"><Input value={p.name || ''} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Tipo"><Select value={p.kind} onChange={(e) => set('kind', e.target.value)} disabled={p.kind === 'VARIACAO'}>{Object.entries(KIND_LABEL).map(([k, [l]]) => <option key={k} value={k} disabled={k === 'VARIACAO'}>{l}</option>)}</Select></Field>
            <Field label="GTIN/EAN"><div className="flex gap-1"><Input value={p.gtin || ''} onChange={(e) => set('gtin', e.target.value)} /><Button variant="outline" size="sm" className="h-9" onClick={() => set('gtin', 'GERAR')}>Gerar</Button></div></Field>
            <Field label="Unidade"><Select value={p.unit} onChange={(e) => set('unit', e.target.value)}>{['UN', 'PC', 'CX', 'KG', 'G', 'L', 'ML', 'M', 'M2', 'PAR', 'KIT'].map((u) => <option key={u}>{u}</option>)}</Select></Field>
            <Field label="Marca"><Input value={p.brand || ''} onChange={(e) => set('brand', e.target.value)} /></Field>
            <Field label="Categoria" className="md:col-span-2"><Select value={p.categoryId || ''} onChange={(e) => set('categoryId', e.target.value)}><option value="">—</option>{cats?.rows.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Fornecedor padrão (reposição automática)" className="md:col-span-2"><EntityPicker endpoint="/api/r/contacts?type=FORNECEDOR" value={p.supplierId} label={p.supplierId ? 'Fornecedor selecionado' : null} onChange={(v) => set('supplierId', v)} map={contactOption} /></Field>
            <Field label="URL da imagem principal" className="md:col-span-2" hint="Preenchida pela galeria abaixo ou informe uma URL externa"><Input value={p.imageUrl || ''} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://…" /></Field>
            <Field label="Código de balança" hint="5 dígitos — o PDV lê etiquetas EAN-13 de balança iniciadas por 2 (2 + código + peso/preço)"><Input inputMode="numeric" maxLength={5} value={p.scaleCode || ''} onChange={(e) => set('scaleCode', e.target.value.replace(/\D/g, '').slice(0, 5) || null)} placeholder="00000" /></Field>
            <Field label="Opções" className="md:col-span-2"><div className="flex gap-4 pt-1.5"><Checkbox label="Ativo" checked={p.active} onChange={(e) => set('active', e.target.checked)} /><Checkbox label="Destaque na loja virtual" checked={p.featured} onChange={(e) => set('featured', e.target.checked)} /></div></Field>
            <Field label="Descrição comercial (loja virtual e anúncios)" className="md:col-span-4"><Textarea rows={4} value={p.description || ''} onChange={(e) => set('description', e.target.value)} /></Field>
          </CardContent></Card>
          <Card className="mt-3"><CardHeader><CardTitle>Galeria de imagens</CardTitle>
            <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">PNG, JPG, WEBP ou GIF · até 4 MB · máx. 10 imagens</span>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(e) => uploadImages(e.target.files)} />
              <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? <Loader2 className="animate-spin" /> : <Upload />} Enviar imagens</Button></div>
          </CardHeader><CardContent>
            {!images.length ? (
              <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center justify-center rounded-lg border-2 border-dashed py-8 text-sm text-muted-foreground hover:bg-muted/40"><ImageIcon className="mb-2 h-8 w-8 opacity-50" />Nenhuma imagem. Clique para enviar as fotos do produto (usadas na loja virtual e nos anúncios).</button>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {images.map((url) => {
                  const main = p.imageUrl === url;
                  return (
                    <div key={url} className={`group relative overflow-hidden rounded-lg border bg-white ${main ? 'ring-2 ring-primary' : ''}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="aspect-square w-full object-contain" />
                      {main && <Badge tone="blue" className="absolute left-1 top-1">Principal</Badge>}
                      <div className="flex justify-between gap-1 border-t bg-card p-1">
                        <Button size="sm" variant="ghost" className="h-7 px-1.5 text-[11px]" disabled={main} onClick={() => set('imageUrl', url)} title="Definir como principal"><Star className={main ? 'fill-amber-400 text-amber-500' : ''} /> {main ? 'Principal' : 'Definir como principal'}</Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeImage(url)} title="Remover"><Trash2 className="text-destructive" /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {images.length > 0 && <p className="mt-2 text-xs text-muted-foreground">As alterações na galeria são gravadas ao clicar em <b>Salvar</b>.</p>}
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="precos">
          <Card><CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Preço de venda (R$)"><Input type="number" step="0.01" value={p.price} onChange={(e) => set('price', e.target.value)} /></Field>
            <Field label="Preço de custo (R$)" hint={hasComposition ? 'Calculado pela composição ao salvar' : 'Atualizado pelo custo médio nas compras'}><Input type="number" step="0.01" value={p.costPrice} onChange={(e) => set('costPrice', e.target.value)} /></Field>
            <Field label="Markup"><div className="pt-2 font-semibold">{num(markup)}%</div></Field>
            <Field label="Margem bruta"><div className="pt-2 font-semibold">{num(margin)}%</div></Field>
            {!isNew && (
              <div className="md:col-span-4">
                <h4 className="mb-2 mt-2 text-sm font-semibold">Preços em listas</h4>
                <DataTable rows={data?.priceItems} empty="Sem preço fixo em listas (aplica-se o ajuste % de cada lista)" columns={[{ key: 'l', header: 'Lista', cell: (r: any) => r.priceList.name }, { key: 'price', header: 'Preço', align: 'right', cell: (r: any) => money(r.price) }]} />
                <p className="mt-1 text-xs text-muted-foreground">Gerencie em <Link href="/cadastros/listas-preco" className="text-primary">Listas de preço</Link>.</p>
              </div>
            )}
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="estoque" className="space-y-3">
          <Card><CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Controle"><div className="flex flex-col gap-1 pt-1"><Checkbox label="Controla estoque" checked={p.controlsStock} onChange={(e) => set('controlsStock', e.target.checked)} /><Checkbox label="Controla lote e validade" checked={p.controlsLot} onChange={(e) => set('controlsLot', e.target.checked)} /></div></Field>
            <Field label="Estoque mínimo"><Input type="number" value={p.minStock} onChange={(e) => set('minStock', e.target.value)} /></Field>
            <Field label="Estoque máximo"><Input type="number" value={p.maxStock} onChange={(e) => set('maxStock', e.target.value)} /></Field>
            <Field label="Localização (corredor/prateleira)"><Input value={p.location || ''} onChange={(e) => set('location', e.target.value)} placeholder="A-01-03" /></Field>
            <Field label="Peso (kg)"><Input type="number" step="0.001" value={p.weight} onChange={(e) => set('weight', e.target.value)} /></Field>
            <Field label="Largura (cm)"><Input type="number" value={p.width} onChange={(e) => set('width', e.target.value)} /></Field>
            <Field label="Altura (cm)"><Input type="number" value={p.height} onChange={(e) => set('height', e.target.value)} /></Field>
            <Field label="Comprimento (cm)"><Input type="number" value={p.length} onChange={(e) => set('length', e.target.value)} /></Field>
            {isNew && <>
              <Field label="Estoque inicial"><Input type="number" value={initial.quantity} onChange={(e) => setInitial({ ...initial, quantity: e.target.value })} /></Field>
              <Field label="Depósito"><Select value={initial.warehouseId} onChange={(e) => setInitial({ ...initial, warehouseId: e.target.value })}><option value="">Padrão</option>{whs?.rows.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
            </>}
          </CardContent></Card>
          {!isNew && <>
            <div className="grid gap-3 md:grid-cols-2">
              <DataTable rows={data?.balances} empty="Sem saldo" columns={[{ key: 'w', header: 'Depósito', cell: (r: any) => r.warehouse.name }, { key: 'quantity', header: 'Físico', align: 'right', cell: (r: any) => num(r.quantity) }, { key: 'reserved', header: 'Reservado', align: 'right', cell: (r: any) => num(r.reserved) }, { key: 'avgCost', header: 'Custo médio', align: 'right', cell: (r: any) => money(r.avgCost) }]} />
              {p.controlsLot && <DataTable rows={data?.lots} empty="Sem lotes" columns={[{ key: 'lotNumber', header: 'Lote' }, { key: 'expiresAt', header: 'Validade', cell: (r: any) => fmtDate(r.expiresAt) }, { key: 'quantity', header: 'Saldo', align: 'right', cell: (r: any) => num(r.quantity) }]} />}
            </div>
            <Card><CardHeader><CardTitle>Últimas movimentações</CardTitle><Link href={`/estoque/movimentacoes?productId=${id}`} className="text-xs text-primary">Ver todas</Link></CardHeader>
              <DataTable rows={data?.movements} columns={[{ key: 'createdAt', header: 'Data', cell: (r: any) => fmtDateTime(r.createdAt) }, { key: 'type', header: 'Tipo' }, { key: 'origin', header: 'Origem', cell: (r: any) => r.originLabel || r.origin }, { key: 'lotNumber', header: 'Lote' }, { key: 'quantity', header: 'Qtd', align: 'right', cell: (r: any) => <span className={r.quantity < 0 ? 'text-red-600' : 'text-green-700'}>{num(r.quantity)}</span> }, { key: 'balanceAfter', header: 'Saldo', align: 'right', cell: (r: any) => num(r.balanceAfter) }]} />
            </Card>
          </>}
        </TabsContent>
        <TabsContent value="fiscal">
          <Card><CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="NCM" hint="8 dígitos — obrigatório para NF-e"><Input value={p.ncm || ''} onChange={(e) => set('ncm', e.target.value)} /></Field>
            <Field label="CEST"><Input value={p.cest || ''} onChange={(e) => set('cest', e.target.value)} /></Field>
            <Field label="Origem da mercadoria"><Select value={p.origin} onChange={(e) => set('origin', Number(e.target.value))}><option value={0}>0 - Nacional</option><option value={1}>1 - Estrangeira (importação direta)</option><option value={2}>2 - Estrangeira (mercado interno)</option></Select></Field>
            <Field label="Alíquota IPI (%)"><Input type="number" step="0.01" value={p.ipiRate} onChange={(e) => set('ipiRate', e.target.value)} /></Field>
            <Field label="MVA ICMS-ST (%)" hint="Margem de valor agregado para cálculo da substituição tributária (0 = sem ST)"><Input type="number" step="0.01" value={p.mvaST ?? 0} onChange={(e) => set('mvaST', e.target.value)} /></Field>
            <p className="text-xs text-muted-foreground md:col-span-4">ICMS, PIS e COFINS são calculados automaticamente pela natureza de operação e pelo regime tributário da empresa (Simples Nacional / Lucro Presumido / Real).</p>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="variacoes" className="space-y-3">
          <Card><CardHeader><CardTitle>Grade de atributos</CardTitle></CardHeader><CardContent className="space-y-2">
            {attrs.map((a, i) => (
              <div key={i} className="flex gap-2"><Input className="w-40" placeholder="Atributo (ex.: Cor)" value={a.name} onChange={(e) => setAttrs(attrs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /><Input placeholder="Valores separados por vírgula (ex.: Azul, Preto, Branco)" value={a.values} onChange={(e) => setAttrs(attrs.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} /></div>
            ))}
            <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setAttrs([...attrs, { name: '', values: '' }])}><Plus /> Atributo</Button><Button size="sm" onClick={genVariations}><Wand2 /> Gerar variações</Button></div>
            <p className="text-xs text-muted-foreground">As variações herdam preço, custo, NCM e dimensões do produto pai. Cada variação tem seu próprio estoque e SKU.</p>
          </CardContent></Card>
          <DataTable rows={data?.variations} empty="Nenhuma variação" onRowClick={(r: any) => router.push(`/cadastros/produtos/${r.id}`)} columns={[{ key: 'sku', header: 'SKU' }, { key: 'name', header: 'Descrição' }, { key: 'attributes', header: 'Atributos', cell: (r: any) => Object.entries(r.attributes || {}).map(([k, v]) => `${k}: ${v}`).join(' · ') }, { key: 'price', header: 'Preço', align: 'right', cell: (r: any) => money(r.price) }, { key: 'av', header: 'Disponível', align: 'right', cell: (r: any) => num(r.stock?.available) }]} />
        </TabsContent>
        <TabsContent value="composicao">
          <Card><CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">{p.kind === 'KIT' ? 'Ao vender o kit, o estoque é baixado dos componentes. A disponibilidade do kit é calculada pelos componentes.' : 'Ficha técnica usada nas ordens de produção: as matérias-primas são consumidas e o produto acabado entra no estoque.'}</p>
            {p.components.map((c: any, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1"><EntityPicker endpoint="/api/products?sellable=1" value={c.componentId} label={c.label} map={productOption} onChange={(v, raw) => set('components', p.components.map((x: any, j: number) => (j === i ? { ...x, componentId: v, label: raw ? `${raw.sku} — ${raw.name}` : '', cost: raw?.costPrice } : x)))} /></div>
                <Input type="number" step="any" className="w-28" value={c.quantity} onChange={(e) => set('components', p.components.map((x: any, j: number) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                <span className="w-28 text-right text-sm tabular-nums">{money((c.cost || 0) * (Number(c.quantity) || 0))}</span>
                <Button variant="ghost" size="icon" onClick={() => set('components', p.components.filter((_: any, j: number) => j !== i))}><Trash2 className="text-destructive" /></Button>
              </div>
            ))}
            <div className="flex items-center justify-between"><Button variant="outline" size="sm" onClick={() => set('components', [...p.components, { componentId: null, quantity: 1 }])}><Plus /> Componente</Button><span className="text-sm">Custo total: <b>{money(p.components.reduce((a: number, c: any) => a + (c.cost || 0) * (Number(c.quantity) || 0), 0))}</b></span></div>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="canais">
          <DataTable rows={data?.listings} empty="Produto não anunciado. Publique em Integrações." columns={[{ key: 'c', header: 'Canal', cell: (r: any) => r.channel.name }, { key: 'externalId', header: 'ID do anúncio' }, { key: 'title', header: 'Título' }, { key: 'price', header: 'Preço', align: 'right', cell: (r: any) => money(r.price) }, { key: 'stock', header: 'Estoque', align: 'right', cell: (r: any) => num(r.stock) }, { key: 'status', header: 'Situação', cell: (r: any) => <StatusBadge status={r.status} /> }, { key: 'lastSyncAt', header: 'Sincronizado', cell: (r: any) => fmtDateTime(r.lastSyncAt) }]} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
