import { expect, test, type Page } from '@playwright/test';
import { createGame, devLogin, expectNoSeriousA11yIssues, uniqueName } from './helpers';

interface CombatEnvelope {
  state: { round: number; participants: { name: string; hp: { removed: number } | null }[] };
}

/** Venter til serveren har lagret kampen, så en omlasting ikke kan tape noe. */
async function waitForSaved(page: Page, gameId: number, saved: (c: CombatEnvelope) => boolean) {
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/games/${gameId}/combat`);
      const body = (await res.json()) as { combat: CombatEnvelope | null };
      return body.combat != null && saved(body.combat);
    })
    .toBe(true);
}

test('en kamprunde fra start til runde 2, med omlasting midt i runden', async ({ page }, testInfo) => {
  await devLogin(page);
  const gameId = await createGame(page, uniqueName('Kamp', testInfo.project.name));
  await page.goto(`/spill/${gameId}/kamp`);
  await expectNoSeriousA11yIssues(page);

  // Start kamp, og sett initiativ for karakteren.
  await page.getByRole('button', { name: 'Start kamp' }).click();
  await expect(page.getByRole('heading', { name: 'Oppsett', level: 1 })).toBeVisible();
  await page.getByLabel(/^Initiativ d20 for Elowen/).fill('12');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByText('(d20 12)')).toBeVisible();

  // Legg til en fiende med initiativ, HP og AC.
  await page.getByText('Legg til fiende/NPC (valgfritt)').click();
  await page.getByLabel('Navn', { exact: true }).fill('Goblin');
  await page.getByLabel('Initiativ (total)').fill('8');
  await page.getByLabel('HP', { exact: true }).fill('20');
  await page.getByLabel('AC', { exact: true }).fill('13');
  await page.getByRole('button', { name: 'Legg til' }).click();
  await expect(page.getByText('Goblin', { exact: true })).toBeVisible();
  await expectNoSeriousA11yIssues(page);

  // Runde 1: karakteren har turen (initiativ 16 mot 8).
  await page.getByRole('button', { name: 'Start runde 1' }).click();
  await expect(page.getByRole('heading', { name: 'Runde 1', level: 1 })).toBeVisible();
  const tabs = page.getByRole('navigation', { name: 'Deltakere i initiativrekkefølge' });
  await expect(tabs.getByRole('button', { name: /^Elowen\b.*har turen/ })).toBeVisible();
  await expect(tabs.getByRole('button', { name: /^Goblin.*20 av 20 HP/ })).toBeVisible();
  await expectNoSeriousA11yIssues(page);

  // Ett angrep med langbue: treff (24 mot AC 13), 5 + 4 = 9 skade.
  await page.getByRole('button', { name: /^Angrip med Longbow/ }).click();
  const attack = page.getByRole('group', { name: 'Angrep med Longbow' });
  await attack.getByLabel('Mål (valgfritt)').selectOption({ label: 'Goblin' });
  await attack.getByLabel('Rull for å treffe').fill('15');
  await attack.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(attack).toContainText('Du fikk 24 for å treffe');
  await attack.getByRole('button', { name: 'Traff', exact: true }).click();
  await attack.getByLabel(/^Longbow: 1d8/).fill('5');
  await attack.getByRole('button', { name: 'Regn ut skade' }).click();
  await expect(attack.getByText('Total skade').locator('xpath=following-sibling::*[1]')).toHaveText('9');
  await attack.getByRole('button', { name: 'Trekk 9 HP fra Goblin' }).click();
  await expect(attack.getByRole('button', { name: 'Trukket fra' })).toBeDisabled();
  await attack.getByRole('button', { name: 'Ferdig' }).click();
  await expect(attack).toBeHidden();
  await expect(tabs.getByRole('button', { name: /^Goblin.*11 av 20 HP/ })).toBeVisible();

  // Last inn på nytt midt i runden: alt skal være med.
  await waitForSaved(page, gameId, (c) => {
    const goblin = c.state.participants.find((p) => p.name === 'Goblin');
    return c.state.round === 1 && goblin?.hp?.removed === 9;
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Runde 1', level: 1 })).toBeVisible();
  await expect(tabs.getByRole('button', { name: /^Elowen\b.*har turen/ })).toBeVisible();
  await expect(tabs.getByRole('button', { name: /^Goblin.*11 av 20 HP/ })).toBeVisible();
  await expect(page.getByText(/Skade: 9 piercing = 9/).first()).toBeAttached();
  await expect(page.getByRole('button', { name: /^● Angrep igjen: 1/ })).toBeVisible();
  await expectNoSeriousA11yIssues(page);

  // Avslutt turen for karakteren og så for fienden. Da er runden ferdig.
  await page.getByRole('button', { name: 'Avslutt tur', exact: true }).click();
  await expect(tabs.getByRole('button', { name: /^Goblin.*har turen/ })).toBeVisible();
  await page.getByRole('button', { name: 'Avslutt tur', exact: true }).click();
  await expect(page.getByText('Alle har spilt runde 1')).toBeVisible();
  await page.getByRole('button', { name: 'Start runde 2' }).click();
  await expect(page.getByRole('heading', { name: 'Runde 2', level: 1 })).toBeVisible();
  await expect(tabs.getByRole('button', { name: /^Elowen\b.*har turen/ })).toBeVisible();
  await expect(tabs.getByRole('button', { name: /^Goblin.*11 av 20 HP/ })).toBeVisible();

  await waitForSaved(page, gameId, (c) => c.state.round === 2);
});
