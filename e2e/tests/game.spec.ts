import { expect, test } from '@playwright/test';
import { devLogin, expectNoSeriousA11yIssues, fixtureJson, uniqueName } from './helpers';

test('nytt spill med innlimt JSON viser riktig ark', async ({ page }, testInfo) => {
  const name = uniqueName('Icewind Dale', testInfo.project.name);
  await devLogin(page);

  // På laptop åpnes skjemaet i en dialog, på mobil på en egen side.
  await page.getByRole('link', { name: '+ Nytt spill' }).click();
  await page.getByLabel('Navn på spillet').fill(name);
  await page.getByLabel('Lim inn JSON').check();
  await page.getByLabel('JSON fra D&D Beyond').fill(fixtureJson('lego-ranger-5'));
  await page.getByRole('button', { name: 'Forhåndsvis' }).click();

  const preview = page.getByRole('region', { name: 'Forhåndsvisning' });
  await expect(preview).toContainText('Hunter Ranger 5');
  await expect(preview.getByText(/^HP 39$/)).toBeVisible();
  await expect(preview.getByText(/^AC 18$/)).toBeVisible();
  await expect(preview.getByText(/^Nivå 5$/)).toBeVisible();
  await expectNoSeriousA11yIssues(page);

  await page.getByRole('button', { name: 'Lagre spillet' }).click();

  // Arket: HP, AC og Init fra karakteren.
  await expect(page).toHaveURL(/\/spill\/\d+\/ark$/);
  await expect(page.getByRole('heading', { name: 'Elowen, Lego D&D', level: 1 })).toBeVisible();
  const stat = (label: string) => page.getByRole('term').filter({ hasText: new RegExp(`^${label}$`) });
  await expect(stat('HP').locator('xpath=following-sibling::*[1]')).toHaveText('39/39');
  await expect(stat('AC').locator('xpath=following-sibling::*[1]')).toHaveText('18');
  await expect(stat('Init').locator('xpath=following-sibling::*[1]')).toHaveText('+4');
  await expect(page.getByRole('region', { name: 'Våpen' })).toContainText(/Longbow\s*\+9 · 1d8\+4 piercing/);
  await expectNoSeriousA11yIssues(page);

  // Spillet står i Mine spill.
  await page.getByRole('link', { name: 'Mine spill' }).first().click();
  await expect(page.getByRole('list', { name: 'Aktive spill' })).toContainText(name);
});
