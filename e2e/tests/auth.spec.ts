import { expect, test } from '@playwright/test';
import { devLogin, expectNoSeriousA11yIssues } from './helpers';

test.describe('Innlogging (med testmodus)', () => {
  test('utlogget bruker sendes til /logg-inn', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/logg-inn$/);
    await expect(page.getByRole('heading', { name: 'Kampguide', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Logg inn lokalt' })).toBeVisible();
    await expectNoSeriousA11yIssues(page);

    // Også en dypere adresse sendes til innlogging.
    await page.goto('/spill/1/kamp');
    await expect(page).toHaveURL(/\/logg-inn$/);
  });

  test('«Logg inn lokalt» (dev-login) gir Mine spill', async ({ page }) => {
    await page.goto('/logg-inn');
    await page.getByRole('button', { name: 'Logg inn lokalt' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Mine spill', level: 1 })).toBeVisible();
    await expectNoSeriousA11yIssues(page);
  });

  test('utlogging virker', async ({ page }) => {
    await devLogin(page);
    await page.getByRole('link', { name: 'Konto' }).click();
    await expect(page.getByRole('heading', { name: 'Konto', level: 1 })).toBeVisible();
    await expect(page.getByText('e2e@example.com')).toBeVisible();
    await expectNoSeriousA11yIssues(page);

    await page.getByRole('button', { name: 'Logg ut' }).click();
    await expect(page).toHaveURL(/\/logg-inn$/);

    // Økta er borte på serveren, ikke bare i skjermbildet.
    await page.goto('/');
    await expect(page).toHaveURL(/\/logg-inn$/);
    expect((await page.request.get('/api/me')).status()).toBe(401);
  });
});
