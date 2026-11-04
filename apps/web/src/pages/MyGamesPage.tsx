import { useMe } from '../api/auth';
import { useDocumentTitle } from '../components/useDocumentTitle';
import styles from './MyGamesPage.module.css';

export function MyGamesPage() {
  useDocumentTitle('Mine spill');
  const me = useMe();
  const firstName = me.data?.name.split(' ')[0];

  return (
    <div className="page">
      <header className="page__head">
        <div className="sc">{firstName ? `Velkommen tilbake, ${firstName}` : 'Velkommen'}</div>
        <h1>Mine spill</h1>
      </header>
      <section className={`card card--dashed ${styles.empty}`} aria-labelledby="empty-title">
        <div className={styles.ornament} aria-hidden="true">
          ✦
        </div>
        <h2 id="empty-title" className="sc">
          Ingen spill ennå
        </h2>
        <p className="dim">
          Snart kan du legge inn et spill med en lenke til karakteren på D&amp;D Beyond. Hvert spill får sin
          egen kampguide og kampanjebok.
        </p>
      </section>
    </div>
  );
}
