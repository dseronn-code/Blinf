'use client';
import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';

/** Diálogo para pedir um texto (ex.: justificativa de cancelamento) */
export function PromptDialog({ open, onOpenChange, title, description, label, minLength = 0, confirmText = 'Confirmar', onConfirm, destructive }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; label?: string; minLength?: number; confirmText?: string; onConfirm: (text: string) => Promise<unknown> | void; destructive?: boolean;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description} size="sm" footer={
      <>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Voltar</Button>
        <Button variant={destructive ? 'destructive' : 'default'} disabled={busy || text.trim().length < minLength} onClick={async () => { setBusy(true); await onConfirm(text); setBusy(false); setText(''); onOpenChange(false); }}>{confirmText}</Button>
      </>
    }>
      {label && <p className="mb-1 text-xs text-muted-foreground">{label}</p>}
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} autoFocus />
      {minLength > 0 && <p className="mt-1 text-[11px] text-muted-foreground">{text.trim().length}/{minLength} caracteres mínimos</p>}
    </Dialog>
  );
}
