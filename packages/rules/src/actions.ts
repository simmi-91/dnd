// Actionkatalogen fra 2024-reglene (UTVIKLINGSPLAN 7.2): kort norsk forklaring og hva den koster.

/** Hva et valg koster i turen. `part` er en del av en annen action (f.eks. Nick, Extra Attack). */
export type Cost = 'action' | 'bonus' | 'reaction' | 'free' | 'part';

export const COST_LABEL: Readonly<Record<Cost, string>> = {
  action: 'Action',
  bonus: 'Bonus action',
  reaction: 'Reaction',
  free: 'Gratis',
  part: 'Del av Action',
};

export const ACTION_IDS = [
  'attack',
  'dash',
  'disengage',
  'dodge',
  'help',
  'hide',
  'influence',
  'magic',
  'ready',
  'search',
  'study',
  'utilize',
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export interface ActionDef {
  id: ActionId;
  name: string;
  cost: Cost;
  /** Kort norsk forklaring. */
  text: string;
}

/** DC for Hide i 2024-reglene. */
export const HIDE_DC = 15;

export const ACTIONS: readonly ActionDef[] = [
  {
    id: 'attack',
    name: 'Attack',
    cost: 'action',
    text: 'Angrip med et våpen eller uten våpen. Med Extra Attack får du flere angrep i samme action, og du kan bevege deg mellom dem.',
  },
  {
    id: 'dash',
    name: 'Dash',
    cost: 'action',
    text: 'Du får like mye ekstra bevegelse som speeden din denne turen.',
  },
  {
    id: 'disengage',
    name: 'Disengage',
    cost: 'action',
    text: 'Bevegelsen din utløser ikke opportunity attacks resten av turen.',
  },
  {
    id: 'dodge',
    name: 'Dodge',
    cost: 'action',
    text: 'Til starten av din neste tur har angrep mot deg disadvantage (hvis du ser angriperen), og du har advantage på DEX saves. Virker ikke hvis du er incapacitated eller har speed 0.',
  },
  {
    id: 'help',
    name: 'Help',
    cost: 'action',
    text: 'Hjelp en alliert: advantage på neste ability check, eller på neste angrep mot en fiende innen 5 ft av deg. Varer til starten av din neste tur.',
  },
  {
    id: 'hide',
    name: 'Hide',
    cost: 'action',
    text: `Stealth mot DC ${HIDE_DC}. Du må være ute av syne (dekning eller tungt mørke). Klarer du det, er du skjult og får advantage på neste angrep.`,
  },
  {
    id: 'influence',
    name: 'Influence',
    cost: 'action',
    text: 'Prøv å få et vesen til å gjøre noe: Deception, Intimidation, Performance, Persuasion eller Animal Handling.',
  },
  {
    id: 'magic',
    name: 'Magic',
    cost: 'action',
    text: 'Kast en spell med casting time Action, bruk en magisk gjenstand eller en magisk evne.',
  },
  {
    id: 'ready',
    name: 'Ready',
    cost: 'action',
    text: 'Bestem en handling og hva som utløser den. Når det skjer, bruker du reaction på handlingen før neste tur din.',
  },
  {
    id: 'search',
    name: 'Search',
    cost: 'action',
    text: 'Se etter noe: en WIS-sjekk (Perception, Insight, Medicine eller Survival).',
  },
  {
    id: 'study',
    name: 'Study',
    cost: 'action',
    text: 'Tenk og husk: en INT-sjekk (Arcana, History, Investigation, Nature eller Religion).',
  },
  {
    id: 'utilize',
    name: 'Utilize',
    cost: 'action',
    text: 'Bruk en ikke-magisk gjenstand, f.eks. åpne en dør, tenne en fakkel eller drikke en potion.',
  },
];

export function actionDef(id: ActionId): ActionDef {
  const def = ACTIONS.find((a) => a.id === id);
  if (!def) throw new Error(`Ukjent action: ${id}`);
  return def;
}
