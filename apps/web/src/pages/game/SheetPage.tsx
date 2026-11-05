import { ABILITIES, currentHp, type Ability, type Sheet, type Skill, type Spell } from '@dnd/rules';
import { hpTone, sign } from '../../components/format';
import { useDocumentTitle } from '../../components/useDocumentTitle';
import { useGameContext } from './GameContext';
import { HpPanel } from './HpPanel';
import { RefreshPanel } from './RefreshPanel';
import { ResourcesPanel } from './ResourcesPanel';
import { RestPanel } from './RestPanel';
import styles from './Sheet.module.css';

const AB_LABEL: Record<Ability, string> = {
  str: 'STR',
  dex: 'DEX',
  con: 'CON',
  int: 'INT',
  wis: 'WIS',
  cha: 'CHA',
};

/** Evner som bare er overskrifter i D&D Beyond, og som ikke trenger å vises. */
const HIDDEN_FEATURES = /^Core .* Traits$|Subclass$|Ability Score Improvement$/;

/** Proficiency bonus for et totalnivå. */
const pbFor = (level: number) => 2 + Math.floor((Math.max(1, level) - 1) / 4);

export function SheetPage() {
  const { game, sheet, sync } = useGameContext();
  useDocumentTitle(`${sheet.name} · ${game.name}`);
  return (
    <div className="page">
      <SheetHeader />
      <div className={styles.columns}>
        <div className={styles.column}>
          <HpPanel />
          <ResourcesPanel />
          <RestPanel />
          <Weapons sheet={sheet} />
          <Spells sheet={sheet} />
        </div>
        <div className={styles.column}>
          <Abilities sheet={sheet} />
          <Skills sheet={sheet} />
          <Features sheet={sheet} />
          <NextLevel sheet={sheet} />
          <RefreshPanel game={game} sync={sync} />
        </div>
      </div>
    </div>
  );
}

function SheetHeader() {
  const { game, sheet, sync } = useGameContext();
  const hp = currentHp(sync.state, sheet);
  const race = sheet.lineage ?? sheet.race;
  return (
    <header className={`page__head ${styles.head}`}>
      <div className="sc">{game.name}</div>
      <h1>{sheet.name}</h1>
      <p className={styles.sub}>
        {[race, sheet.summary].filter(Boolean).join(' · ')}
        {sheet.classes.length <= 1 && ` · nivå ${sheet.level}`}
      </p>
      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt>HP</dt>
          <dd className="tabular">
            <span data-tone={hpTone(hp, sheet.hpMax)} className={styles.toneText}>
              {hp}
            </span>
            /{sheet.hpMax}
            {sync.state.tempHp > 0 && <span className={styles.tempSmall}> +{sync.state.tempHp} temp</span>}
          </dd>
        </div>
        <div className={styles.stat}>
          <dt>AC</dt>
          <dd className="tabular">{sheet.ac}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Init</dt>
          <dd className="tabular">{sign(sheet.initiative)}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Speed</dt>
          <dd className="tabular">{sheet.speed} ft</dd>
        </div>
        <div className={styles.stat}>
          <dt>Darkvision</dt>
          <dd className="tabular">{sheet.darkvision > 0 ? `${sheet.darkvision} ft` : '–'}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Passiv Perc.</dt>
          <dd className="tabular">{sheet.passive.perception}</dd>
        </div>
      </dl>
    </header>
  );
}

function Abilities({ sheet }: { sheet: Sheet }) {
  return (
    <section className={`card ${styles.panel}`} aria-labelledby="ab-title">
      <h2 id="ab-title" className="sc">
        Evneverdier og saves
      </h2>
      <ul className={styles.abilities}>
        {ABILITIES.map((a) => {
          const save = sheet.saves[a];
          return (
            <li key={a} className={styles.ability}>
              <span className={styles.abLabel}>{AB_LABEL[a]}</span>
              <span className={`${styles.abMod} tabular`}>{sign(sheet.mod[a])}</span>
              <span className="dim tabular">{sheet.scores[a]}</span>
              <span className={`tabular ${save.prof ? styles.prof : 'dim'}`}>
                save {sign(save.bonus)}
                {save.prof && (
                  <>
                    <span aria-hidden="true"> ●</span>
                    <span className="visually-hidden"> (proficient)</span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="dim tabular">
        Proficiency bonus {sign(sheet.pb)}
        {sheet.spellDc != null && ` · Spell save DC ${sheet.spellDc}`}
        {sheet.spellAttack != null && ` · Spell attack ${sign(sheet.spellAttack)}`}
      </p>
    </section>
  );
}

function profMark(k: Skill) {
  if (k.prof === 2) return { mark: '◆', text: 'expertise' };
  if (k.prof === 1) return { mark: '●', text: 'proficient' };
  if (k.prof === 0.5) return { mark: '½', text: 'halv proficiency' };
  return null;
}

function Skills({ sheet }: { sheet: Sheet }) {
  return (
    <section className={`card ${styles.panel}`} aria-labelledby="skills-title">
      <h2 id="skills-title" className="sc">
        Skills
      </h2>
      <ul className={styles.skills}>
        {sheet.skills.map((k) => {
          const m = profMark(k);
          return (
            <li key={k.key} className={`${styles.skill} ${m ? styles.prof : ''}`}>
              <span>
                <span className={styles.mark} aria-hidden="true">
                  {m?.mark ?? ''}
                </span>
                {k.name} <span className="dim">{AB_LABEL[k.ab]}</span>
                {m && <span className="visually-hidden"> ({m.text})</span>}
              </span>
              <span className="tabular">{sign(k.bonus)}</span>
            </li>
          );
        })}
      </ul>
      <p className="dim">● proficient · ◆ expertise</p>
    </section>
  );
}

function Weapons({ sheet }: { sheet: Sheet }) {
  if (sheet.weapons.length === 0) return null;
  return (
    <section className={`card ${styles.panel}`} aria-labelledby="weapons-title">
      <h2 id="weapons-title" className="sc">
        Våpen
      </h2>
      {sheet.attacksPerAction > 1 && (
        <p className="dim">Extra Attack: {sheet.attacksPerAction} angrep per Attack action.</p>
      )}
      <ul className={styles.rows}>
        {sheet.weapons.map((w) => (
          <li key={w.key} className={styles.weapon}>
            <div className={styles.weaponHead}>
              <b>{w.name}</b>
              <span className="tabular">
                <span className={styles.hit}>{sign(w.hit)}</span> · {w.count}d{w.sides}
                {w.mod !== 0 && sign(w.mod)} {w.dmgType}
              </span>
            </div>
            <div className="dim">
              {w.range}
              {w.light && ' · Light'}
              {w.thrown && ' · Thrown'}
              {w.heavy && ' · Heavy'}
            </div>
            {w.mastery && (
              <div className={styles.mastery}>
                <span className={styles.masteryName}>Mastery: {w.mastery}</span>
                {w.masteryText && <span className="dim"> – {w.masteryText}</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function spellTags(sp: Spell): string {
  const tags: string[] = [];
  if (sp.concentration) tags.push('konsentrasjon');
  if (sp.ritual) tags.push('ritual');
  if (sp.free > 0) tags.push(`${sp.free} gratis`);
  return tags.join(' · ');
}

function Spells({ sheet }: { sheet: Sheet }) {
  if (sheet.spells.length === 0) return null;
  const levels = [...new Set(sheet.spells.map((s) => s.level))].sort((a, b) => a - b);
  return (
    <section className={`card ${styles.panel}`} aria-labelledby="spells-title">
      <h2 id="spells-title" className="sc">
        Spells
      </h2>
      {levels.map((l) => (
        <div key={l} className={styles.group}>
          <h3 className={styles.groupTitle}>
            {l === 0 ? 'Cantrips' : `Nivå ${l}`}
            {l > 0 && sheet.slots[l] ? <span className="dim tabular"> · {sheet.slots[l]} slots</span> : null}
          </h3>
          <ul className={styles.rows}>
            {sheet.spells
              .filter((s) => s.level === l)
              .map((sp) => (
                <li key={`${sp.source}-${sp.name}`} className={styles.spell}>
                  <b>{sp.name}</b>
                  {spellTags(sp) && <span className="dim"> {spellTags(sp)}</span>}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Features({ sheet }: { sheet: Sheet }) {
  const list = sheet.features.filter((f) => !HIDDEN_FEATURES.test(f.name));
  return (
    <section className={`card ${styles.panel}`} aria-labelledby="features-title">
      <h2 id="features-title" className="sc">
        Evner
      </h2>
      <ul className={styles.rows}>
        {list.map((f) => (
          <li key={`${f.cls}-${f.name}-${f.level}`}>
            <details className={styles.feature}>
              <summary>
                <b>{f.name}</b>{' '}
                <span className="dim">
                  {f.cls} {f.level}
                </span>
              </summary>
              <p className={styles.desc}>{f.desc || 'Ingen beskrivelse.'}</p>
            </details>
          </li>
        ))}
      </ul>
      {sheet.feats.length > 0 && <p className="dim">Feats: {sheet.feats.join(', ')}</p>}
    </section>
  );
}

function NextLevel({ sheet }: { sheet: Sheet }) {
  const nextClassLevel = sheet.classLevel + 1;
  const pbNext = pbFor(sheet.level + 1);
  const next = sheet.upcoming.filter((f) => f.cls === sheet.cls && f.level === nextClassLevel);
  const later = sheet.upcoming.filter((f) => !next.includes(f));
  const slotLevels = [...new Set([...Object.keys(sheet.slots), ...Object.keys(sheet.nextSlots)])]
    .map(Number)
    .filter((l) => (sheet.nextSlots[l] ?? 0) !== (sheet.slots[l] ?? 0))
    .sort((a, b) => a - b);
  const fixed = Math.floor(sheet.hitDie / 2) + 1 + sheet.mod.con;

  return (
    <section className={`card ${styles.panel} ${styles.next}`} aria-labelledby="next-title">
      <h2 id="next-title" className="sc">
        Hva skjer på neste nivå
      </h2>
      <p>
        {sheet.cls} {nextClassLevel}:
      </p>
      <ul className={styles.list}>
        <li className="tabular">
          HP: +1d{sheet.hitDie} {sign(sheet.mod.con)} (eller fast {fixed})
        </li>
        {pbNext > sheet.pb && (
          <li>Proficiency bonus går til {sign(pbNext)}: angrep, saves, skills og spell DC går opp med 1.</li>
        )}
        {slotLevels.map((l) => (
          <li key={l} className="tabular">
            Spell slots nivå {l}: {sheet.slots[l] ?? 0} → {sheet.nextSlots[l] ?? 0}
          </li>
        ))}
        {next.map((f) => (
          <li key={`${f.cls}-${f.name}`}>
            <details className={styles.feature}>
              <summary>
                <b>{f.name}</b>
              </summary>
              <p className={styles.desc}>{f.desc || 'Ingen beskrivelse.'}</p>
            </details>
          </li>
        ))}
      </ul>
      {later.length > 0 && (
        <p className="dim">Senere: {later.map((f) => `${f.name} (${f.cls} ${f.level})`).join(', ')}</p>
      )}
      <p className="dim">
        Gå opp i nivå på D&amp;D Beyond først, og trykk så «Oppdater fra D&amp;D Beyond». Da regnes arket ut
        på nytt.
      </p>
    </section>
  );
}
