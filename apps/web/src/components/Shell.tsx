import { NavLink, Outlet } from 'react-router';
import { useMe } from '../api/auth';
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

// Kamp, Ark, Følgesvenner og Kampanjebok hører til et valgt spill og kommer i fase 2–4.
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Mine spill', short: 'Spill', icon: 'games', end: true },
  { to: '/konto', label: 'Konto', icon: 'account' },
];

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? `${styles.link} ${styles.active}` : styles.link;
}

export function Shell() {
  const me = useMe();
  const firstName = me.data?.name.split(' ')[0];

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#innhold">
        Hopp til innholdet
      </a>
      <nav className={styles.nav} aria-label="Hovedmeny">
        <div className={styles.brand}>
          <span className={styles.brandTitle}>Kampguide</span>
          {firstName && <span className={styles.brandUser}>{firstName}</span>}
        </div>
        <ul className={styles.list}>
          {NAV_ITEMS.map((item) => (
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
