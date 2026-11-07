import { expect, test } from '@playwright/test';
import { createGame, devLogin, expectNoSeriousA11yIssues, uniqueName } from './helpers';

test('dagbok med @ og # gir oppføringer i Kampanjebok, med søk', async ({ page }, testInfo) => {
  const suffix = Date.now().toString(36).replace(/\d/g, '');
  const person = `Brann${suffix}`;
  const place = `Fjellvakt${suffix}`;
  await devLogin(page);
  const gameId = await createGame(page, uniqueName('Dagbok', testInfo.project.name));

  await page.goto(`/spill/${gameId}/dagbok`);
  const editor = page.getByRole('combobox', { name: 'Hva skjedde i økta?' });
  await expect(editor).toBeVisible();
  await expectNoSeriousA11yIssues(page);

  // @ åpner autofullføring for personer, # for steder. «Opprett …» lager en ny oppføring.
  await editor.click();
  await editor.pressSequentially(`Vi møtte @${person}`);
  await page.getByRole('option', { name: `Opprett «${person}»` }).click();
  await editor.pressSequentially(' i #');
  await editor.pressSequentially(place);
  await page.getByRole('option', { name: `Opprett «${place}»` }).click();
  await editor.pressSequentially(' og fant ingenting.');
  await expect(editor).toHaveValue(new RegExp(`@${person}\\s+i #${place}\\s+og fant ingenting\\.`));

  // Vent til teksten er lagret: indikatoren sier «Lagret», og serveren har hele teksten med koblinger.
  // «Lagret» skjules etter 2,5 s, så sjekk teksten i DOM-en, ikke at den er synlig.
  await expect(page.getByText('Lagret', { exact: true })).toBeAttached();
  await expect
    .poll(async () => {
      const list = (await (await page.request.get(`/api/games/${gameId}/sessions`)).json()) as {
        sessions: { id: number }[];
      };
      const first = list.sessions[0];
      if (!first) return '';
      const one = (await (await page.request.get(`/api/sessions/${first.id}`)).json()) as {
        session: { body: string };
      };
      return one.session.body;
    })
    .toMatch(new RegExp(`@\\[${person}\\]\\(e:\\d+\\).*#\\[${place}\\]\\(e:\\d+\\).*og fant ingenting\\.`));
  await expectNoSeriousA11yIssues(page);

  // Kampanjebok: søket finner oppføringen (og økta der den er nevnt).
  await page.getByRole('link', { name: 'Kampanjebok' }).first().click();
  await expect(page.getByRole('heading', { name: 'Kampanjebok', level: 1 })).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Søk i boka' });
  await search.fill(person);
  await expect(page.getByRole('link', { name: new RegExp(`^${person}\\s+Person`) })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Økt 1/ })).toBeVisible();
  await search.fill('');

  // Stedet og personen står i oppslagsverket, og personen er «Nevnt i» økta.
  const categories = page.getByRole('navigation', { name: 'Kategorier' });
  await categories.getByRole('link', { name: /^Steder/ }).click();
  await expect(page.getByRole('link', { name: new RegExp(place) })).toBeVisible();
  await categories.getByRole('link', { name: /^Personer/ }).click();
  await page.getByRole('link', { name: new RegExp(person) }).click();
  const mentioned = page.getByRole('region', { name: 'Nevnt i' });
  await expect(mentioned).toContainText('Økt 1');
  await expectNoSeriousA11yIssues(page);
});
