import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Anonymisert D&D Beyond-svar fra `packages/rules/fixtures`. Ingenting hentes fra nettet. */
export function fixtureJson(name: 'elowen-4' | 'lego-ranger-5'): string {
  const raw = readFileSync(
    resolve(import.meta.dirname, `../../packages/rules/fixtures/${name}.json`),
    'utf8',
  );
  // Komprimert: en lang tekst på én linje fyller inn raskt, utpent JSON gjør textarea-en tung å tegne.
  return JSON.stringify(JSON.parse(raw));
}

/** Et navn som er unikt for denne testen, så testene kan dele database og bruker. */
export function uniqueName(base: string, projectName: string): string {
  return `${base} ${projectName} ${Date.now().toString(36)}`;
}

/**
 * Logger inn med den eksisterende dev-login-veien (`/api/auth/dev-login`, bare når `DEV_LOGIN_EMAIL`
 * er satt og aldri i produksjon).
 */
export async function devLogin(page: Page): Promise<void> {
  await page.goto('/api/auth/dev-login');
  await expect(page.getByRole('heading', { name: 'Mine spill', level: 1 })).toBeVisible();
}

/** Lager et spill via API-et (raskt oppsett). Selve skjemaet testes i game.spec.ts. */
export async function createGame(
  page: Page,
  name: string,
  fixture: 'elowen-4' | 'lego-ranger-5' = 'lego-ranger-5',
): Promise<number> {
  const res = await page.request.post('/api/games', {
    headers: { 'x-requested-with': 'dnd' },
    data: { name, json: fixtureJson(fixture), cover: 'frost' },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { game: { id: number } }).game.id;
}

/** axe-sjekk: feiler på serious og critical. Minor og moderate (f.eks. `aria-allowed-role`) godtas. */
export async function expectNoSeriousA11yIssues(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    serious.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    })),
    'axe: serious/critical brudd',
  ).toEqual([]);
}
