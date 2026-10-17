'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, X, Flashlight } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
const FORMATS = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'qr_code', 'data_matrix'];

/**
 * Leitor de código de barras pela câmera do celular (EAN, Code 128, QR...).
 * Usa o BarcodeDetector nativo quando existe (Chrome/Android) e o ZXing como alternativa.
 * `continuous`: mantém a câmera aberta para bipar vários itens seguidos (inventário, conferência).
 */
export function CameraScanButton({ onCode, continuous = false, className, label }: { onCode: (code: string) => void; continuous?: boolean; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" className={className} title="Ler código pela câmera" onClick={() => setOpen(true)}>
        <Camera className="h-5 w-5" />{label && <span className="ml-1">{label}</span>}
      </Button>
      {open && <ScannerOverlay continuous={continuous} onClose={() => setOpen(false)} onCode={(c) => { onCode(c); if (!continuous) setOpen(false); }} />}
    </>
  );
}

function ScannerOverlay({ onCode, onClose, continuous }: { onCode: (c: string) => void; onClose: () => void; continuous: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [last, setLast] = useState('');
  const [torch, setTorch] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const recent = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    let stop = false;
    let zxingControls: { stop: () => void } | null = null;
    const hit = (code: string) => {
      const now = Date.now();
      // evita repetir o mesmo código enquanto ele continua na frente da câmera
      if (code === recent.current.code && now - recent.current.at < 1500) return;
      recent.current = { code, at: now };
      try { navigator.vibrate?.(80); } catch {}
      setLast(code);
      cb.current(code);
    };
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este navegador não permite usar a câmera. Use HTTPS ou o app GestãoPro.');
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (stop) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        const v = video.current!;
        v.srcObject = s;
        await v.play();
        const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        if (BD) {
          const det = new BD({ formats: FORMATS });
          const loop = async () => {
            if (stop) return;
            try {
              const r = await det.detect(v);
              if (r[0]?.rawValue) hit(r[0].rawValue);
            } catch {}
            setTimeout(loop, 180);
          };
          loop();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          zxingControls = await reader.decodeFromVideoElement(v, (res) => { if (res && !stop) hit(res.getText()); });
        }
      } catch (e) {
        const n = (e as Error).name;
        setError(n === 'NotAllowedError' ? 'Permissão da câmera negada. Libere o acesso à câmera nas configurações do navegador/app.' : n === 'NotFoundError' ? 'Nenhuma câmera encontrada.' : `Não foi possível abrir a câmera (${(e as Error).message}).`);
      }
    })();
    return () => {
      stop = true;
      zxingControls?.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleTorch = async () => {
    const track = stream.current?.getVideoTracks()[0];
    try {
      await track?.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setError('Lanterna não disponível neste aparelho.');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <div className="flex items-center justify-between p-3 text-white">
        <span className="text-sm font-medium">{continuous ? 'Aponte para os códigos — leitura contínua' : 'Aponte para o código de barras'}</span>
        <div className="flex gap-2">
          <button type="button" onClick={toggleTorch} className="rounded-full p-2 hover:bg-white/10" aria-label="Lanterna"><Flashlight className={torch ? 'h-5 w-5 text-yellow-300' : 'h-5 w-5'} /></button>
          <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="Fechar"><X className="h-6 w-6" /></button>
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={video} playsInline muted className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-40 w-[80%] max-w-md rounded-xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        </div>
      </div>
      <div className="min-h-16 p-4 text-center text-sm text-white">
        {error ? <span className="text-red-300">{error}</span> : last ? <>Lido: <b className="font-mono">{last}</b>{continuous && ' — continue bipando ou feche'}</> : 'Procurando código…'}
      </div>
    </div>
  );
}
