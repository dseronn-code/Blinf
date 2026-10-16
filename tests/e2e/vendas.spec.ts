import { test, expect } from '@playwright/test';
import { login, expectHealthy, pick } from './helpers';

test('cria pedido pela interface, fatura e vê a NF-e autorizada', async ({ page }) => {
  await login(page);
  await page.goto('/vendas/novo');
  await expect(page.getByRole('heading', { name: 'Novo pedido de venda' })).toBeVisible();

  // Cliente (pessoa jurídica do seed) e um produto com estoque
  const customerField = page.locator('div', { has: page.locator('label', { hasText: /^Cliente \*$/ }) }).last();
  await pick(page, customerField.getByRole('button').first(), 'Boutique');
  const productTrigger = page.getByRole('button', { name: /Buscar produto/ }).first();
  await pick(page, productTrigger, 'Boné');
  await expect(page.locator('tfoot').getByText(/R\$\s*\d/).first()).toBeVisible();

  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.waitForURL(/\/vendas\/(?!novo)[^/]+$/);
  await expect(page.getByRole('heading', { name: /Pedido de venda nº \d+/ })).toBeVisible();

  const invoiced = page.waitForResponse((r) => r.url().includes('/invoice') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /Faturar \(emitir NF\)/ }).click();
  const res = await invoiced;
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = await res.json();
  expect(body.invoices?.[0]?.status).toBe('AUTORIZADA');
  await expect(page.getByText(/autorizada!/i).first()).toBeVisible();

  // Card "Notas fiscais" do pedido e a página da nota
  const link = page.locator('a[href^="/fiscal/notas/"]').first();
  await expect(link).toContainText('Autorizada');
  await link.click();
  await page.waitForURL(/\/fiscal\/notas\/[^/]+$/);
  await expectHealthy(page);
  await expect(page.getByText('Autorizada').first()).toBeVisible();
});
