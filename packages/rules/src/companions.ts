// Følgesvenner som legges inn for hånd (finnes ikke i D&D Beyond), f.eks. en alliert NPC eller et dyr.
// Familiaren fra Find Familiar har egen type, se `familiar.ts`.

export interface Companion {
  id: string;
  name: string;
  kind?: string;
  ac?: number;
  hpMax?: number;
  /** Tapt HP. Brukes bare når `hpMax` er satt. */
  hpRemoved?: number;
  initiativeBonus: number;
  /** Kan følgesvennen angripe? Mangler feltet: ja. */
  canAttack?: boolean;
  /** Speed i fot. Mangler feltet: 30. */
  speed?: number;
  notes?: string;
}

/** Initiativbonusen til en følgesvenn. Ugyldige verdier blir 0. */
export function companionInitiativeBonus(c: Pick<Companion, 'initiativeBonus'>): number {
  const n = Number(c.initiativeBonus);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
