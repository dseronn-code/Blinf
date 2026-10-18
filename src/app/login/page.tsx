'use client';
import { signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';

// Acesso rápido só no ambiente de desenvolvimento (DEMO_MODE); em produção o usuário de demonstração digita teste123
const DEMO = [{ label: 'Demonstração', email: 'teste123', password: 'senha123' }];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Acesso rápido e senhas de demonstração só aparecem no modo demonstração
  const [cfg, setCfg] = useState<{ demo: boolean; setupNeeded: boolean }>({ demo: false, setupNeeded: false });
  useEffect(() => {
    fetch('/api/public/config').then((r) => r.json()).then((d) => {
      setCfg(d);
    }).catch(() => {});
  }, []);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [needOtp, setNeedOtp] = useState(false);
  const [otp, setOtp] = useState('');
  const [forgot, setForgot] = useState<{ email: string; busy?: boolean; message?: string; devLink?: string; error?: string } | null>(null);
  const submit = async (e?: React.FormEvent, cred?: { email: string; password: string }) => {
    e?.preventDefault();
    const em = cred?.email ?? email;
    const pw = cred?.password ?? password;
    if (cred) { setEmail(cred.email); setPassword(cred.password); setNeedOtp(false); setOtp(''); }
    setLoading(true);
    setError('');
    const useOtp = !cred && needOtp && otp;
    const r = await signIn('credentials', { email: em, password: pw, ...(useOtp ? { otp } : {}), redirect: false });
    setLoading(false);
    if (r?.ok && !r.error) { window.location.href = '/'; return; }
    const err = r?.error || '';
    if (err === '2FA_REQUIRED') {
      setNeedOtp(true);
      if (useOtp) setError('Informe o código de verificação');
      return;
    }
    if (err && err !== 'CredentialsSignin' && err !== 'Configuration') setError(err);
    else setError('E-mail ou senha inválidos');
  };
  const sendForgot = async () => {
    if (!forgot) return;
    setForgot({ ...forgot, busy: true, error: undefined });
    try {
      const res = await fetch('/api/account/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: forgot.email }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setForgot({ ...forgot, busy: false, error: d.error || `Erro ${res.status}` });
      else setForgot({ ...forgot, busy: false, message: d.message, devLink: d.devLink });
    } catch {
      setForgot({ ...forgot, busy: false, error: 'Falha de conexão. Tente novamente.' });
    }
  };
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-10 text-white lg:flex">
        <div className="flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-lg font-black">G</div><span className="text-xl font-bold">GestãoPro</span></div>
        <div>
          <h1 className="text-4xl font-bold leading-tight">Gestão completa para o seu negócio crescer.</h1>
          <p className="mt-4 max-w-md text-white/70">Vendas multicanal, estoque, notas fiscais, financeiro, PDV, produção, logística e loja virtual — tudo integrado em um só lugar.</p>
          <ul className="mt-6 grid max-w-md grid-cols-2 gap-2 text-sm text-white/80">
            {['NF-e, NFC-e e NFS-e', 'Mercado Livre, Shopee, Amazon…', 'Conta digital, Pix e boletos', '31 automações prontas', 'Multiempresa (multi-CNPJ)', 'Assistente de IA'].map((t) => <li key={t}>✓ {t}</li>)}
          </ul>
        </div>
        {cfg.demo && <p className="text-xs text-white/40">Ambiente de demonstração — integrações com SEFAZ, bancos e marketplaces são simuladas.</p>}
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div>
            <h2 className="text-2xl font-bold">Entrar</h2>
            <p className="text-sm text-muted-foreground">Acesse sua conta GestãoPro</p>
          </div>
          <div><Label>E-mail ou usuário</Label><Input type="text" autoComplete="username" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div>
            <div className="flex items-center justify-between"><Label>Senha</Label><button type="button" className="mb-1 text-xs text-primary hover:underline" onClick={() => setForgot({ email })}>Esqueci minha senha</button></div>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {needOtp && (
            <div>
              <Label>Código de verificação (2FA)</Label>
              <Input inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} placeholder="000000" className="text-center font-mono tracking-widest" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} required />
              <p className="mt-1 text-[11px] text-muted-foreground">Digite o código de 6 dígitos do seu aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy…).</p>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" disabled={loading}>{loading ? 'Entrando…' : needOtp ? 'Verificar e entrar' : 'Entrar'}</Button>
          {cfg.demo && (
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Acessos de demonstração (perfis com permissões diferentes)</p>
              <div className="grid grid-cols-2 gap-2">
                {DEMO.map((d) => <Button key={d.email} type="button" variant="outline" size="sm" onClick={() => submit(undefined, d)}>{d.label}</Button>)}
              </div>
            </div>
          )}
          {cfg.setupNeeded && <p className="text-center text-sm"><Link href="/primeiro-acesso" className="font-medium text-primary underline">Primeiro acesso: cadastrar minha empresa</Link></p>}
        </form>
      </div>
      <Dialog open={!!forgot} onOpenChange={(o) => !o && setForgot(null)} title="Esqueci minha senha" description="Enviaremos um link para você criar uma nova senha" size="sm" footer={forgot?.message ? <Button onClick={() => setForgot(null)}>Fechar</Button> : <Button disabled={forgot?.busy || !forgot?.email} onClick={sendForgot}>{forgot?.busy ? 'Enviando…' : 'Enviar link'}</Button>}>
        {forgot && (forgot.message ? (
          <div className="space-y-3 text-sm">
            <p>{forgot.message}</p>
            {forgot.devLink && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <b>Modo demonstração</b> (SMTP não configurado): o e-mail foi registrado na caixa de saída. Use o link abaixo:
                <a href={forgot.devLink} className="mt-1 block break-all font-medium text-primary underline">{forgot.devLink}</a>
              </div>
            )}
          </div>
        ) : (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); sendForgot(); }}>
            <Label>E-mail cadastrado</Label>
            <Input type="email" autoFocus value={forgot.email} onChange={(e) => setForgot({ ...forgot, email: e.target.value })} required />
            {forgot.error && <p className="text-sm text-destructive">{forgot.error}</p>}
          </form>
        ))}
      </Dialog>
    </div>
  );
}
