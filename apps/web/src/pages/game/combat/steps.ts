import { movementLeft, type CombatState, type Participant } from '@dnd/rules';
import { useCallback, useEffect, useRef, type FocusEvent } from 'react';

// Stegene i turen (1 Bevegelse, 2 Bonus action, 3 Action, R Reaction): hva som er ledig, om steget er
// åpent, og hvordan siden går til et steg eller en boks.

export type StepTone = 'move' | 'bonus' | 'action' | 'reaction';

/** Hva som er ledig i turen. Brukes også til å lukke steg der ingenting kan velges. */
export function turnLeft(state: CombatState, p: Participant) {
  const t = p.turn;
  const mine = state.current === p.id && !p.defeated;
  return {
    move: mine && movementLeft(state, p.id) > 0,
    bonus: mine && t.bonus == null,
    action: mine && (t.action == null || (t.action === 'attack' && t.attacksLeft > 0)),
    reaction: !p.defeated && t.reaction == null,
  };
}

const USED_TEXT: Record<StepTone, string> = {
  move: 'Ingen bevegelse igjen',
  bonus: 'Bonus action er brukt',
  action: 'Action er brukt',
  reaction: 'Reaction er brukt. Du får den igjen når turen din starter.',
};

/** Props til et steg: åpent når noe kan velges, ellers lukket med grunnen. */
export function stepState(
  state: CombatState,
  p: Participant,
  step: StepTone,
): { open: boolean; closedText: string } {
  const open = turnLeft(state, p)[step];
  const closedText = p.defeated
    ? 'Ute av kampen'
    : step !== 'reaction' && state.current !== p.id
      ? 'Ikke turen ennå'
      : USED_TEXT[step];
  return { open, closedText };
}

/** Myk scrolling, men ikke for dem som har bedt om redusert bevegelse. */
function scrollBehavior(): ScrollBehavior {
  const reduce =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return reduce ? 'auto' : 'smooth';
}

/** Åpner steget (`data-step`) i panelet rundt `from`, scroller til det og flytter fokus til tittelen. */
export function goToStep(from: Element, step: StepTone): void {
  const el = from.closest('[data-panel]')?.querySelector(`[data-step="${step}"]`);
  const details = el?.querySelector('details');
  if (details) details.open = true;
  el?.scrollIntoView?.({ behavior: scrollBehavior(), block: 'start' });
  el?.querySelector('summary')?.focus({ preventScroll: true });
}

/** Det siste elementet som fikk fokus i siden, så en åpner kan finnes selv om den alt har mistet fokus. */
let lastFocusedEl: HTMLElement | null = null;
let trackingFocus = false;
function lastFocused(): HTMLElement | null {
  if (!trackingFocus && typeof document !== 'undefined') {
    trackingFocus = true;
    document.addEventListener('focusin', (e) => {
      if (e.target instanceof HTMLElement) lastFocusedEl = e.target;
    });
  }
  return lastFocusedEl;
}
if (typeof document !== 'undefined') lastFocused();

/** Fokus er borte: på `body`, på en knapp som er blitt `disabled`, eller inne i noe som er skjult (nettleseren slipper det litt senere). */
const isLost = () => {
  const a = document.activeElement;
  return (
    !a || a === document.body || (a as HTMLButtonElement).disabled === true || a.closest('[hidden]') != null
  );
};

/** Elementet som hadde fokus er borte fra siden, `disabled` eller skjult. */
const isGone = (el: HTMLElement) =>
  !el.isConnected || (el as HTMLButtonElement).disabled === true || el.closest('[hidden]') != null;

/**
 * Scroller til elementet når det dukker opp, f.eks. boksen for et angrep eller Help, og flytter
 * fokus dit, så tastatur og skjermleser havner i boksen. Forsvinner boksen, går fokus tilbake til
 * knappen som åpnet den. Den er ofte `disabled` mens boksen lukkes, så det prøves igjen etter
 * neste bilde, med tittelen på steget som siste utvei.
 */
export function useScrollIntoView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // React StrictMode (dev) kjører effekten to ganger; da er boksen selv allerede fokusert. Husk da den første åpneren.
    // Knappen kan ha mistet fokus allerede (den ble `disabled` i samme render), så bruk da den sist fokuserte.
    const active = document.activeElement;
    const candidate = active instanceof HTMLElement && active !== document.body ? active : lastFocused();
    if (candidate && candidate.isConnected && !el.contains(candidate)) {
      openerRef.current = candidate;
    }
    const opener = openerRef.current;
    const panelId = (opener ?? el).closest('[data-panel]')?.getAttribute('data-panel');
    const stepTone = (opener ?? el).closest('[data-step]')?.getAttribute('data-step');
    el.scrollIntoView?.({ behavior: scrollBehavior(), block: 'start' });
    el.tabIndex = -1;
    el.dataset.flow = '';
    el.focus({ preventScroll: true });
    return () => {
      if (!(isLost() || el.contains(document.activeElement))) return;
      // Åpneren er ofte `disabled` til neste render. Prøv i to bilder (før `useFocusRescue`), så steg-tittelen.
      const attempt = (triesLeft: number) => {
        if (!isLost()) return;
        if (opener?.isConnected && !isGone(opener)) {
          opener.focus({ preventScroll: true });
        } else if (triesLeft > 0) {
          requestAnimationFrame(() => attempt(triesLeft - 1));
        } else {
          document
            .querySelector<HTMLElement>(`[data-panel="${panelId}"] [data-step="${stepTone}"] summary`)
            ?.focus({ preventScroll: true });
        }
      };
      requestAnimationFrame(() => attempt(1));
    };
  }, []);
  return ref;
}

/**
 * Når knappen du trykket på forsvinner (Start kamp, Avslutt tur, OK på en d20 osv.), faller fokus til
 * `body`. Da flyttes det til det nærmeste naturlige målet: boksen du var i, tittelen på steget, tittelen
 * på panelet som nå er synlig, eller overskriften. Det skjer bare rett etter at brukeren selv har trykket
 * eller skrevet, så en endring fra en annen enhet aldri flytter fokus.
 */
export function useFocusRescue() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const last = useRef<{
    el: HTMLElement;
    panel: string | null;
    step: string | null;
    flow: Element | null;
  } | null>(null);
  const touched = useRef(0);
  const observer = useRef<MutationObserver | null>(null);
  const frame = useRef(0);

  const rescue = () => {
    const root = rootRef.current;
    const prev = last.current;
    if (!root || !prev || !isGone(prev.el) || !isLost()) return;
    let target: HTMLElement | null = null;
    if (prev.flow?.isConnected) target = prev.flow as HTMLElement;
    if (!target && prev.panel && prev.step) {
      target = root.querySelector<HTMLElement>(
        `[data-panel="${prev.panel}"]:not([hidden]) [data-step="${prev.step}"] summary`,
      );
    }
    target ??= root.querySelector<HTMLElement>('[data-panel]:not([hidden]) h2');
    target ??= root.querySelector<HTMLElement>('h1');
    if (target) {
      target.focus({ preventScroll: true });
    }
  };

  // Hver endring i siden kan ha fjernet knappen med fokus, også endringer som bare skjer i en
  // underkomponent. Derfor følger vi DOM-en i stedet for å vente på en ny render av denne siden.
  const ref = useCallback((el: HTMLDivElement | null) => {
    rootRef.current = el;
    observer.current?.disconnect();
    observer.current = null;
    if (!el || typeof MutationObserver === 'undefined') return;
    observer.current = new MutationObserver(() => {
      const prev = last.current;
      if (!prev || !isGone(prev.el) || !isLost() || Date.now() - touched.current > 4000) return;
      cancelAnimationFrame(frame.current);
      // Ett bilde senere, så en åpner som blir aktiv igjen (eller en boks som gjenoppretter fokus) rekker det først.
      frame.current = requestAnimationFrame(() => requestAnimationFrame(rescue));
    });
    observer.current.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden'],
    });
  }, []);

  const mark = () => {
    touched.current = Date.now();
  };
  return {
    ref,
    onPointerDownCapture: mark,
    onKeyDownCapture: mark,
    onFocusCapture: (e: FocusEvent<HTMLElement>) => {
      const t = e.target;
      const flow = t.closest('[data-flow]');
      // Boksene står ved siden av steget, ikke inni det. Husk steget knappen som åpnet boksen lå i.
      const step =
        t.closest('[data-step]')?.getAttribute('data-step') ?? (flow ? (last.current?.step ?? null) : null);
      last.current = {
        el: t,
        panel: t.closest('[data-panel]')?.getAttribute('data-panel') ?? null,
        step,
        flow,
      };
    },
  };
}
