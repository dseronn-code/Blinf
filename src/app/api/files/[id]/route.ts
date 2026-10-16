import { prisma } from '@/lib/db';

/** Download público do arquivo (ids não sequenciais) — usado nas imagens da loja virtual */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await prisma.upload.findUnique({ where: { id } });
  if (!f) return new Response('Arquivo não encontrado', { status: 404 });
  return new Response(new Uint8Array(f.data), {
    headers: { 'Content-Type': f.mime, 'Content-Length': String(f.size), 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Disposition': `inline; filename="${encodeURIComponent(f.filename)}"`, 'X-Content-Type-Options': 'nosniff' },
  });
}
