/** Leitura das imagens do produto para canais que exigem o arquivo (Shopee) */
import { prisma } from '@/lib/db';

/** Binário da imagem (upload do ERP, data: URI ou URL pública) — Shopee exige enviar o arquivo */
export async function loadImage(orgId: string, url: string): Promise<{ data: Buffer; mime: string; filename: string } | null> {
  const data = url.match(/^data:([^;,]+)(;base64)?,(.*)$/);
  if (data) return { data: data[2] ? Buffer.from(data[3], 'base64') : Buffer.from(decodeURIComponent(data[3])), mime: data[1], filename: `imagem.${data[1].split('/')[1] || 'jpg'}` };
  const own = url.match(/\/api\/files\/([A-Za-z0-9_-]+)/);
  if (own) {
    const f = await prisma.upload.findUnique({ where: { id: own[1] } });
    if (f && f.organizationId === orgId && f.mime.startsWith('image/')) return { data: Buffer.from(f.data), mime: f.mime, filename: f.filename };
  }
  if (!/^https?:\/\//.test(url)) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    return { data: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') || 'image/jpeg', filename: url.split('/').pop()?.split('?')[0] || 'imagem.jpg' };
  } catch {
    return null;
  }
}
