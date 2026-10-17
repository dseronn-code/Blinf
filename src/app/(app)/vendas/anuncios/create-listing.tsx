'use client';
import { useEffect, useState } from 'react';
import { Loader2, Plus, Sparkles } from 'lucide-react';
import { useAction } from '@/lib/api';
import { Field } from '@/components/common/page';
import { EntityPicker } from '@/components/common/picker';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { money } from '@/lib/utils';

type Ch = { id: string; name: string; provider: string; real?: boolean };

/**
 * "Criar anúncio" (como no Bling): produto do ERP → anúncio no canal.
 * Mercado Livre: tipo Clássico/Premium e categoria sugerida pelo título; Shopee: categoria obrigatória.
 */
export function CreateListingButton({ channels, defaultChannelId, size }: { channels: Ch[]; defaultChannelId?: string; size?: 'sm' | 'default' }) {
  const [open, setOpen] = useState(false);
  if (!channels.length) return null;
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}><Plus /> Criar anúncio</Button>
      {open && <CreateListingDialog channels={channels} defaultChannelId={defaultChannelId} onClose={() => setOpen(false)} />}
    </>
  );
}

function CreateListingDialog({ channels, defaultChannelId, onClose }: { channels: Ch[]; defaultChannelId?: string; onClose: () => void }) {
  const act = useAction();
  const [f, setF] = useState<any>({ channelId: defaultChannelId || channels[0]?.id || '', productId: null, productLabel: null, title: '', listingType: 'gold_special', categoryId: '', price: '', quantity: '' });
  const [product, setProduct] = useState<any>(null);
  const [cats, setCats] = useState<{ id: string; name: string; path?: string | null }[] | null>(null);
  const [loadingCats, setLoadingCats] = useState(false);
  const [saving, setSaving] = useState(false);
  const ch = channels.find((c) => c.id === f.channelId);
  const isMl = ch?.provider === 'MERCADO_LIVRE';
  const isShopee = ch?.provider === 'SHOPEE';
  const canSuggest = !!ch?.real && (isMl || isShopee);
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));

  const suggest = async (title = f.title) => {
    if (!title || !canSuggest) return;
    setLoadingCats(true);
    const r = await act<{ rows: any[] }>('POST', `/api/integrations/${f.channelId}/categories`, { title }, false);
    setLoadingCats(false);
    setCats(r?.rows || []);
    if (r?.rows?.[0] && !f.categoryId) set('categoryId', r.rows[0].id);
  };
  // Categoria sugerida automaticamente ao escolher o produto (ML/Shopee)
  useEffect(() => { setCats(null); if (f.title) suggest(f.title); }, [f.channelId, f.productId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setSaving(true);
    const r = await act<any>('POST', `/api/integrations/${f.channelId}/create-listing`, {
      productId: f.productId, title: f.title || undefined, listingType: isMl ? f.listingType : undefined, categoryId: f.categoryId || undefined, price: f.price, quantity: f.quantity,
    }, ch?.real ? 'Anúncio criado no canal' : 'Anúncio criado (simulado)');
    setSaving(false);
    if (r) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Criar anúncio" description="Publica o produto do ERP no canal escolhido; produtos com variações viram um anúncio com variações (SKU de cada uma)." size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={!f.productId || !f.channelId || saving || (isShopee && ch?.real && !f.categoryId)} onClick={submit}>{saving ? <Loader2 className="animate-spin" /> : <Plus />} Criar anúncio</Button></>}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Canal">
          <Select value={f.channelId} onChange={(e) => { set('channelId', e.target.value); set('categoryId', ''); }}>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}{c.real ? '' : ' (simulado)'}</option>)}
          </Select>
        </Field>
        <Field label="Produto">
          <EntityPicker endpoint="/api/products?active=true" value={f.productId} label={f.productLabel} placeholder="Busque por nome ou SKU"
            map={(r: any) => ({ id: r.id, label: `${r.sku} — ${r.name}`, sub: `${r.kind === 'VARIACAO_PAI' ? `${r._count?.variations || 0} variação(ões)` : r.kind} · ${money(r.price)} · disponível ${r.stock?.available ?? 0}${r.images?.length || r.imageUrl ? '' : ' · sem imagem'}`, raw: r })}
            onChange={(id, raw) => { setProduct(raw || null); setF((x: any) => ({ ...x, productId: id, productLabel: raw ? `${raw.sku} — ${raw.name}` : null, title: raw?.name?.slice(0, isMl ? 60 : 120) || '', categoryId: '' })); }} />
        </Field>
        <Field label="Título do anúncio" className="md:col-span-2" hint={isMl ? `${(f.title || '').length}/60 caracteres` : undefined}>
          <Input value={f.title} maxLength={isMl ? 60 : 120} onChange={(e) => set('title', e.target.value)} onBlur={() => canSuggest && !f.categoryId && suggest()} />
        </Field>
        {isMl && (
          <Field label="Tipo de anúncio">
            <Select value={f.listingType} onChange={(e) => set('listingType', e.target.value)}>
              <option value="gold_special">Clássico (gold_special)</option>
              <option value="gold_pro">Premium (gold_pro) — parcelamento sem juros</option>
            </Select>
          </Field>
        )}
        {(isMl || isShopee) && ch?.real && (
          <Field label={isShopee ? 'Categoria Shopee (obrigatória)' : 'Categoria Mercado Livre'} hint={isMl ? 'Em branco = categoria prevista pelo título' : 'ID numérico da categoria'}>
            <div className="flex gap-1">
              <Input value={f.categoryId} placeholder={isMl ? 'MLB1234' : '100017'} onChange={(e) => set('categoryId', e.target.value)} />
              <Button type="button" variant="outline" disabled={!f.title || loadingCats} onClick={() => suggest()}>{loadingCats ? <Loader2 className="animate-spin" /> : <Sparkles />} Sugerir</Button>
            </div>
          </Field>
        )}
        {cats && (isMl || isShopee) && (
          <div className="md:col-span-2">
            {cats.length ? <div className="flex flex-wrap gap-1">{cats.map((c) => (
              <button key={c.id} type="button" onClick={() => set('categoryId', c.id)} className={`rounded border px-2 py-1 text-left text-xs ${f.categoryId === c.id ? 'border-primary bg-primary/10' : 'hover:bg-muted'}`}>
                <div className="font-medium">{c.name}</div><div className="font-mono text-[10px] text-muted-foreground">{c.id}{c.path ? ` · ${c.path}` : ''}</div>
              </button>
            ))}</div> : <p className="text-xs text-muted-foreground">Nenhuma categoria sugerida para este título.</p>}
          </div>
        )}
        <Field label="Preço inicial (R$)" hint={product ? `Em branco = preço da lista do canal (produto: ${money(product.price)})` : 'Em branco = preço da lista do canal'}>
          <Input type="number" step="0.01" min="0" value={f.price} onChange={(e) => set('price', e.target.value)} />
        </Field>
        <Field label="Quantidade inicial" hint="Em branco = estoque disponível (por variação)">
          <Input type="number" step="1" min="0" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} />
        </Field>
      </div>
      {ch?.real && <p className="mt-3 text-xs text-muted-foreground">Usa marca, GTIN, SKU, peso/dimensões, descrição e imagens do cadastro do produto. Erros de validação do canal são exibidos com a mensagem do próprio canal.</p>}
    </Dialog>
  );
}
