'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Download, X } from 'lucide-react';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const DISMISS_KEY = 'gp_pwa_install_dismissed';
// Em desenvolvimento o SW atrapalharia o hot reload — ative com NEXT_PUBLIC_PWA_DEV=1
const ENABLED = process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_PWA_DEV === '1';

function postToSw(msg: { type: string }) {
  navigator.serviceWorker?.ready.then((r) => r.active?.postMessage(msg)).catch(() => {});
}

/** Registra o service worker e oferece o botão "Instalar app" (beforeinstallprompt) */
export function PwaManager() {
  const pathname = usePathname();
  const { status } = useSession();
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (!ENABLED) {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      return;
    }
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((e) => console.warn('Service worker não registrado:', e));
  }, []);

  // Após login, aquece o cache (início e PDV) para uso offline; no logout, limpa os dados do usuário
  useEffect(() => {
    if (!ENABLED || !('serviceWorker' in navigator)) return;
    if (status === 'authenticated') postToSw({ type: 'WARM' });
    if (status === 'unauthenticated') postToSw({ type: 'CLEAR_USER_DATA' });
  }, [status]);

  useEffect(() => {
    let dismissed = false;
    try { dismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch { /* armazenamento indisponível */ }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallEvent);
      setHidden(dismissed);
    };
    const onInstalled = () => { setPrompt(null); setHidden(true); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  // Loja virtual e páginas públicas de pagamento não oferecem a instalação do ERP
  if (!prompt || hidden || pathname?.startsWith('/loja') || pathname?.startsWith('/pagar')) return null;

  const install = async () => {
    await prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') setPrompt(null);
    setHidden(true);
  };
  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* armazenamento indisponível */ }
    setHidden(true);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-lg border bg-card p-2 pl-3 text-sm shadow-lg">
      <span className="hidden sm:inline">Use o GestãoPro como aplicativo</span>
      <button onClick={install} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
        <Download className="h-3.5 w-3.5" /> Instalar app
      </button>
      <button onClick={dismiss} aria-label="Dispensar" className="rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
    </div>
  );
}
