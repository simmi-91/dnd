import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { isBodyTooLong, journalPath, todayIso, useAppendToday } from '../../../api/campaign';
import { MentionEditor } from '../../../components/MentionEditor';
import { MentionText } from '../../../components/MentionText';
import { useGameContext } from '../GameContext';
import styles from './Combat.module.css';
import type { NoteState } from './noteState';

/**
 * Hurtignotat i kamp: tekst med `@ # !` som legges nederst i økta i dag. Feltet er alltid montert
 * (skjult, ikke fjernet), så halvskrevet tekst overlever fanebytte. Kamptilstanden røres ikke.
 */
export function QuickNote({
  note,
  fieldId,
  hideLabel = false,
}: {
  note: NoteState;
  fieldId?: string;
  hideLabel?: boolean;
}) {
  const { game } = useGameContext();
  const append = useAppendToday(game.id);
  const { text, setText, done, setDone } = note;
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const autoId = useId();
  const id = fieldId ?? autoId;
  const empty = text.trim() === '';

  function send() {
    if (sending.current || empty) return;
    sending.current = true;
    setError(null);
    const sent = text;
    append.mutate(
      { text: sent, playedOn: todayIso() },
      {
        onSuccess: (r) => {
          // Skriver brukeren videre mens svaret er på vei, beholdes det de har skrevet.
          setText((now) => (now === sent ? '' : now));
          setDone((d) => [{ number: r.session.number, text: sent.trim() }, ...d]);
        },
        onError: (err) =>
          setError(
            isBodyTooLong(err)
              ? (err as Error).message
              : 'Kunne ikke lagre notatet. Teksten er beholdt, prøv igjen.',
          ),
        onSettled: () => {
          sending.current = false;
        },
      },
    );
  }

  return (
    <div className={styles.stack}>
      <label htmlFor={id} className={hideLabel ? 'visually-hidden' : 'sc'}>
        Hurtignotat
      </label>
      <MentionEditor
        id={id}
        gameId={game.id}
        value={text}
        onChange={setText}
        rows={4}
        placeholder="Skriv et notat. @person, #sted, !quest"
      />
      <button type="button" className="btn" disabled={empty || append.isPending} onClick={send}>
        {append.isPending ? 'Lagrer …' : 'Legg til i økta i dag'}
      </button>
      {error && (
        <p role="alert" className={styles.noteError}>
          {error}
        </p>
      )}
      <div role="status">{done[0] && <p className="dim">Lagt til i økt {done[0].number}</p>}</div>
      {done.length > 0 && (
        <ul className={styles.plain} aria-label="Lagt til i denne kampen">
          {done.map((d, i) => (
            <li key={i}>
              <MentionText text={d.text} gameId={game.id} />
            </li>
          ))}
        </ul>
      )}
      <Link to={journalPath(game.id)}>Åpne dagboka</Link>
    </div>
  );
}

/**
 * Mobil og nettbrett: flytende knapp som åpner notatet i et ark. Åpnes info-skuffen, lukkes arket,
 * og knappen skjules mens skuffen står åpen. Escape lukker arket (forslagslista først), og fokus
 * går til feltet ved åpning og tilbake til knappen ved lukking.
 */
export function QuickNoteFab({ note, drawerOpen }: { note: NoteState; drawerOpen: boolean }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const fieldId = useId();
  const fabRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  if (drawerOpen && open) setOpen(false);

  useEffect(() => {
    if (open) document.getElementById(fieldId)?.focus();
    else if (wasOpen.current) fabRef.current?.focus();
    wasOpen.current = open;
  }, [open, fieldId]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        className={styles.fab}
        aria-label="Hurtignotat"
        aria-haspopup="dialog"
        hidden={drawerOpen || open}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">✎</span>
      </button>
      <section
        role="dialog"
        aria-labelledby={titleId}
        className={styles.noteSheet}
        hidden={!open}
        onKeyDown={onKeyDown}
      >
        <div className={styles.noteSheetHead}>
          <b id={titleId}>Hurtignotat</b>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setOpen(false)}>
            Lukk
          </button>
        </div>
        <QuickNote note={note} fieldId={fieldId} hideLabel />
      </section>
    </>
  );
}
