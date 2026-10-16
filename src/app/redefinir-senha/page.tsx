'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

type Check = { valid: boolean; name?: string; email?: string };

function ResetForm() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const invite = params.get('convite') === '1';
  const [check, setCheck] = useState<Check | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setCheck({ valid: false }); return; }
    fetch(`/api/account/reset?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => setCheck(d))
      .catch(() => setCheck({ valid: false }));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) return setError('A senha deve ter ao menos 6 caracteres');
    if (password !== confirm) return setError('As senhas não conferem');
    setLoading(true);
    try {
      const res = await fetch('/api/account/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error || `Erro ${res.status}`);
      else setDone(d.email || check?.email || '');
    } catch {
      setError('Falha de conexão. Tente novamente.');
    }
    setLoading(false);
  };

  if (!check) return <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  if (done !== null) return (
    <div className="space-y-4 text-center">
      <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
      <div>
        <h2 className="text-2xl font-bold">{invite ? 'Acesso criado!' : 'Senha redefinida!'}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Agora você já pode entrar{done ? <> com o e-mail <b>{done}</b></> : null} e a nova senha.</p>
      </div>
      <Button asChild className="w-full"><Link href="/login">Ir para o login</Link></Button>
    </div>
  );

  if (!check.valid) return (
    <div className="space-y-4 text-center">
      <XCircle className="mx-auto h-12 w-12 text-destructive" />
      <div>
        <h2 className="text-2xl font-bold">Link inválido ou expirado</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {invite ? 'Este convite já foi utilizado ou expirou (validade de 72 horas). Peça ao administrador um novo convite.' : 'Este link de redefinição já foi utilizado ou expirou (validade de 1 hora). Solicite um novo em "Esqueci minha senha" na tela de login.'}
        </p>
      </div>
      <Button asChild variant="outline" className="w-full"><Link href="/login">Voltar ao login</Link></Button>
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">{invite ? 'Bem-vindo(a) ao GestãoPro' : 'Redefinir senha'}</h2>
        <p className="text-sm text-muted-foreground">
          {invite ? <>Olá, {check.name}! Defina uma senha para ativar seu acesso.</> : <>Olá, {check.name}. Crie uma nova senha para sua conta.</>}
        </p>
      </div>
      <div><Label>E-mail</Label><Input value={check.email || ''} disabled /></div>
      <div><Label>{invite ? 'Senha' : 'Nova senha'}</Label><Input type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /><p className="mt-0.5 text-[11px] text-muted-foreground">Mínimo de 6 caracteres</p></div>
      <div><Label>Confirmar senha</Label><Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} /></div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button className="w-full" disabled={loading}>{loading ? 'Salvando…' : invite ? 'Definir senha e ativar acesso' : 'Salvar nova senha'}</Button>
      <p className="text-center text-xs"><Link href="/login" className="text-primary hover:underline">Voltar ao login</Link></p>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-10 text-white lg:flex">
        <div className="flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-lg font-black">G</div><span className="text-xl font-bold">GestãoPro</span></div>
        <div>
          <h1 className="text-4xl font-bold leading-tight">Seu acesso, protegido.</h1>
          <p className="mt-4 max-w-md text-white/70">Escolha uma senha forte e, depois de entrar, ative a autenticação em dois fatores em Configurações › Minha conta e segurança.</p>
        </div>
        <p className="text-xs text-white/40">Links de redefinição expiram em 1 hora; convites, em 72 horas.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Suspense fallback={<div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
            <ResetForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
