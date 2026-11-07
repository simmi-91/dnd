import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useFocusRescue, useScrollIntoView } from './steps';

afterEach(cleanup);

function Rescue() {
  const rescue = useFocusRescue();
  const [done, setDone] = useState(false);
  return (
    <div {...rescue}>
      <h1 tabIndex={-1}>Kamp</h1>
      <section data-panel="a">
        <h2 tabIndex={-1}>Elowen</h2>
        <section data-step="action">
          <details open>
            <summary>Action</summary>
            {!done && <button onClick={() => setDone(true)}>Fullfør</button>}
          </details>
        </section>
      </section>
    </div>
  );
}

describe('fokus i kampen', () => {
  it('flytter fokus til steg-tittelen når knappen forsvinner etter at brukeren har trykket', async () => {
    render(<Rescue />);
    const btn = screen.getByRole('button', { name: 'Fullfør' });
    fireEvent.pointerDown(btn);
    btn.focus();
    fireEvent.click(btn);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Action')));
  });

  it('flytter ikke fokus når knappen forsvinner uten at brukeren har gjort noe (annen enhet)', async () => {
    render(<Rescue />);
    const btn = screen.getByRole('button', { name: 'Fullfør' });
    btn.focus();
    // Ingen pointerdown eller tastetrykk: endringen kommer utenfra.
    fireEvent.click(btn);
    await new Promise((r) => setTimeout(r, 120));
    expect(document.activeElement).toBe(document.body);
  });
});

function Box({ onDone }: { onDone: () => void }) {
  const ref = useScrollIntoView<HTMLDivElement>();
  return (
    <div ref={ref} role="group" aria-label="Boks">
      <button onClick={onDone}>Avbryt</button>
    </div>
  );
}

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <section data-panel="a">
      <section data-step="action">
        <details open>
          <summary>Action</summary>
          <button disabled={open} onClick={() => setOpen(true)}>
            Åpne
          </button>
        </details>
      </section>
      {open && <Box onDone={() => setOpen(false)} />}
    </section>
  );
}

describe('boks som åpnes fra et steg', () => {
  it('fokuserer boksen, og går tilbake til åpneknappen når den er aktiv igjen', async () => {
    render(<Host />);
    const open = screen.getByRole('button', { name: 'Åpne' });
    open.focus();
    fireEvent.click(open);
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Boks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avbryt' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Åpne' })));
  });
});
