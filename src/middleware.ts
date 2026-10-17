import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';
import { withAuth, type NextRequestWithAuth } from 'next-auth/middleware';

// mesmo nome de cookie de src/lib/auth.ts (o middleware roda no edge e não importa o Prisma)
const auth = withAuth({ pages: { signIn: '/login' }, secret: process.env.NEXTAUTH_SECRET || 'gestaopro-dev-secret', cookies: { sessionToken: { name: 'gp.session-token' } } });

/** Hosts do próprio ERP (demais hosts são tratados como domínio próprio de loja virtual) */
function isAppHost(host: string) {
  if (!host || host === 'localhost' || /^[\d.]+$/.test(host) || host.endsWith('.local') || host.endsWith('.internal')) return true;
  const app = [process.env.NEXTAUTH_URL, ...(process.env.APP_HOSTS || '').split(',')].filter(Boolean).map((u) => u!.replace(/^https?:\/\//, '').split(/[/:]/)[0].toLowerCase());
  return app.includes(host);
}

const cache = new Map<string, { slug: string | null; exp: number }>();
async function slugFor(host: string) {
  const hit = cache.get(host);
  if (hit && hit.exp > Date.now()) return hit.slug;
  let slug: string | null = null;
  try {
    const r = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/public/domain?host=${encodeURIComponent(host)}`, { cache: 'no-store' });
    slug = (await r.json()).slug || null;
  } catch {}
  cache.set(host, { slug, exp: Date.now() + 60_000 });
  return slug;
}

/**
 * 1) Domínio próprio da loja virtual (ex.: www.minhaloja.com.br) → reescreve para /loja/<slug>
 * 2) Demais rotas do ERP exigem login (NextAuth)
 */
export default async function middleware(req: NextRequest, ev: NextFetchEvent) {
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(':')[0].toLowerCase();
  if (!isAppHost(host)) {
    const slug = await slugFor(host);
    if (slug) {
      const url = req.nextUrl.clone();
      url.pathname = `/loja/${slug}`;
      return NextResponse.rewrite(url);
    }
  }
  return (auth as unknown as (r: NextRequestWithAuth, e: NextFetchEvent) => Promise<Response>)(req as NextRequestWithAuth, ev);
}

export const config = {
  matcher: ['/((?!api|login|celular|loja|pagar|redefinir-senha|sitemap.xml|robots.txt|manifest.webmanifest|sw.js|offline.html|icons/|_next/static|_next/image|favicon.ico).*)'],
};
