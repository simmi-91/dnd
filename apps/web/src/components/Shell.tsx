import { NavLink, Outlet, useMatch } from 'react-router';
import { useMe } from '../api/auth';
import { parseGameId, useGameName } from '../api/games';
import { NavIcon, type NavIconName } from './NavIcon';
import styles from './Shell.module.css';

interface NavItem {
  to: string;
  label: string;
  /** Kortere tekst i bunnmenyen på mobil. */
  short?: string;
  icon: NavIconName;
  end?: boolean;
}

const MAIN_ITEMS: NavItem[] = [
  { to: '/', label: 'Mine spill', short: 'Spill', icon: 'games', end: true },
  { to: '/konto', label: 'Konto', icon: 'account' },
];

// Kamp og Kampanjebok kommer i fase 3 og 4.
function gameItems(id: number): NavItem[] {
  return [
    { to: `/spill/${id}/ark`, label: 'Ark', icon: 'sheet' },
    { to: `/spill/${id}/folgesvenner`, label: 'Følgesvenner', short: 'Følge', icon: 'companions' },
    { to: '/', label: 'Mine spill', short: 'Spill', icon: 'games', end: true },
  ];
}

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? `${styles.link} ${styles.active}` : styles.link;
}

export function Shell() {
  const me = useMe();
  const firstName = me.data?.name.split(' ')[0];
  const match = useMatch('/spill/:gameId/*');
  const gameId = parseGameId(match?.params.gameId);
  const gameName = useGameName(gameId);
  const items = gameId != null ? gameItems(gameId) : MAIN_ITEMS;

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#innhold">
        Hopp til innholdet
      </a>
      <nav className={styles.nav} aria-label="Hovedmeny">
        <div className={styles.brand}>
          <span className={styles.brandTitle}>{gameId != null ? (gameName ?? 'Spill') : 'Kampguide'}</span>
          {gameId == null && firstName && <span className={styles.brandUser}>{firstName}</span>}
        </div>
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.end} className={navClass}>
                <span className={styles.icon}>
                  <NavIcon name={item.icon} />
                </span>
                <span className={styles.labelLong}>{item.label}</span>
                <span className={styles.labelShort} aria-hidden="true">
                  {item.short ?? item.label}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main id="innhold" className={styles.main} tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
