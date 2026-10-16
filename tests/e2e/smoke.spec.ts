import { test, expect } from '@playwright/test';
import { login, trackErrors, expectHealthy, CONTADOR } from './helpers';

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

  test('contador consulta fiscal e arquivos, mas não acessa o PDV', async ({ page }) => {
    await login(page, CONTADOR);
    await page.goto('/fiscal/contador');
    await expectHealthy(page);
    await expect(page.getByRole('heading', { name: 'Arquivos para o contador' })).toBeVisible();
    const sped = await page.request.get('/api/fiscal/files?type=sped');
    expect(sped.status()).toBe(200);
    const notas = await page.request.get('/api/invoices');
    expect(notas.status()).toBe(200);
    const { rows } = await notas.json();
    const auth = rows?.find((r: { status: string }) => r.status === 'AUTORIZADA');
    if (auth) expect((await page.request.get(`/api/invoices/${auth.id}/xml`)).status()).toBe(200);
    expect((await page.request.get('/api/pdv')).status()).toBe(403);
    expect((await page.request.post('/api/contracts', { data: {} })).status()).toBe(403);
  });
});
