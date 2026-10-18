'use client';
import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

/** Troca obrigatória da senha padrão (e troca voluntária) */
export default function ChangePassword() {
  const [f, setF] = useState({ current: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirm) return toast.error('As senhas não conferem');
    setBusy(true);
    const r = await fetch('/api/account/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast.error(d.error || 'Não foi possível trocar a senha');
    toast.success('Senha alterada. Entre novamente com a nova senha.');
    setTimeout(() => signOut({ callbackUrl: '/login' }), 900);
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-lg font-bold">Crie uma senha nova</h1>
          <p className="text-sm text-slate-500">Por segurança, troque a senha padrão antes de usar o sistema.</p>
        </div>
        <div><Label className="mb-1 block text-xs">Senha atual</Label><Input type="password" autoComplete="current-password" required value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></div>
        <div><Label className="mb-1 block text-xs">Nova senha (mín. 8 caracteres)</Label><Input type="password" autoComplete="new-password" minLength={8} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
        <div><Label className="mb-1 block text-xs">Confirme a nova senha</Label><Input type="password" autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></div>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</Button>
        <button type="button" className="w-full text-xs text-slate-500 underline" onClick={() => signOut({ callbackUrl: '/login' })}>Sair</button>
      </form>
    </div>
  );
}
