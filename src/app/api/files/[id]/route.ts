import { prisma } from '@/lib/db';
import { getCtx } from '@/server/context';

/**
 * Download de arquivos. Imagens (vitrine da loja) são públicas por id não sequencial;
 * demais arquivos (XML de eventos fiscais, PDFs, anexos) exigem login na mesma organização.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await prisma.upload.findUnique({ where: { id } });
  if (!f) return new Response('Arquivo não encontrado', { status: 404 });
  const isPublic = f.mime.startsWith('image/');
  if (!isPublic) {
    const ctx = await getCtx().catch(() => null);
    if (!ctx || ctx.orgId !== f.organizationId) return new Response('Arquivo não encontrado', { status: 404 });
  }
  return new Response(new Uint8Array(f.data), {
    headers: { 'Content-Type': f.mime, 'Content-Length': String(f.size), 'Cache-Control': isPublic ? 'public, max-age=31536000, immutable' : 'private, no-store', 'Content-Disposition': `inline; filename="${encodeURIComponent(f.filename)}"`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" },
  });
}
