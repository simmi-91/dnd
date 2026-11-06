// Angrepsflyten med fysiske terninger: advantage og disadvantage, treff og krit, skadegrupper og
// teksten om Weapon Mastery. Ren utregning, uten tilstand.
import type { AttackKind, ExtraDamageDef } from './features.ts';
import { masteryOf } from './features.ts';
import { MASTERY_TEXT } from './derive.ts';

export type RollMode = 'advantage' | 'disadvantage' | 'normal';

/** Advantage og disadvantage opphever hverandre, uansett hvor mange kilder det er av hver. */
export function rollMode(advantage: readonly string[], disadvantage: readonly string[]): RollMode {
  if (advantage.length > 0 && disadvantage.length === 0) return 'advantage';
  if (disadvantage.length > 0 && advantage.length === 0) return 'disadvantage';
  return 'normal';
}

export const ROLL_HINT: Readonly<Record<RollMode, string>> = {
  advantage: 'Rull 2d20 og skriv inn den høyeste.',
  disadvantage: 'Rull 2d20 og skriv inn den laveste.',
  normal: 'Rull 1d20.',
};

export interface AttackOutcome {
  total: number;
  /** Naturlig 20: treffer alltid og går rett til skade. */
  crit: boolean;
  /** Naturlig 1: bom uansett. */
  fumble: boolean;
  /** Neste steg: rett til skade, bom, eller spør DM om det traff. */
  next: 'damage' | 'miss' | 'ask';
}

export function attackOutcome(nat: number, bonus: number): AttackOutcome {
  const crit = nat === 20;
  const fumble = nat === 1;
  return { total: nat + bonus, crit, fumble, next: crit ? 'damage' : fumble ? 'miss' : 'ask' };
}

/**
 * Sjekker et innskrevet kast: `count` terninger med `sides` sider, f.eks. 1d20 eller 2d6.
 * Gir norsk feilmelding, eller null når tallet er gyldig.
 */
export function validateRoll(value: number, count: number, sides: number): string | null {
  const min = count;
  const max = count * sides;
  const name = `En ${count === 1 ? '' : count}d${sides}`;
  if (!Number.isInteger(value) || value < min || value > max) return `${name} må være ${min}–${max}.`;
  return null;
}

/** Våpenet eller angrepet som gjør skade. Passer både `Weapon` og `PetAttack`. */
export interface DamageSource {
  name: string;
  count: number;
  sides: number;
  /** Skademodifikator (evne-mod + magic). */
  mod: number;
  /** Bare evne-moden. Mangler den, regnes hele `mod` som evne-mod. */
  abMod?: number;
  dmgType: string;
}

/**
 * Skademodifikatoren for ekstra-angrep fra Light, Nick og Cleave: ingen evnemodifikator, med mindre
 * den er negativ. Magic-bonusen beholdes.
 */
export function offhandMod(w: DamageSource): number {
  const ab = w.abMod ?? w.mod;
  return w.mod - ab + Math.min(0, ab);
}

/** Angrep som ikke får evnemodifikatoren på skaden. */
export const NO_ABILITY_MOD: ReadonlySet<AttackKind> = new Set<AttackKind>(['light', 'nick', 'cleave']);

export interface DamageGroup {
  key: string;
  label: string;
  count: number;
  sides: number;
  mod: number;
  dmgType: string;
  tone: ExtraDamageDef['tone'];
}

/**
 * Terninggruppene for skaden: våpenet og ekstra skade (Hunter's Mark, Dreadful Strike).
 * Ved krit dobles alle terningene, men modifikatoren legges bare til én gang.
 */
export function damageGroups(input: {
  weapon: DamageSource;
  attack: AttackKind;
  crit: boolean;
  extras?: readonly ExtraDamageDef[];
}): DamageGroup[] {
  const m = input.crit ? 2 : 1;
  const w = input.weapon;
  const mod = NO_ABILITY_MOD.has(input.attack) ? offhandMod(w) : w.mod;
  return [
    {
      key: 'weapon',
      label: w.name,
      count: w.count * m,
      sides: w.sides,
      mod,
      dmgType: w.dmgType,
      tone: 'none',
    },
    ...(input.extras ?? []).map((e) => ({
      key: e.id,
      label: e.label,
      count: e.count * m,
      sides: e.sides,
      mod: 0,
      dmgType: e.dmgType,
      tone: e.tone,
    })),
  ];
}

export interface DamagePart {
  key: string;
  label: string;
  rolled: number;
  mod: number;
  total: number;
  dmgType: string;
}

/** Summerer innskrevne terningsummer per gruppe. Ingen del går under 0. */
export function damageTotal(
  groups: readonly DamageGroup[],
  rolled: Readonly<Record<string, number>>,
): { parts: DamagePart[]; total: number; byType: Record<string, number> } {
  const parts = groups.map((g) => {
    const r = rolled[g.key] ?? 0;
    return {
      key: g.key,
      label: g.label,
      rolled: r,
      mod: g.mod,
      total: Math.max(0, r + g.mod),
      dmgType: g.dmgType,
    };
  });
  const byType: Record<string, number> = {};
  for (const p of parts) byType[p.dmgType] = (byType[p.dmgType] ?? 0) + p.total;
  return { parts, total: parts.reduce((s, p) => s + p.total, 0), byType };
}

/** Alle terningene på maks, for husregelen «krit mot monstrosity: all skade maks». */
export function maxRolls(groups: readonly DamageGroup[]): Record<string, number> {
  return Object.fromEntries(groups.map((g) => [g.key, g.count * g.sides]));
}

/**
 * Teksten om Weapon Mastery etter treff eller bom, med tallene i. Null hvis masteryen ikke gjelder.
 * Topple: DC = 8 + evne-mod + PB. Graze: skade lik evne-moden ved bom (ikke under 0).
 */
export function masteryNote(
  weapon: { mastery: string | null; abMod?: number; mod: number; dmgType: string },
  outcome: 'hit' | 'miss',
  pb: number,
): string | null {
  const id = masteryOf(weapon.mastery);
  if (!id || !weapon.mastery) return null;
  const ab = weapon.abMod ?? weapon.mod;
  if (id === 'graze') {
    return outcome === 'miss' && ab > 0 ? `Graze: bom, men målet tar likevel ${ab} ${weapon.dmgType}.` : null;
  }
  if (outcome === 'miss' || id === 'nick') return null;
  if (id === 'topple')
    return `Topple: målet må klare en CON save mot DC ${8 + ab + pb}, ellers blir det Prone.`;
  return `${weapon.mastery}: ${MASTERY_TEXT[weapon.mastery] ?? ''}`.trim();
}
