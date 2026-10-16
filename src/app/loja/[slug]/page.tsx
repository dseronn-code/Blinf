'use client';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ShoppingCart, X, Minus, Plus, Search, Truck, ShieldCheck, QrCode, CheckCircle2, MessageCircle, User, LogOut, Package, FileText, Tag, MapPin, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { money, cn, onlyDigits, fmtDate, fmtDateTime, fmtDoc } from '@/lib/utils';

type Product = { id: string; sku: string; name: string; description?: string; kind: string; imageUrl?: string | null; images?: string[]; price: number; compareAt: number | null; available: number; featured: boolean; category?: { id: string; name: string }; variations: { id: string; name: string; attributes: Record<string, string>; price: number; available: number }[]; attributes?: Record<string, string[]> };
const initials = (name: string) => name.split(' ').map((w) => w[0]).slice(0, 2).join('');
const productImages = (p: Product) => Array.from(new Set([p.imageUrl, ...(p.images || [])].filter((x): x is string => !!x)));

/** Imagem do produto com fallback para o placeholder de iniciais em degradê */
function ProductImage({ src, name, store, big }: { src?: string | null; name: string; store: any; big?: boolean }) {
  const [err, setErr] = useState(false);
  useEffect(() => setErr(false), [src]);
  if (src && !err) return <img src={src} alt={name} loading="lazy" onError={() => setErr(true)} className="aspect-square h-full w-full bg-white object-cover" />;
  return <div className={cn('flex aspect-square w-full items-center justify-center font-black text-white/90', big ? 'text-7xl' : 'text-5xl')} style={{ background: `linear-gradient(135deg, ${store.primaryColor}, ${store.accentColor})` }}>{initials(name)}</div>;
}

type CartLine = { productId: string; name: string; price: number; quantity: number; max: number };

/** Loja virtual pública (catálogo → carrinho → checkout) integrada ao ERP */
export default function Storefront() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<any>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Product | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [done, setDone] = useState<any>(null);
  const [area, setArea] = useState(false);
  useEffect(() => { api(`/api/public/store/${slug}`).then(setData).catch((e) => setData({ error: e.message })); }, [slug]);
  useEffect(() => { try { setCart(JSON.parse(localStorage.getItem(`cart_${slug}`) || '[]')); } catch {} }, [slug]);
  useEffect(() => { try { localStorage.setItem(`cart_${slug}`, JSON.stringify(cart)); } catch {} }, [cart, slug]);
  const products: Product[] = data?.products || [];
  const filtered = useMemo(() => products.filter((p) => (!cat || p.category?.id === cat) && (!q || p.name.toLowerCase().includes(q.toLowerCase()))), [products, q, cat]);
  if (!data) return <div className="p-10 text-center text-sm">Carregando loja…</div>;
  if (data.error) return <div className="p-10 text-center">{data.error}</div>;
  const st = data.store;
  if (!st.published) return <div className="p-10 text-center">Loja em manutenção.</div>;
  const add = (id: string, name: string, price: number, max: number) => {
    if (max <= 0) return toast.error('Produto esgotado');
    setCart((c) => { const ex = c.find((l) => l.productId === id); if (ex) return c.map((l) => (l.productId === id ? { ...l, quantity: Math.min(max, l.quantity + 1) } : l)); return [...c, { productId: id, name, price, quantity: 1, max }]; });
    toast.success('Adicionado ao carrinho');
    setOpen(true);
  };
  const subtotal = cart.reduce((a, l) => a + l.price * l.quantity, 0);
  const primary = st.primaryColor;
  const sections: string[] = st.sections || [];
  const Card = ({ p }: { p: Product }) => (
    <button onClick={() => setView(p)} className="group overflow-hidden rounded-xl border bg-white text-left shadow-sm transition hover:shadow-md">
      <div className="overflow-hidden"><ProductImage src={p.imageUrl || p.images?.[0]} name={p.name} store={st} /></div>
      <div className="p-3">
        <div className="line-clamp-2 min-h-[40px] text-sm font-medium">{p.name}</div>
        {p.compareAt && <div className="text-xs text-gray-400 line-through">{money(p.compareAt)}</div>}
        <div className="text-lg font-bold" style={{ color: primary }}>{money(p.price)}</div>
        <div className="text-[11px] text-gray-500">{money(p.price * (1 - st.pixDiscount / 100))} no Pix</div>
        {p.available <= 0 && <div className="mt-1 text-xs font-semibold text-red-600">Esgotado</div>}
      </div>
    </button>
  );
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-20 border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <button onClick={() => { setCheckout(false); setDone(null); setArea(false); }} className="text-xl font-black tracking-tight" style={{ color: primary }}>{st.logoText || st.name}</button>
          <div className="relative hidden flex-1 md:block"><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="O que você procura?" className="h-9 w-full rounded-full border bg-gray-50 pl-9 pr-3 text-sm outline-none" /></div>
          <button onClick={() => { setArea(true); setCheckout(false); setDone(null); }} className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-2 text-sm hover:bg-gray-100"><User className="h-5 w-5" /><span className="hidden sm:inline">Meus pedidos</span></button>
          <button onClick={() => setOpen(true)} className="relative rounded-full p-2 hover:bg-gray-100"><ShoppingCart className="h-6 w-6" />{cart.length > 0 && <span className="absolute -right-1 -top-1 rounded-full px-1.5 text-[11px] font-bold text-white" style={{ background: primary }}>{cart.reduce((a, l) => a + l.quantity, 0)}</span>}</button>
        </div>
        {st.freeShippingAbove > 0 && <div className="py-1 text-center text-xs text-white" style={{ background: st.accentColor }}><Truck className="mr-1 inline h-3 w-3" /> Frete grátis acima de {money(st.freeShippingAbove)} · {st.pixDiscount}% OFF no Pix</div>}
        {st.freeShippingUfs?.length > 0 && <div className="border-t border-white/20 py-1 text-center text-xs text-white" style={{ background: primary }}><Truck className="mr-1 inline h-3 w-3" /> Frete grátis para {st.freeShippingUfs.join(', ')}</div>}
      </header>

      {area && !done && !checkout ? (
        <CustomerArea slug={slug} store={st} onBack={() => setArea(false)} />
      ) : done ? (
        <div className="mx-auto max-w-lg px-4 py-16 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-16 w-16" style={{ color: primary }} />
          <h1 className="text-2xl font-bold">Pedido recebido!</h1>
          <p className="mt-1 text-gray-600">Pedido nº {done.order.number} ({done.order.externalId}) · {money(done.order.total)}</p>
          {done.payment.status === 'APROVADO' ? <p className="mt-4 rounded bg-green-50 p-3 text-green-800">Pagamento aprovado no cartão. Você receberá o código de rastreio por e-mail.</p> : (
            <div className="mt-4 space-y-3 rounded-xl border bg-white p-4">
              {done.payment.method === 'PIX' && <><img src={`/api/public/qr?data=${encodeURIComponent(done.payment.pix)}`} className="mx-auto h-44 w-44" alt="Pix" /><button className="w-full break-all rounded bg-gray-100 p-2 font-mono text-[10px]" onClick={() => { navigator.clipboard.writeText(done.payment.pix); toast.success('Copiado'); }}>{done.payment.pix}</button></>}
              <a href={done.payment.link} target="_blank" className="block rounded-lg py-3 font-semibold text-white" style={{ background: primary }}>{done.payment.simulated === false || done.payment.redirectUrl ? (done.payment.method === 'PIX' ? 'Abrir página de pagamento' : done.payment.method === 'BOLETO' ? 'Ver boleto' : 'Pagar com cartão') : done.payment.method === 'PIX' ? 'Já paguei / simular pagamento' : 'Ver boleto e simular pagamento'}</a>
            </div>
          )}
          <button className="mt-6 text-sm underline" onClick={() => { setDone(null); setCheckout(false); }}>Continuar comprando</button>
        </div>
      ) : checkout ? (
        <Checkout slug={slug} store={st} cart={cart} onDone={(r) => { setDone(r); setCart([]); }} onBack={() => setCheckout(false)} />
      ) : (
        <main>
          {sections.map((s) => {
            if (s === 'banner') return <section key={s} className="px-4 py-16 text-center text-white" style={{ background: st.bannerImage ? `url(${st.bannerImage}) center/cover` : `linear-gradient(120deg, ${primary}, ${st.accentColor})` }}><h1 className="text-3xl font-black md:text-5xl">{st.bannerTitle}</h1><p className="mx-auto mt-3 max-w-xl text-white/90">{st.bannerSubtitle}</p><a href="#todos" className="mt-6 inline-block rounded-full bg-white px-6 py-2.5 text-sm font-semibold" style={{ color: primary }}>Comprar agora</a></section>;
            if (s === 'destaques') { const f = products.filter((p) => p.featured).slice(0, 8); return f.length ? <section key={s} className="mx-auto max-w-6xl px-4 py-10"><h2 className="mb-4 text-xl font-bold">Destaques</h2><div className="grid grid-cols-2 gap-4 md:grid-cols-4">{f.map((p) => <Card key={p.id} p={p} />)}</div></section> : null; }
            if (s === 'categorias') return <section key={s} className="mx-auto max-w-6xl px-4 py-4"><div className="flex flex-wrap gap-2"><button onClick={() => setCat('')} className={cn('rounded-full border px-4 py-1.5 text-sm', !cat && 'text-white')} style={!cat ? { background: primary } : {}}>Todas</button>{data.categories.map((c: any) => <button key={c.id} onClick={() => setCat(c.id)} className={cn('rounded-full border bg-white px-4 py-1.5 text-sm', cat === c.id && 'text-white')} style={cat === c.id ? { background: primary } : {}}>{c.name}</button>)}</div></section>;
            if (s === 'todos') return <section key={s} id="todos" className="mx-auto max-w-6xl px-4 py-8"><h2 className="mb-4 text-xl font-bold">Todos os produtos <span className="text-sm font-normal text-gray-500">({filtered.length})</span></h2><div className="grid grid-cols-2 gap-4 md:grid-cols-4">{filtered.map((p) => <Card key={p.id} p={p} />)}</div></section>;
            if (s === 'sobre' && st.aboutText) return <section key={s} className="mx-auto max-w-3xl px-4 py-12 text-center"><h2 className="mb-2 text-xl font-bold">Sobre a {st.name}</h2><p className="text-gray-600">{st.aboutText}</p></section>;
            return null;
          })}
          <footer className="mt-10 border-t bg-white py-8 text-center text-xs text-gray-500"><div className="mb-2 flex justify-center gap-6"><span><ShieldCheck className="mr-1 inline h-4 w-4" /> Compra segura</span><span><Truck className="mr-1 inline h-4 w-4" /> Entrega para todo o Brasil</span><span><QrCode className="mr-1 inline h-4 w-4" /> Pix com desconto</span></div>{data.company.name} · CNPJ {data.company.cnpj} · {data.company.city}/{data.company.uf}<div className="mt-1">Loja de demonstração GestãoPro — pagamentos simulados</div></footer>
          {st.whatsapp && <a href={`https://wa.me/55${onlyDigits(st.whatsapp)}`} target="_blank" className="fixed bottom-5 right-5 rounded-full bg-green-500 p-3 text-white shadow-lg"><MessageCircle className="h-6 w-6" /></a>}
        </main>
      )}

      {view && <ProductModal p={view} store={st} onClose={() => setView(null)} onAdd={(id, name, price, max) => { add(id, name, price, max); setView(null); }} />}

      {open && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={() => setOpen(false)}>
          <div className="flex h-full w-full max-w-sm flex-col bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-4"><h3 className="font-bold">Seu carrinho</h3><button onClick={() => setOpen(false)}><X className="h-5 w-5" /></button></div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {cart.map((l) => <div key={l.productId} className="flex items-center gap-2 text-sm"><div className="flex-1"><div className="font-medium">{l.name}</div><div style={{ color: primary }}>{money(l.price)}</div></div><div className="flex items-center gap-1"><button className="rounded border p-1" onClick={() => setCart(cart.map((x) => (x.productId === l.productId ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))}><Minus className="h-3 w-3" /></button><span className="w-6 text-center">{l.quantity}</span><button className="rounded border p-1" onClick={() => setCart(cart.map((x) => (x.productId === l.productId ? { ...x, quantity: Math.min(x.max, x.quantity + 1) } : x)))}><Plus className="h-3 w-3" /></button></div><button onClick={() => setCart(cart.filter((x) => x.productId !== l.productId))}><X className="h-4 w-4 text-gray-400" /></button></div>)}
              {!cart.length && <p className="text-center text-sm text-gray-500">Carrinho vazio</p>}
            </div>
            <div className="border-t p-4"><div className="mb-3 flex justify-between font-bold"><span>Subtotal</span><span>{money(subtotal)}</span></div><button disabled={!cart.length} onClick={() => { setOpen(false); setArea(false); setCheckout(true); }} className="w-full rounded-lg py-3 font-semibold text-white disabled:opacity-50" style={{ background: primary }}>Finalizar compra</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductModal({ p, store, onClose, onAdd }: { p: Product; store: any; onClose: () => void; onAdd: (id: string, name: string, price: number, max: number) => void }) {
  const hasVar = p.variations.length > 0;
  const attrs = (p.attributes || {}) as Record<string, string[]>;
  const [sel, setSel] = useState<Record<string, string>>({});
  const imgs = productImages(p);
  const [img, setImg] = useState(0);
  const variation = hasVar ? p.variations.find((v) => Object.entries(v.attributes).every(([k, val]) => sel[k] === val)) : null;
  const price = variation?.price ?? p.price;
  const available = hasVar ? variation?.available ?? 0 : p.available;
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="grid max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white md:grid-cols-2" onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="relative overflow-hidden md:rounded-tl-2xl">
            <ProductImage src={imgs[img]} name={p.name} store={store} big />
            {imgs.length > 1 && <>
              <button aria-label="Imagem anterior" onClick={() => setImg((img - 1 + imgs.length) % imgs.length)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-1.5 shadow hover:bg-white"><ChevronLeft className="h-5 w-5" /></button>
              <button aria-label="Próxima imagem" onClick={() => setImg((img + 1) % imgs.length)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-1.5 shadow hover:bg-white"><ChevronRight className="h-5 w-5" /></button>
            </>}
          </div>
          {imgs.length > 1 && <div className="flex gap-2 overflow-x-auto p-3">{imgs.map((u, i) => <button key={u} onClick={() => setImg(i)} className={cn('h-14 w-14 shrink-0 overflow-hidden rounded border-2', i === img ? '' : 'border-transparent opacity-70')} style={i === img ? { borderColor: store.primaryColor } : {}}><img src={u} alt="" className="h-full w-full object-cover" /></button>)}</div>}
        </div>
        <div className="space-y-3 p-6">
          <button className="float-right" onClick={onClose}><X className="h-5 w-5" /></button>
          <div className="text-xs text-gray-500">{p.category?.name} · SKU {variation?.id ? p.variations.find((v) => v.id === variation.id)?.name : p.sku}</div>
          <h2 className="text-xl font-bold">{p.name}</h2>
          <div className="text-2xl font-bold" style={{ color: store.primaryColor }}>{money(price)}</div>
          <div className="text-sm text-gray-600">ou {money(price * (1 - store.pixDiscount / 100))} no Pix · até 6x de {money(price / 6)} sem juros</div>
          {hasVar && Object.entries(attrs).map(([k, vals]) => (
            <div key={k}><div className="mb-1 text-sm font-medium">{k}</div><div className="flex flex-wrap gap-2">{vals.map((v) => { const possible = p.variations.some((x) => x.attributes[k] === v && x.available > 0); return <button key={v} onClick={() => setSel({ ...sel, [k]: v })} className={cn('rounded border px-3 py-1 text-sm', sel[k] === v && 'border-2 font-semibold', !possible && 'opacity-40 line-through')} style={sel[k] === v ? { borderColor: store.primaryColor } : {}}>{v}</button>; })}</div></div>
          ))}
          <div className="text-xs">{hasVar && !variation ? 'Selecione as opções' : available > 0 ? <span className="text-green-700">{available} em estoque</span> : <span className="text-red-600">Esgotado</span>}</div>
          {p.description && <p className="text-sm text-gray-600">{p.description}</p>}
          <button disabled={(hasVar && !variation) || available <= 0} onClick={() => onAdd(variation?.id || p.id, variation ? variation.name : p.name, price, available)} className="w-full rounded-lg py-3 font-semibold text-white disabled:opacity-40" style={{ background: store.primaryColor }}>Adicionar ao carrinho</button>
        </div>
      </div>
    </div>
  );
}

function Checkout({ slug, store, cart, onDone, onBack }: { slug: string; store: any; cart: CartLine[]; onDone: (r: any) => void; onBack: () => void }) {
  const [c, setC] = useState<any>({ name: '', email: '', document: '', phone: '', zip: '', street: '', number: '', complement: '', district: '', city: '', uf: '' });
  const [opts, setOpts] = useState<any[]>([]);
  const [ship, setShip] = useState<any>(null);
  const [method, setMethod] = useState<'PIX' | 'BOLETO' | 'CARTAO_CREDITO'>('PIX');
  const [busy, setBusy] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<{ code: string; type: string; discount: number; freeShipping: boolean } | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const subtotal = cart.reduce((a, l) => a + l.price * l.quantity, 0);
  const discount = method === 'PIX' ? subtotal * (store.pixDiscount / 100) : 0;
  const couponDiscount = coupon ? Math.min(coupon.discount || 0, Math.max(0, subtotal - discount)) : 0;
  const freight = coupon?.freeShipping ? 0 : ship?.price || 0;
  const total = Math.max(0, subtotal - discount - couponDiscount) + freight;
  const applyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setCouponBusy(true);
    try {
      const r: any = await api(`/api/public/store/${slug}/coupon`, { method: 'POST', json: { code, subtotal } });
      if (r?.error) throw new Error(r.error);
      setCoupon({ code: r.code, type: r.type, discount: Number(r.discount) || 0, freeShipping: !!r.freeShipping });
      toast.success(`Cupom ${r.code} aplicado`);
    } catch (e) { setCoupon(null); toast.error((e as Error).message || 'Cupom inválido'); }
    setCouponBusy(false);
  };
  const quote = async () => {
    if (onlyDigits(c.zip).length !== 8) return;
    let uf: string = c.uf || '';
    try {
      const v = await fetch(`https://viacep.com.br/ws/${onlyDigits(c.zip)}/json/`).then((r) => r.json());
      if (!v.erro) { uf = v.uf || uf; setC((x: any) => ({ ...x, street: v.logradouro, district: v.bairro, city: v.localidade, uf: v.uf })); }
    } catch {}
    try {
      const r: any = await api(`/api/public/store/${slug}/freight`, { method: 'POST', json: { zip: c.zip, items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })), uf: uf || undefined } });
      setOpts(r.options);
      setShip(r.options[0]);
    } catch (e) { toast.error((e as Error).message); }
  };
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/public/store/${slug}/checkout`, { method: 'POST', json: { customer: c, items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })), shipping: { service: ship?.service, price: ship?.price || 0 }, paymentMethod: method, installments: 1, couponCode: coupon?.code || undefined } });
      onDone(r);
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };
  const inp = (k: string, ph: string, cls = '') => <input value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} onBlur={k === 'zip' ? quote : undefined} placeholder={ph} className={cn('h-10 rounded-lg border px-3 text-sm', cls)} />;
  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 md:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <button onClick={onBack} className="text-sm underline">← Voltar para a loja</button>
        <div className="rounded-xl border bg-white p-4"><h3 className="mb-3 font-bold">1. Identificação</h3><div className="grid grid-cols-2 gap-2">{inp('name', 'Nome completo', 'col-span-2')}{inp('email', 'E-mail')}{inp('document', 'CPF (ex.: 529.982.247-25)')}{inp('phone', 'Celular')}</div></div>
        <div className="rounded-xl border bg-white p-4"><h3 className="mb-3 font-bold">2. Entrega</h3><div className="grid grid-cols-3 gap-2">{inp('zip', 'CEP')}<button onClick={quote} className="rounded-lg border text-sm">Calcular frete</button><span />{inp('street', 'Endereço', 'col-span-2')}{inp('number', 'Número')}{inp('complement', 'Complemento')}{inp('district', 'Bairro')}{inp('city', 'Cidade')}{inp('uf', 'UF')}</div>
          {opts.length > 0 && <div className="mt-3 space-y-2">{opts.map((o) => <label key={o.service} className={cn('flex cursor-pointer items-center justify-between rounded-lg border p-3 text-sm', ship?.service === o.service && 'border-2')} style={ship?.service === o.service ? { borderColor: store.primaryColor } : {}}><span><input type="radio" className="mr-2" checked={ship?.service === o.service} onChange={() => setShip(o)} />{o.carrier} {o.service} · {o.deadlineDays} dias úteis</span><b>{o.free ? 'Grátis' : money(o.price)}</b></label>)}</div>}
        </div>
        <div className="rounded-xl border bg-white p-4"><h3 className="mb-3 font-bold">3. Pagamento</h3><div className="grid grid-cols-3 gap-2">{([['PIX', `Pix (-${store.pixDiscount}%)`], ['BOLETO', 'Boleto'], ['CARTAO_CREDITO', 'Cartão']] as const).map(([k, l]) => <button key={k} onClick={() => setMethod(k)} className={cn('rounded-lg border p-3 text-sm', method === k && 'border-2 font-semibold')} style={method === k ? { borderColor: store.primaryColor } : {}}>{l}</button>)}</div>
          {method === 'CARTAO_CREDITO' && <div className="mt-3 grid grid-cols-3 gap-2"><input className="col-span-3 h-10 rounded-lg border px-3 text-sm" defaultValue="4111 1111 1111 1111" /><input className="h-10 rounded-lg border px-3 text-sm" defaultValue="12/30" /><input className="h-10 rounded-lg border px-3 text-sm" defaultValue="123" /><span className="self-center text-xs text-gray-500">cartão de teste</span></div>}
        </div>
      </div>
      <div className="h-fit space-y-2 rounded-xl border bg-white p-4 text-sm">
        <h3 className="font-bold">Resumo</h3>
        {cart.map((l) => <div key={l.productId} className="flex justify-between"><span>{l.quantity}x {l.name}</span><span>{money(l.price * l.quantity)}</span></div>)}
        <div className="flex justify-between border-t pt-2"><span>Subtotal</span><span>{money(subtotal)}</span></div>
        {discount > 0 && <div className="flex justify-between text-green-700"><span>Desconto Pix</span><span>-{money(discount)}</span></div>}
        {coupon && couponDiscount > 0 && <div className="flex justify-between text-green-700"><span>Cupom {coupon.code}</span><span>-{money(couponDiscount)}</span></div>}
        <div className="flex justify-between"><span>Frete</span><span>{ship ? (freight ? money(freight) : <span className="text-green-700">Grátis{coupon?.freeShipping && ship.price ? ' (cupom)' : ''}</span>) : coupon?.freeShipping ? <span className="text-green-700">Grátis (cupom)</span> : '—'}</span></div>
        <div className="border-t pt-2">
          {coupon ? (
            <div className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800"><span><Tag className="mr-1 inline h-3.5 w-3.5" />Cupom <b>{coupon.code}</b> aplicado{coupon.freeShipping ? ' · frete grátis' : ''}</span><button onClick={() => { setCoupon(null); setCouponInput(''); }} className="underline">remover</button></div>
          ) : (
            <div className="flex gap-2"><input value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && applyCoupon()} placeholder="Cupom de desconto" className="h-9 min-w-0 flex-1 rounded-lg border px-3 text-sm uppercase" /><button disabled={couponBusy || !couponInput.trim()} onClick={applyCoupon} className="rounded-lg border px-3 text-sm font-medium disabled:opacity-50">{couponBusy ? '…' : 'Aplicar'}</button></div>
          )}
        </div>
        <div className="flex justify-between border-t pt-2 text-lg font-bold"><span>Total</span><span>{money(total)}</span></div>
        <button disabled={busy || !ship} onClick={submit} className="w-full rounded-lg py-3 font-semibold text-white disabled:opacity-50" style={{ background: store.primaryColor }}>{busy ? 'Processando…' : 'Confirmar pedido'}</button>
        {!ship && <p className="text-center text-xs text-gray-500">Informe o CEP para calcular o frete</p>}
      </div>
    </div>
  );
}

const ORDER_STEPS: [string, string][] = [['ABERTO', 'Pedido recebido'], ['FATURADO', 'Faturado'], ['SEPARADO', 'Em separação'], ['ENVIADO', 'Enviado'], ['ENTREGUE', 'Entregue']];
const PAY_TXT: Record<string, string> = { PIX: 'Pix', BOLETO: 'Boleto', CARTAO_CREDITO: 'Cartão de crédito', CARTAO_DEBITO: 'Cartão de débito', DINHEIRO: 'Dinheiro' };

/** Área do cliente: login por e-mail + CPF/CNPJ, pedidos, rastreio, nota fiscal e link de pagamento */
function CustomerArea({ slug, store, onBack }: { slug: string; store: any; onBack: () => void }) {
  const [state, setState] = useState<any>(null);
  const [form, setForm] = useState({ email: '', document: '' });
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const url = `/api/public/store/${slug}/customer`;
  useEffect(() => {
    fetch(url, { credentials: 'same-origin' }).then((r) => r.json()).then(setState).catch(() => setState({ logged: false }));
  }, [url]);
  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email.trim() || !onlyDigits(form.document)) return toast.error('Informe e-mail e CPF/CNPJ');
    setBusy(true);
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.email.trim(), document: form.document }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.error || 'E-mail ou CPF/CNPJ não conferem');
      setState(d);
      if (d.orders?.[0]) setOpenId(d.orders[0].id);
    } catch (err) { toast.error((err as Error).message); }
    setBusy(false);
  };
  const logout = async () => {
    try { await fetch(url, { method: 'DELETE', credentials: 'same-origin' }); } catch {}
    setState({ logged: false });
    setOpenId(null);
  };
  const primary = store.primaryColor;
  if (!state) return <div className="p-10 text-center text-sm text-gray-500">Carregando…</div>;
  if (!state.logged) return (
    <div className="mx-auto max-w-md px-4 py-12">
      <button onClick={onBack} className="mb-4 text-sm underline">← Voltar para a loja</button>
      <form onSubmit={login} className="space-y-3 rounded-xl border bg-white p-6">
        <div className="flex items-center gap-2"><User className="h-5 w-5" style={{ color: primary }} /><h1 className="text-lg font-bold">Meus pedidos</h1></div>
        <p className="text-sm text-gray-600">Acesse com o e-mail e o CPF/CNPJ informados na compra para acompanhar seus pedidos.</p>
        <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="E-mail" className="h-10 w-full rounded-lg border px-3 text-sm" autoComplete="email" />
        <input value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} placeholder="CPF ou CNPJ" className="h-10 w-full rounded-lg border px-3 text-sm" inputMode="numeric" />
        <button disabled={busy} className="w-full rounded-lg py-3 font-semibold text-white disabled:opacity-50" style={{ background: primary }}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
  const orders: any[] = state.orders || [];
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <button onClick={onBack} className="mb-4 text-sm underline">← Voltar para a loja</button>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4">
        <div><div className="text-lg font-bold">Olá, {state.customer?.name?.split(' ')[0] || 'cliente'}!</div><div className="text-xs text-gray-500">{state.customer?.email} · {fmtDoc(state.customer?.document)}</div></div>
        <button onClick={logout} className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"><LogOut className="h-4 w-4" /> Sair</button>
      </div>
      {!orders.length && <div className="rounded-xl border bg-white p-10 text-center text-sm text-gray-500"><Package className="mx-auto mb-2 h-8 w-8 opacity-50" />Você ainda não possui pedidos nesta loja.</div>}
      <div className="space-y-3">
        {orders.map((o) => {
          const expanded = openId === o.id;
          const cancelled = o.status === 'CANCELADO';
          const stepIdx = ORDER_STEPS.findIndex(([k]) => k === o.status);
          return (
            <div key={o.id} className="overflow-hidden rounded-xl border bg-white">
              <button onClick={() => setOpenId(expanded ? null : o.id)} className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left hover:bg-gray-50">
                <div><div className="font-semibold">Pedido nº {o.number}{o.externalId ? <span className="font-normal text-gray-500"> · {o.externalId}</span> : null}</div><div className="text-xs text-gray-500">{fmtDate(o.date)} · {PAY_TXT[o.paymentMethod] || o.paymentMethod || '—'}</div></div>
                <div className="flex items-center gap-3"><span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', cancelled ? 'bg-red-100 text-red-700' : o.status === 'ENTREGUE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700')}>{o.statusText || o.status}</span><b>{money(o.total)}</b></div>
              </button>
              {expanded && (
                <div className="space-y-4 border-t p-4 text-sm">
                  {!cancelled && (
                    <ol className="flex items-start">
                      {ORDER_STEPS.map(([k, label], i) => {
                        const reached = stepIdx >= i;
                        return (
                          <li key={k} className="relative flex flex-1 flex-col items-center text-center">
                            {i > 0 && <span className="absolute right-1/2 top-2.5 h-0.5 w-full" style={{ background: reached ? primary : '#e5e7eb' }} />}
                            <span className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 bg-white" style={{ borderColor: reached ? primary : '#d1d5db', background: reached ? primary : '#fff' }}>{reached && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}</span>
                            <span className={cn('mt-1 text-[11px]', reached ? 'font-semibold' : 'text-gray-400')}>{label}</span>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  {cancelled && <p className="rounded bg-red-50 p-2 text-xs text-red-700">Este pedido foi cancelado.</p>}
                  {o.payLink && <a href={`/pagar/${o.payLink}`} target="_blank" className="block rounded-lg py-2.5 text-center font-semibold text-white" style={{ background: primary }}>Pagar agora</a>}
                  <div>
                    <div className="mb-1 font-semibold">Itens</div>
                    {(o.items || []).map((it: any, i: number) => <div key={i} className="flex justify-between text-gray-700"><span>{it.quantity}x {it.description}</span><span>{money(it.total)}</span></div>)}
                    <div className="mt-1 flex justify-between border-t pt-1 font-bold"><span>Total</span><span>{money(o.total)}</span></div>
                  </div>
                  {(o.shipments || []).map((sh: any, i: number) => (
                    <div key={i} className="rounded-lg border p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-1.5 font-semibold"><Truck className="h-4 w-4" /> {sh.carrier} {sh.service}</div>{sh.trackingCode && <span className="font-mono text-xs">Rastreio: {sh.trackingCode}</span>}</div>
                      {(sh.events || []).length ? (
                        <ol className="relative ml-2 border-l">
                          {[...(sh.events || [])].reverse().map((ev: any, j: number) => (
                            <li key={j} className="mb-3 ml-4 last:mb-0"><span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-white" style={{ background: j === 0 ? primary : '#9ca3af' }} /><div className="font-medium">{ev.description}</div><div className="flex items-center gap-1 text-xs text-gray-500">{ev.location && <><MapPin className="h-3 w-3" />{ev.location} · </>}{fmtDateTime(ev.date)}</div></li>
                          ))}
                        </ol>
                      ) : <p className="text-xs text-gray-500">Aguardando postagem.</p>}
                    </div>
                  ))}
                  {o.invoice && (
                    <div className="rounded-lg border bg-gray-50 p-3 text-xs"><div className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><FileText className="h-4 w-4" /> Nota fiscal {o.invoice.model ? `(${o.invoice.model === '65' ? 'NFC-e' : 'NF-e'}) ` : ''}nº {o.invoice.number}</div>{o.invoice.accessKey && <div className="break-all font-mono text-[11px] text-gray-600">Chave de acesso: {String(o.invoice.accessKey).replace(/(\d{4})(?=\d)/g, '$1 ')}</div>}</div>
                  )}
                  {(o.returns || []).length > 0 && (
                    <div className="text-xs"><div className="mb-1 font-semibold">Trocas e devoluções</div>{o.returns.map((r: any, j: number) => <div key={j} className="flex justify-between text-gray-600"><span>Nº {r.number} · {r.kind === 'TROCA' ? 'Troca' : r.kind === 'DEVOLUCAO' ? 'Devolução' : r.kind} · {r.status}</span><span>{money(r.total)}</span></div>)}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
