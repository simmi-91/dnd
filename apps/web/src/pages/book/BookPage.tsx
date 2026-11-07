import type { EntryKind } from '@dnd/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  BOOK_TABS,
  bookPath,
  isNotFound,
  journalPath,
  KIND_TAB,
  useEntries,
  useEntry,
  type BookTab,
} from '../../api/campaign';
import { parseGameId } from '../../api/games';
import { errorMessage } from '../../components/errorMessage';
import { ErrorState, Loading } from '../../components/States';
import { useDocumentTitle } from '../../components/useDocumentTitle';
import { useMediaQuery } from '../../components/useMediaQuery';
import { useGameBase } from '../game/GameContext';
import { EntryDetail } from './EntryDetail';
import { EntryForm } from './EntryForm';
import { EntryList } from './EntryList';
import { SearchResults } from './SearchResults';
import { SessionList } from './SessionList';
import { parseKind, parseTab, TAB_KIND, TAB_LABEL, type EntryLookup } from './labels';
import { useDebounced } from './useDebounced';
import styles from './Book.module.css';

/** Fra 1100 px står lista og detaljkortet side om side. Under det er detaljkortet egen visning. */
const SPLIT_QUERY = '(min-width: 1100px)';

/**
 * `/spill/:gameId/bok` og `/spill/:gameId/bok/:entryId`: oppslagsverket. Fanen ligger i `?fane=`,
 * `?ny=<type>` åpner skjemaet for en ny oppføring og `?rediger=1` skjemaet for den valgte.
 */
export function BookPage() {
  const game = useGameBase();
  const gameId = game.id;
  useDocumentTitle(`Kampanjebok · ${game.name}`);
  const split = useMediaQuery(SPLIT_QUERY);
  const { entryId: rawId } = useParams();
  const [params] = useSearchParams();
  const entryId = rawId === undefined ? null : (parseGameId(rawId) ?? -1);
  const tab = parseTab(params.get('fane'));
  const newKind = params.has('ny')
    ? (parseKind(params.get('ny')) ?? TAB_KIND[tab === 'okter' ? 'quester' : tab])
    : null;
  const editing = params.get('rediger') === '1';

  const entries = useEntries(gameId);
  const lookup: EntryLookup = useMemo(
    () => new Map((entries.data?.entries ?? []).map((e) => [e.id, e])),
    [entries.data],
  );

  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), 300);
  const searching = search.trim() !== '';
  const [showArchived, setShowArchived] = useState(false);

  const detailOpen = entryId != null || newKind != null;
  const listPath = `${bookPath(gameId)}?fane=${tab}`;
  const showList = split || !detailOpen;
  const showDetail = split || detailOpen;

  // Åpnes eller byttes oppføringen (ikke ved første lasting), flytter fokus til overskriften eller det første
  // feltet i skjemaet. Lukkes detaljvisningen på mobil, går fokus til overskriften over lista.
  const listHeadRef = useRef<HTMLHeadingElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const detailKey = `${entryId}|${newKind}|${editing}`;
  const prevKey = useRef(detailKey);
  useEffect(() => {
    if (prevKey.current === detailKey) return;
    prevKey.current = detailKey;
    if (!detailOpen) {
      if (!split) listHeadRef.current?.focus({ preventScroll: true });
      return;
    }
    const el = detailRef.current;
    if (!el) return;
    const tryFocus = () => {
      const t =
        el.querySelector<HTMLElement>('form input, form select, form textarea') ??
        el.querySelector<HTMLElement>('#entry-name, h2');
      t?.focus({ preventScroll: true });
      return t != null;
    };
    if (tryFocus()) return;
    // Oppføringen hentes fra serveren, så vent til den er på plass.
    const mo = new MutationObserver(() => {
      if (tryFocus()) mo.disconnect();
    });
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [detailKey, detailOpen, split]);

  return (
    <div className={`${styles.layout} ${split ? styles.split : ''}`}>
      {showList && (
        <section className={styles.listCol} aria-label="Oppslagsverk">
          <header className={styles.head}>
            <div className="sc">{game.name}</div>
            <h1 ref={listHeadRef} tabIndex={-1}>
              Kampanjebok
            </h1>
            <Link className={`btn btn--ghost btn--small ${styles.journalLink}`} to={journalPath(gameId)}>
              Dagbok
            </Link>
          </header>

          <input
            className="input"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Søk i boka"
            placeholder="Søk i quester, personer, steder, økter …"
          />

          {searching ? (
            query === '' ? null : (
              <SearchResults gameId={gameId} q={query} />
            )
          ) : (
            <>
              <nav aria-label="Kategorier">
                <ul className={styles.tabs}>
                  {BOOK_TABS.map((t) => {
                    const count = t === 'okter' ? undefined : entries.data?.counts[TAB_KIND[t]];
                    return (
                      <li key={t}>
                        <Link
                          to={`${bookPath(gameId)}?fane=${t}`}
                          className={`${styles.pill} ${t === tab ? styles.pillOn : ''}`}
                          aria-current={t === tab ? 'page' : undefined}
                        >
                          {TAB_LABEL[t]}
                          {count != null && (
                            <>
                              {' '}
                              <span className={styles.count}>{count}</span>
                            </>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              {tab === 'okter' ? (
                <SessionList gameId={gameId} />
              ) : (
                <KindList
                  gameId={gameId}
                  kind={TAB_KIND[tab]}
                  tab={tab}
                  selectedId={entryId}
                  lookup={lookup}
                  showArchived={showArchived}
                  onShowArchived={setShowArchived}
                  entries={entries}
                />
              )}
            </>
          )}
        </section>
      )}

      {showDetail && (
        <div ref={detailRef} className={styles.detailCol}>
          {!showList && <h1 className="visually-hidden">Kampanjebok</h1>}
          {newKind != null ? (
            <EntryForm
              key={`ny-${newKind}`}
              gameId={gameId}
              initialKind={newKind}
              lookup={lookup}
              cancelTo={listPath}
            />
          ) : entryId != null ? (
            <EntryPane
              key={entryId}
              gameId={gameId}
              entryId={entryId}
              editing={editing}
              lookup={lookup}
              backTo={split ? undefined : listPath}
            />
          ) : (
            <p className="card dim">Velg en oppføring i lista, eller lag en ny.</p>
          )}
        </div>
      )}
    </div>
  );
}

interface KindListProps {
  gameId: number;
  kind: EntryKind;
  tab: BookTab;
  selectedId: number | null;
  lookup: EntryLookup;
  showArchived: boolean;
  onShowArchived: (v: boolean) => void;
  entries: ReturnType<typeof useEntries>;
}

function KindList({
  gameId,
  kind,
  tab,
  selectedId,
  lookup,
  showArchived,
  onShowArchived,
  entries,
}: KindListProps) {
  if (entries.isPending) return <Loading label="Henter oppføringene …" />;
  if (entries.isError && !entries.data) {
    return (
      <ErrorState
        title="Fikk ikke hentet oppføringene"
        message={errorMessage(entries.error)}
        onRetry={() => void entries.refetch()}
        retrying={entries.isFetching}
      />
    );
  }
  const all = (entries.data?.entries ?? []).filter((e) => e.kind === kind);
  const items = all.filter((e) => showArchived || !e.archived);
  const archivedCount = all.filter((e) => e.archived).length;

  return (
    <>
      {items.length === 0 ? (
        <p className="card dim">
          {archivedCount > 0 && !showArchived
            ? 'Alt her er arkivert.'
            : `Ingen ${TAB_LABEL[tab].toLowerCase()} ennå.`}
        </p>
      ) : (
        <EntryList
          gameId={gameId}
          label={TAB_LABEL[tab]}
          items={items}
          lookup={lookup}
          selectedId={selectedId}
        />
      )}
      {archivedCount > 0 && (
        <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => onShowArchived(e.target.checked)} />
          Vis arkiverte ({archivedCount})
        </label>
      )}
      <Link className="btn" to={`${bookPath(gameId)}?fane=${KIND_TAB[kind]}&ny=${kind}`}>
        + Ny oppføring
      </Link>
    </>
  );
}

interface EntryPaneProps {
  gameId: number;
  entryId: number;
  editing: boolean;
  lookup: EntryLookup;
  backTo?: string;
}

function EntryPane({ gameId, entryId, editing, lookup, backTo }: EntryPaneProps) {
  const detail = useEntry(entryId > 0 ? entryId : null);
  const missing = (
    <div className="card">
      <h2 tabIndex={-1}>Fant ikke oppføringen</h2>
      <p className="dim">Den kan være slettet, eller lenken er feil.</p>
      <Link className="btn" to={backTo ?? bookPath(gameId)}>
        Til oppslagsverket
      </Link>
    </div>
  );
  if (entryId < 0) return missing;
  if (detail.isPending) return <Loading label="Henter oppføringen …" />;
  if (!detail.data) {
    if (isNotFound(detail.error)) return missing;
    return (
      <ErrorState
        title="Fikk ikke hentet oppføringen"
        message={errorMessage(detail.error)}
        onRetry={() => void detail.refetch()}
        retrying={detail.isFetching}
      />
    );
  }
  const { entry, mentionedIn } = detail.data;
  if (entry.gameId !== gameId) return missing;
  if (editing) {
    return (
      <EntryForm
        key={entry.id}
        gameId={gameId}
        entry={entry}
        lookup={lookup}
        cancelTo={`${bookPath(gameId)}/${entry.id}?fane=${KIND_TAB[entry.kind]}`}
      />
    );
  }
  return (
    <EntryDetail gameId={gameId} entry={entry} mentionedIn={mentionedIn} lookup={lookup} backTo={backTo} />
  );
}
