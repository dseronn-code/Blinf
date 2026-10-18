'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { toast } from 'sonner';
import { SetupForm, type SetupValues } from '@/components/setup/setup-form';

/** Primeiro acesso: cadastra a empresa real e o administrador (banco vazio) */
export default function FirstAccess() {
  const [needed, setNeeded] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch('/api/public/config').then((r) => r.json()).then((d) => setNeeded(!!d.setupNeeded)).catch(() => setNeeded(false));
  }, []);
  const submit = async (v: SetupValues) => {
    setBusy(true);
    try {
      const r = await fetch('/api/public/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha ao configurar');
      toast.success('Empresa cadastrada! Entrando…');
      const s = await signIn('credentials', { email: v.admin.email, password: v.admin.password, redirect: false });
      window.location.href = s?.ok ? '/' : '/login';
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-3xl rounded-xl border bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-600 text-lg font-black text-white">G</div>
          <div><h1 className="text-xl font-bold">Bem-vindo ao GestãoPro</h1><p className="text-sm text-slate-500">Cadastre a sua empresa e o seu acesso para começar.</p></div>
        </div>
        {needed === null ? <p className="text-sm text-slate-500">Carregando…</p> : needed ? (
          <SetupForm onSubmit={submit} busy={busy} submitLabel="Criar minha empresa e entrar" />
        ) : (
          <p className="text-sm">O GestãoPro já está configurado. <Link href="/login" className="font-medium text-green-700 underline">Entrar</Link></p>
        )}
      </div>
    </div>
  );
}
