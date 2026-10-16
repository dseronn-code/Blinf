'use client';
import { useState } from 'react';
import { ShieldCheck, ShieldOff, Smartphone, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, Field, KV } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMe } from '@/components/layout/me';

const codeInput = (v: string) => v.replace(/\D/g, '').slice(0, 6);

export default function SecurityPage() {
  const me = useMe();
  const { data, isLoading } = useApi<{ enabled: boolean }>('/api/account/2fa');
  const act = useAction();
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    const r = await act<{ secret: string; otpauth: string }>('POST', '/api/account/2fa', { action: 'setup' }, false);
    setBusy(false);
    if (r) { setSetup(r); setCode(''); }
  };
  const enable = async () => {
    setBusy(true);
    const r = await act('POST', '/api/account/2fa', { action: 'enable', code }, 'Autenticação em dois fatores ativada');
    setBusy(false);
    if (r) { setSetup(null); setCode(''); }
  };
  const disable = async () => {
    setBusy(true);
    const r = await act('POST', '/api/account/2fa', { action: 'disable', code }, 'Autenticação em dois fatores desativada');
    setBusy(false);
    if (r) setCode('');
  };

  return (
    <div>
      <PageHeader title="Minha conta e segurança" description="Proteja seu acesso com autenticação em dois fatores (2FA)" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card><CardHeader><CardTitle>Minha conta</CardTitle></CardHeader><CardContent className="space-y-3">
          <KV label="Nome" value={me?.user.name} />
          <KV label="E-mail" value={me?.user.email} />
          <KV label="Perfil" value={me?.user.role} />
          <p className="text-xs text-muted-foreground">Para trocar a senha, use &quot;Esqueci minha senha&quot; na tela de login ou peça a um administrador em Usuários.</p>
        </CardContent></Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Autenticação em dois fatores (TOTP)</CardTitle>
            {!isLoading && (data?.enabled ? <Badge tone="green">Ativa</Badge> : <Badge tone="gray">Desativada</Badge>)}
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Além da senha, será pedido um código de 6 dígitos gerado no seu celular a cada login. Funciona com <b>Google Authenticator</b>, <b>Microsoft Authenticator</b>, <b>Authy</b> e outros aplicativos compatíveis com TOTP.
            </p>

            {isLoading ? null : data?.enabled ? (
              <div className="space-y-3 rounded-lg border border-green-200 bg-green-50/50 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-green-800"><ShieldCheck className="h-5 w-5" /> Sua conta está protegida com 2FA.</div>
                <p className="text-xs text-muted-foreground">Para desativar, informe o código atual exibido no aplicativo autenticador. Se perdeu o celular, peça a um administrador para remover o 2FA do seu usuário.</p>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Código de 6 dígitos"><Input inputMode="numeric" autoComplete="one-time-code" className="w-40 text-center font-mono tracking-widest" value={code} onChange={(e) => setCode(codeInput(e.target.value))} placeholder="000000" /></Field>
                  <Button variant="destructive" disabled={busy || code.length !== 6} onClick={disable}><ShieldOff /> Desativar 2FA</Button>
                </div>
              </div>
            ) : !setup ? (
              <Button onClick={start} disabled={busy}><Smartphone /> Ativar autenticação em dois fatores</Button>
            ) : (
              <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-[auto_1fr]">
                <div className="flex flex-col items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={'/api/public/qr?data=' + encodeURIComponent(setup.otpauth)} alt="QR Code para o aplicativo autenticador" className="h-48 w-48 rounded border bg-white p-2" />
                </div>
                <div className="space-y-3 text-sm">
                  <ol className="list-decimal space-y-1 pl-4">
                    <li>Abra o aplicativo autenticador no celular e escolha <b>adicionar conta</b> / <b>ler QR Code</b>.</li>
                    <li>Aponte a câmera para o QR Code ao lado.</li>
                    <li>Digite abaixo o código de 6 dígitos exibido no aplicativo para confirmar.</li>
                  </ol>
                  <Field label="Não consegue ler o QR Code? Digite esta chave manualmente">
                    <div className="flex gap-2">
                      <code className="flex-1 select-all break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">{setup.secret}</code>
                      <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(setup.secret); toast.success('Chave copiada'); }}>Copiar</Button>
                    </div>
                  </Field>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Código de verificação"><Input inputMode="numeric" autoComplete="one-time-code" autoFocus className="w-40 text-center font-mono tracking-widest" value={code} onChange={(e) => setCode(codeInput(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && enable()} placeholder="000000" /></Field>
                    <Button disabled={busy || code.length !== 6} onClick={enable}><ShieldCheck /> Confirmar e ativar</Button>
                    <Button variant="ghost" onClick={() => { setSetup(null); setCode(''); }}>Cancelar</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Se o código for recusado, confira se o horário do celular está automático (sincronizado).</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
