import { test, expect } from '@playwright/test';
import { login, trackErrors, expectHealthy } from './helpers';

const PAGES = [
  '/', '/vendas', '/vendas/novo', '/vendas/propostas', '/vendas/contratos', '/vendas/contratos/novo', '/pdv',
  '/cadastros/contatos', '/cadastros/produtos', '/estoque', '/compras', '/fiscal/notas', '/fiscal/contador',
  '/financeiro/receber', '/financeiro/pagar', '/financeiro/fluxo', '/relatorios', '/servicos', '/logistica/envios',
  '/integracoes', '/automacoes', '/configuracoes/usuarios',
];

test.describe('smoke', () => {
  test('admin abre as principais páginas sem erro', async ({ page }) => {
    const errors = trackErrors(page);
    await login(page);
    for (const path of PAGES) {
      await test.step(path, async () => {
        const res = await page.goto(path);
        expect(res?.status(), `${path} respondeu ${res?.status()}`).toBeLessThan(400);
        await expect(page.getByText('Carregando GestãoPro…')).toHaveCount(0);
        await expectHealthy(page);
        await expect(page.locator('main h1').first()).toBeVisible();
      });
    }
    expect(errors, `Erros de JavaScript: ${errors.join(' | ')}`).toEqual([]);
  });

  test('app instalável: manifest e service worker públicos', async ({ request }) => {
    const m = await request.get('/manifest.webmanifest');
    expect(m.ok()).toBeTruthy();
    const manifest = await m.json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBeTruthy();
    expect((await request.get('/sw.js')).ok()).toBeTruthy();
    expect((await request.get('/offline.html')).ok()).toBeTruthy();
  });

  test('usuário teste123 entra na organização de demonstração', async ({ page }) => {
    await login(page);
    const me = await (await page.request.get('/api/me')).json();
    expect(me.demo).toBe(true);
    expect((await page.request.get('/api/system/backup')).status()).toBe(403);
  });
});
