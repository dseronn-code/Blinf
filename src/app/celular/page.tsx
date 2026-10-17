'use client';
import { useEffect, useState } from 'react';
import { Smartphone, Download, Share, MoreVertical, CheckCircle2, AlertTriangle } from 'lucide-react';

/**
 * "Usar no celular": mostra o QR Code do endereço atual e o passo a passo para
 * instalar o GestãoPro como aplicativo (PWA) no Android e no iPhone.
 */
export default function UseOnPhone() {
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const secure = origin.startsWith('https://');
  const local = /localhost|127\.0\.0\.1/.test(origin);
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-green-600 text-xl font-black text-white">G</div>
          <div>
            <h1 className="text-2xl font-bold">Usar o GestãoPro no celular</h1>
            <p className="text-sm text-slate-500">Instale como aplicativo: ícone na tela inicial, tela cheia, câmera para ler códigos.</p>
          </div>
        </div>

        {origin && (!secure || local) && (
          <div className="mb-5 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              {local ? 'Este endereço (localhost) só funciona neste computador.' : 'Este endereço não é HTTPS.'} Para instalar no celular é preciso um endereço <b>https://</b>:
              publique o GestãoPro no Railway (veja o README → “Publicar no Railway”) e abra esta página pelo endereço gerado.
            </div>
          </div>
        )}

        <div className="grid gap-5 md:grid-cols-[280px_1fr]">
          <div className="rounded-xl border bg-white p-5 text-center shadow-sm">
            {origin ? <img src={`/api/public/qr?data=${encodeURIComponent(origin + '/login')}`} alt="QR Code" className="mx-auto h-56 w-56" /> : <div className="mx-auto h-56 w-56" />}
            <p className="mt-3 text-sm font-medium">Aponte a câmera do celular</p>
            <p className="mt-1 break-all font-mono text-xs text-slate-500">{origin}</p>
          </div>
          <div className="space-y-4">
            <Step n={1} title="Abra no celular">Aponte a câmera para o QR Code (ou digite o endereço no navegador) e faça login.</Step>
            <Step n={2} title="Android (Chrome)">
              Toque no menu <MoreVertical className="inline h-4 w-4" /> e em <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>). Também pode aparecer o botão <Download className="inline h-4 w-4" /> <b>Instalar app</b> dentro do GestãoPro.
            </Step>
            <Step n={3} title="iPhone (Safari)">
              Toque em <Share className="inline h-4 w-4" /> <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.
            </Step>
            <Step n={4} title="Pronto">
              O GestãoPro abre em tela cheia pelo ícone <Smartphone className="inline h-4 w-4" />. Na primeira leitura de código de barras, permita o uso da câmera.
            </Step>
            <div className="flex gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-900">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>Quer o arquivo APK? Abra <b>pwabuilder.com</b>, cole este endereço e baixe o pacote Android — ele instala o mesmo aplicativo.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-600 text-sm font-bold text-white">{n}</div>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="mt-0.5 text-sm text-slate-600">{children}</div>
      </div>
    </div>
  );
}
