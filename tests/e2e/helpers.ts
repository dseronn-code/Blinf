import { expect, type Page } from '@playwright/test';

/** Usuário de demonstração criado pelo seed (única conta da organização de demonstração) */
export const ADMIN = { email: 'teste123', password: 'senha123' };

/** Login pela tela (NextAuth credentials) e espera o painel carregar */
export async function login(page: Page, user = ADMIN) {
  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').first().fill(user.email);
  await page.locator('input[type="password"]').first().fill(user.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  await expect(page.getByText('Carregando GestãoPro…')).toHaveCount(0, { timeout: 60_000 });
}

/** Coleta erros de JavaScript não tratados da página */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Garante que a página renderizou sem a tela de erro do Next.js */
export async function expectHealthy(page: Page) {
  await expect(page.locator('body')).not.toContainText('Application error');
  await expect(page.locator('body')).not.toContainText('Unhandled Runtime Error');
  await expect(page.locator('body')).not.toContainText('This page could not be found');
}

/** Seleciona uma opção num EntityPicker (popover com busca) */
export async function pick(page: Page, trigger: ReturnType<Page['locator']>, search: string) {
  await trigger.click();
  const input = page.getByPlaceholder('Digite para buscar…');
  await input.fill(search);
  const option = page.locator('[data-radix-popper-content-wrapper] button').filter({ hasText: new RegExp(search, 'i') }).first();
  await option.waitFor();
  await option.click();
}
