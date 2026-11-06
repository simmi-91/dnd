import {
  KIND_TRIGGER,
  MENTION_KINDS,
  MENTION_LABEL_MAX,
  SUGGEST_LIMIT,
  type MentionTrigger,
} from '@dnd/shared';
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useSuggest } from '../api/campaign';
import { useDebounced } from '../pages/book/useDebounced';
import {
  applyTextChange,
  docPieces,
  findTrigger,
  fromStorage,
  insertMention,
  insertTrigger,
  toStorage,
  type EditorDoc,
} from './MentionEditorModel';
import styles from './MentionEditor.module.css';

const KIND_NAME = { person: 'person', place: 'sted', quest: 'quest' } as const;
const BUTTON_LABEL = { person: 'Person', place: 'Sted', quest: 'Quest' } as const;

interface MentionEditorProps {
  gameId: number;
  /** Teksten i lagringsformatet, med koblinger som `@[Brann](e:42)`. */
  value: string;
  onChange: (value: string) => void;
  /** ID-en til feltet, så en `<label htmlFor>` kan peke på det. */
  id?: string;
  placeholder?: string;
  rows?: number;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  /** Ekstra klasse på feltet med fargelaget, f.eks. for høyden. */
  className?: string;
}

type Option = { key: string; id: number; name: string } | { key: string; id: null; name: string };

/**
 * Skriveflate med koblinger. Et vanlig `textarea` (naturlig tastatur og markør på mobil) med et
 * fargelag bak som viser koblingene i farger: person grønn, sted blå, quest rød. `@`, `#` og `!`
 * åpner autofullføring ved markøren, med «Opprett «…»» for en ny oppføring. Endres teksten inni en
 * kobling, blir den vanlig tekst.
 */
export function MentionEditor({
  gameId,
  value,
  onChange,
  id,
  placeholder,
  rows = 6,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  className,
}: MentionEditorProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const listId = `${inputId}-forslag`;
  const hintId = `${inputId}-hint`;
  const ref = useRef<HTMLTextAreaElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<number | null>(null);

  const [doc, setDoc] = useState<EditorDoc>(() => fromStorage(value));
  const [source, setSource] = useState(value);
  const [caret, setCaret] = useState(() => fromStorage(value).text.length);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Ny verdi utenfra (svar fra serveren, «Bruk den andre»): bygg dokumentet på nytt.
  if (value !== source) {
    setSource(value);
    if (value !== toStorage(doc)) setDoc(fromStorage(value));
  }

  const trigger = focused ? findTrigger(doc, caret) : null;
  const open = trigger != null && trigger.index !== dismissed;
  const query = trigger?.query.trim() ?? '';
  const debounced = useDebounced(query, 150);
  const suggest = useSuggest(gameId, trigger?.kind ?? 'person', debounced, open);

  const options: Option[] = useMemo(() => {
    if (!open) return [];
    const found = (suggest.data ?? []).slice(0, SUGGEST_LIMIT);
    const list: Option[] = found.map((s) => ({ key: `e${s.id}`, id: s.id, name: s.name }));
    const lower = query.toLocaleLowerCase('nb');
    if (
      query !== '' &&
      query.length <= MENTION_LABEL_MAX &&
      !found.some((s) => s.name.toLocaleLowerCase('nb') === lower)
    ) {
      list.push({ key: 'new', id: null, name: query });
    }
    return list;
  }, [open, suggest.data, query]);
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));

  useLayoutEffect(() => {
    const el = ref.current;
    if (pendingCaret.current != null && el) {
      const c = pendingCaret.current;
      pendingCaret.current = null;
      el.focus();
      el.setSelectionRange(c, c);
    }
  });

  // Listen plasseres under linjen der tegnet står (målt i fargelaget).
  const triggerIndex = open && trigger ? trigger.index : null;
  useLayoutEffect(() => {
    const marker = markerRef.current;
    const wrap = wrapRef.current;
    if (triggerIndex == null || !marker || !wrap) {
      setPos(null);
      return;
    }
    const width = Math.min(288, wrap.clientWidth);
    const left = Math.max(0, Math.min(marker.offsetLeft, wrap.clientWidth - width));
    setPos({ top: marker.offsetTop + marker.offsetHeight + 4, left });
  }, [triggerIndex, doc.text]);

  function commit(next: EditorDoc, nextCaret: number, moveCaret: boolean) {
    setDoc(next);
    setCaret(nextCaret);
    const stored = toStorage(next);
    setSource(stored);
    if (moveCaret) pendingCaret.current = nextCaret;
    if (stored !== value) onChange(stored);
  }

  function choose(option: Option) {
    if (!trigger) return;
    const res = insertMention(
      doc,
      trigger,
      caret,
      option.name,
      option.id != null ? { id: option.id } : { new: true },
    );
    setDismissed(null);
    setActive(0);
    commit(res.doc, res.caret, true);
  }

  function addTrigger(t: MentionTrigger) {
    const el = ref.current;
    const from = el && focused ? el.selectionStart : caret;
    const to = el && focused ? el.selectionEnd : caret;
    const res = insertTrigger(doc, from, to, t);
    setDismissed(null);
    setActive(0);
    commit(res.doc, res.caret, true);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || !trigger) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setDismissed(trigger.index);
      return;
    }
    if (options.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((activeIndex + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((activeIndex - 1 + options.length) % options.length);
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option);
    }
  }

  const pieces = docPieces(doc);
  const optionId = (i: number) => `${inputId}-valg-${i}`;

  return (
    <div className={styles.editor}>
      <div ref={wrapRef} className={`${styles.wrap} ${className ?? ''}`}>
        <div className={styles.mirror} aria-hidden="true">
          {renderMirror(pieces, triggerIndex, markerRef)}
          {'​'}
        </div>
        <textarea
          ref={ref}
          id={inputId}
          className={styles.input}
          rows={rows}
          value={doc.text}
          placeholder={placeholder}
          spellCheck
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-activedescendant={open && options.length > 0 ? optionId(activeIndex) : undefined}
          aria-describedby={[hintId, describedBy].filter(Boolean).join(' ')}
          aria-invalid={invalid ? true : undefined}
          onChange={(e) => {
            const el = e.target;
            const next = applyTextChange(doc, el.value, el.selectionEnd);
            setActive(0);
            commit(next, el.selectionEnd, false);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionEnd)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <ul
          id={listId}
          role="listbox"
          aria-label={trigger ? `Forslag: ${KIND_NAME[trigger.kind]}` : 'Forslag'}
          className={styles.list}
          hidden={!open || options.length === 0}
          style={pos ? { top: pos.top, left: pos.left } : undefined}
          // Hindrer at feltet mister fokus (og tastaturet lukkes) før valget er registrert.
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.map((o, i) => (
            <li
              key={o.key}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              className={`${styles.option} ${i === activeIndex ? styles.optionOn : ''}`}
              onClick={() => choose(o)}
              onMouseMove={() => {
                if (i !== activeIndex) setActive(i);
              }}
            >
              {o.id != null ? (
                <>
                  <span className={styles[trigger?.kind ?? 'person']} aria-hidden="true">
                    {trigger ? KIND_TRIGGER[trigger.kind] : ''}
                  </span>
                  {o.name}
                </>
              ) : (
                <>Opprett «{o.name}»</>
              )}
            </li>
          ))}
        </ul>
      </div>
      <p id={hintId} className="visually-hidden">
        Skriv @ for en person, # for et sted eller ! for en quest, og velg fra listen med piltastene og Enter.
      </p>
      <div className={styles.buttons} role="group" aria-label="Sett inn kobling">
        {MENTION_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className={`${styles.trigger} ${styles[`btn_${k}`]}`}
            aria-label={`Sett inn ${KIND_NAME[k]} (${KIND_TRIGGER[k]})`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => addTrigger(KIND_TRIGGER[k])}
          >
            <span aria-hidden="true">
              {KIND_TRIGGER[k]} {BUTTON_LABEL[k]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function renderMirror(
  pieces: ReturnType<typeof docPieces>,
  markerAt: number | null,
  markerRef: RefObject<HTMLSpanElement | null>,
) {
  const out: ReactNode[] = [];
  let pos = 0;
  const marker = <span key="marker" ref={markerRef} className={styles.marker} />;
  for (const [i, p] of pieces.entries()) {
    const end = pos + p.text.length;
    if ('mention' in p) {
      if (markerAt === pos) out.push(marker);
      out.push(
        <span
          key={i}
          className={`${styles.mention} ${styles[p.mention.kind]} ${'new' in p.mention.ref ? styles.isNew : ''}`}
        >
          {p.text}
        </span>,
      );
    } else if (markerAt != null && markerAt >= pos && markerAt < end) {
      out.push(p.text.slice(0, markerAt - pos), marker, p.text.slice(markerAt - pos));
    } else {
      out.push(<span key={i}>{p.text}</span>);
    }
    pos = end;
  }
  return out;
}
