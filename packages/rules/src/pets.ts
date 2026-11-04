// Egne trekk på kjæledyr fra D&D Beyond (Extras). Trekkene lagres bare i appen.
import { ABILITIES } from './sheet.ts';
import type { Ability, AbilityMap, Pet, PetAttack } from './sheet.ts';
import { counterIds, modOf } from './util.ts';

export type PetTrait =
  | { id: string; kind: 'ability'; stat: Ability; delta: number }
  | { id: string; kind: 'attack' | 'damage' | 'ac' | 'hp' | 'speed'; delta: number }
  /** Krit mot monstrosity: all skade maks. */
  | { id: string; kind: 'maxCrit' }
  /** Må adlyde: Animal Handling mot DC før hver tur. */
  | { id: string; kind: 'obey'; dc: number }
  | { id: string; kind: 'note'; text: string };

export type PetTraitKind = PetTrait['kind'];

export interface AppliedPet {
  stats: Partial<AbilityMap<number>>;
  mod: AbilityMap<number>;
  attacks: PetAttack[];
  ac: number;
  hpMax: number;
  speeds: { id: number; speed: number }[];
  initiative: number;
  flags: { maxCrit: boolean; obey: number | null };
}

const ABILITY_RE = /([+-]\s*\d+)\s*(str|dex|con|int|wis|cha)\b/gi;

/** Lager start-trekk ut fra notatet i D&D Beyond. Brukes bare første gang kjæledyret dukker opp. */
export function seedPetTraits(
  notes: string | null | undefined,
  makeId: () => string = counterIds(),
): PetTrait[] {
  const n = String(notes ?? '');
  const traits: PetTrait[] = [];
  for (const m of n.matchAll(ABILITY_RE)) {
    traits.push({
      id: makeId(),
      kind: 'ability',
      stat: (m[2] ?? '').toLowerCase() as Ability,
      delta: parseInt((m[1] ?? '0').replace(/\s/g, ''), 10),
    });
  }
  if (/crit/i.test(n) && /monstros/i.test(n) && /max/i.test(n))
    traits.push({ id: makeId(), kind: 'maxCrit' });
  if (/animal handling/i.test(n)) traits.push({ id: makeId(), kind: 'obey', dc: 10 });
  return traits;
}

/**
 * Regner trekkene inn i statblokken. Endres STR- eller DEX-modifikatoren, endres treff og skade
 * på nærkamp- eller avstandsangrep like mye. CON endrer maks HP med endringen × antall hit dice.
 * AC endres bare av AC-trekk: statblokkens AC er naturlig rustning og følger ikke DEX.
 */
export function applyPetTraits(pet: Pet, traits: readonly PetTrait[] | null | undefined): AppliedPet {
  const stats: Partial<AbilityMap<number>> = { ...pet.stats };
  let atk = 0;
  let dmg = 0;
  let ac = 0;
  let hp = 0;
  let speed = 0;
  const flags: AppliedPet['flags'] = { maxCrit: false, obey: null };
  for (const t of traits ?? []) {
    switch (t.kind) {
      case 'ability': {
        const cur = stats[t.stat];
        if (cur != null) stats[t.stat] = cur + t.delta;
        break;
      }
      case 'attack':
        atk += t.delta;
        break;
      case 'damage':
        dmg += t.delta;
        break;
      case 'ac':
        ac += t.delta;
        break;
      case 'hp':
        hp += t.delta;
        break;
      case 'speed':
        speed += t.delta;
        break;
      case 'maxCrit':
        flags.maxCrit = true;
        break;
      case 'obey':
        flags.obey = t.dc || 10;
        break;
      case 'note':
        break;
    }
  }
  const delta = (a: Ability): number => modOf(stats[a] ?? 10) - modOf(pet.stats[a] ?? 10);
  const dStr = delta('str');
  const dDex = delta('dex');
  const dCon = delta('con');
  const mod = {} as AbilityMap<number>;
  for (const a of ABILITIES) mod[a] = modOf(stats[a] ?? 10);
  return {
    stats,
    mod,
    attacks: pet.attacks.map((a) => {
      const dA = a.melee ? dStr : dDex;
      return { ...a, hit: a.hit + dA + atk, mod: a.mod + dA + dmg };
    }),
    ac: pet.ac + ac,
    hpMax: pet.hpMax + dCon * pet.hitDice + hp,
    speeds: pet.speeds.map((s) => ({ id: s.id, speed: s.speed + speed })),
    initiative: pet.initiativeBonus + dDex,
    flags,
  };
}
