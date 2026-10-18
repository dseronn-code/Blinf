'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Download, AlertTriangle, DatabaseBackup } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { openFile } from '@/lib/api';
import { SetupForm, type SetupValues } from '@/components/setup/setup-form';

/** Dados do sistema: backup e recomeço com a empresa real (apaga demonstração) */
export default function DataPage() {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const reset = async (v: SetupValues) => {
    if (confirm !== 'APAGAR TUDO') return toast.error('Para confirmar, digite APAGAR TUDO');
    setBusy(true);
    try {
      const r = await fetch('/api/system/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...v, confirm }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha ao recomeçar');
      toast.success('Pronto! Entrando com o novo acesso…');
      const s = await signIn('credentials', { email: v.admin.email, password: v.admin.password, redirect: false });
      window.location.href = s?.ok ? '/' : '/login';
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="max-w-4xl">
      <PageHeader title="Dados e backup" description="Cópia de segurança e início do uso real com a sua empresa." />
      <Card className="mb-6 p-5">
        <div className="mb-2 flex items-center gap-2 font-semibold"><DatabaseBackup className="h-5 w-5" /> Backup</div>
        <p className="mb-3 text-sm text-muted-foreground">Baixa uma cópia completa de todos os dados (cadastros, pedidos, notas, financeiro, configurações) em um arquivo compactado. Contém dados sensíveis — guarde em local seguro. No Railway, ative também os backups automáticos do banco (serviço Postgres → Backups).</p>
        <Button variant="outline" onClick={() => openFile('/api/system/backup')}><Download className="mr-1 h-4 w-4" /> Baixar backup agora</Button>
      </Card>
      <Card className="border-red-300 p-5">
        <div className="mb-2 flex items-center gap-2 font-semibold text-red-700"><AlertTriangle className="h-5 w-5" /> Começar o uso real com a minha empresa</div>
        <p className="mb-4 text-sm text-muted-foreground">Apaga <b>todos</b> os dados atuais — inclusive as empresas, produtos, pedidos e usuários de demonstração — e cria a sua empresa com o seu acesso de administrador. Não pode ser desfeito: baixe o backup antes, se quiser guardar algo.</p>
        <SetupForm
          onSubmit={reset}
          busy={busy}
          submitLabel="Apagar tudo e criar minha empresa"
          extra={<div><Label className="mb-1 block text-xs">Para confirmar, digite APAGAR TUDO</Label><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="APAGAR TUDO" /></div>}
        />
      </Card>
    </div>
  );
}
