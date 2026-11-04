// Følgesvenner som legges inn for hånd (finnes ikke i D&D Beyond), f.eks. en ugle fra Find Familiar.

export interface Companion {
  id: string;
  name: string;
  kind?: string;
  ac?: number;
  hpMax?: number;
  initiativeBonus: number;
  notes?: string;
}

/** Initiativbonusen til en følgesvenn. Ugyldige verdier blir 0. */
export function companionInitiativeBonus(c: Pick<Companion, 'initiativeBonus'>): number {
  const n = Number(c.initiativeBonus);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
