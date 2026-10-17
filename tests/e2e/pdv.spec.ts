import { test, expect } from '@playwright/test';
import { login, expectHealthy } from './helpers';

test('PDV: abre o caixa, vende e emite o cupom', async ({ page }) => {
  await login(page);
  await page.goto('/pdv');
  await expectHealthy(page);

  // Abre o caixa se ainda estiver fechado
  const open = page.getByRole('button', { name: 'Abrir caixa' });
  const scan = page.getByPlaceholder('Leia o código de barras ou digite SKU / nome do produto');
  await expect(open.or(scan)).toBeVisible();
  if (await open.isVisible()) {
    await page.locator('main input[type="number"]').first().fill('100');
    await open.click();
  }
  await expect(scan).toBeVisible();

  // Produto com estoque disponível (consulta pela API para escolher um SKU válido)
  const r = await page.request.get('/api/products?sellable=1&pageSize=50');
  const { rows } = await r.json();
  const product = rows.find((p: { kind?: string; price: number; stock?: { available?: number } }) => p.price > 0 && (p.stock?.available ?? 0) > 2 && p.kind !== 'KIT' && p.kind !== 'VARIACAO_PAI');
  expect(product, 'nenhum produto com estoque para vender').toBeTruthy();

  await scan.fill(product.sku);
  await scan.press('Enter');
  await expect(page.locator('tbody').getByText(product.name).first()).toBeVisible();

  const sale = page.waitForResponse((res) => res.url().endsWith('/api/pdv/sale') && res.request().method() === 'POST');
  await page.getByRole('button', { name: /Finalizar venda/ }).click();
  const res = await sale;
  expect(res.ok(), await res.text()).toBeTruthy();
  const done = await res.json();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Venda finalizada!' })).toBeVisible();
  await expect(dialog.getByText(/Pedido nº \d+/)).toBeVisible();
  await expect(dialog.getByText(/NFC-e nº \d+/)).toBeVisible();

  // Cupom (texto 80 colunas) da venda
  const orderId = done.order?.id;
  expect(orderId).toBeTruthy();
  const receipt = await page.request.get(`/api/pdv/receipt/${orderId}`);
  expect(receipt.ok()).toBeTruthy();
  const text = await receipt.text();
  expect(text).toContain('VALOR A PAGAR R$');
  expect(text).toContain(product.sku.slice(0, 9));
});
