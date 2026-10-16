/*
 * Service worker do GestãoPro (app instalável).
 * - Shell e assets estáticos (/_next/static, ícones): stale-while-revalidate
 * - Navegação: rede primeiro, cópia em cache como reserva e /offline.html sem rede
 *   (o /pdv abre offline após a primeira visita; as vendas vão para a fila offline do PDV)
 * - /api NÃO é cacheada, exceto GET /api/me e GET /api/pdv (necessárias para abrir o PDV offline)
 */
const VERSION = 'gp-v1';
const STATIC_CACHE = `${VERSION}-static`;
const PAGES_CACHE = `${VERSION}-pages`;
const API_CACHE = `${VERSION}-api`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon.svg'];
const API_ALLOW = ['/api/me', '/api/pdv'];
// Páginas sempre pré-carregadas quando o usuário já está logado (cache "aquecido")
const WARM_PAGES = ['/', '/pdv'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Mensagens da página: aquecer o cache (após login) ou limpar dados (logout)
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'WARM') event.waitUntil(warm());
  if (msg.type === 'CLEAR_USER_DATA') event.waitUntil(Promise.all([caches.delete(API_CACHE), caches.delete(PAGES_CACHE)]));
});

async function warm() {
  const cache = await caches.open(PAGES_CACHE);
  await Promise.all(WARM_PAGES.map(async (p) => {
    try {
      const res = await fetch(p, { credentials: 'same-origin' });
      if (isCacheablePage(res)) await cache.put(p, res);
    } catch { /* sem rede */ }
  }));
}

const isCacheablePage = (res) => res && res.ok && !res.redirected && res.type === 'basic' && (res.headers.get('content-type') || '').includes('text/html');

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Logout / tela de login: descarta dados do usuário em cache
  if (req.mode === 'navigate' && url.pathname === '/login') {
    event.waitUntil(caches.delete(API_CACHE));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (API_ALLOW.includes(url.pathname) && !url.search) event.respondWith(networkFirstApi(req));
    return; // demais rotas da API: sempre rede
  }

  // Payload RSC das navegações client-side: sempre rede (o Next cai para navegação completa se falhar)
  if (req.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) return;

  if (req.mode === 'navigate') {
    event.respondWith(navigation(req, event));
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest' || /\.(?:css|js|woff2?|png|svg|ico)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, event));
  }
});

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);
  const update = fetch(req)
    .then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (cached) {
    event.waitUntil(update);
    return cached;
  }
  return (await update) || new Response('', { status: 504, statusText: 'Offline' });
}

async function navigation(req, event) {
  const url = new URL(req.url);
  const key = url.pathname; // ignora query string ao guardar a página
  const cache = await caches.open(PAGES_CACHE);
  try {
    const res = await fetch(req);
    if (isCacheablePage(res)) event.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch {
    const cached = (await cache.match(key)) || (url.pathname.startsWith('/pdv') ? await cache.match('/pdv') : undefined);
    if (cached) return cached;
    return (await caches.match(OFFLINE_URL)) || new Response('Sem conexão', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function networkFirstApi(req) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    else if (res.status === 401) await caches.delete(API_CACHE);
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Sem conexão com a internet' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}
