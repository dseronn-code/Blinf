'use client';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

const DEMO = [
  { label: 'Administrador', email: 'admin@gestaopro.com.br', password: 'admin123' },
  { label: 'Vendedor', email: 'vendedor@gestaopro.com.br', password: 'demo123' },
  { label: 'Financeiro', email: 'financeiro@gestaopro.com.br', password: 'demo123' },
  { label: 'Estoquista', email: 'estoque@gestaopro.com.br', password: 'demo123' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('admin@gestaopro.com.br');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (e?: React.FormEvent, cred?: { email: string; password: string }) => {
    e?.preventDefault();
    setLoading(true);
    setError('');
    const r = await signIn('credentials', { email: cred?.email ?? email, password: cred?.password ?? password, redirect: false });
    setLoading(false);
    if (r?.ok) window.location.href = '/';
    else setError('E-mail ou senha inválidos');
  };
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-10 text-white lg:flex">
        <div className="flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-lg font-black">G</div><span className="text-xl font-bold">GestãoPro</span></div>
        <div>
          <h1 className="text-4xl font-bold leading-tight">Gestão completa para o seu negócio crescer.</h1>
          <p className="mt-4 max-w-md text-white/70">Vendas multicanal, estoque, notas fiscais, financeiro, PDV, produção, logística e loja virtual — tudo integrado em um só lugar.</p>
          <ul className="mt-6 grid max-w-md grid-cols-2 gap-2 text-sm text-white/80">
            {['NF-e, NFC-e e NFS-e', 'Mercado Livre, Shopee, Amazon…', 'Conta digital, Pix e boletos', '30 automações prontas', 'Multiempresa (multi-CNPJ)', 'Assistente de IA'].map((t) => <li key={t}>✓ {t}</li>)}
          </ul>
        </div>
        <p className="text-xs text-white/40">Ambiente de demonstração — integrações com SEFAZ, bancos e marketplaces são simuladas.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div>
            <h2 className="text-2xl font-bold">Entrar</h2>
            <p className="text-sm text-muted-foreground">Acesse sua conta GestãoPro</p>
          </div>
          <div><Label>E-mail</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div><Label>Senha</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" disabled={loading}>{loading ? 'Entrando…' : 'Entrar'}</Button>
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Acessos de demonstração (perfis com permissões diferentes)</p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map((d) => <Button key={d.email} type="button" variant="outline" size="sm" onClick={() => submit(undefined, d)}>{d.label}</Button>)}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
