import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never {
  throw new Error('Kaboom');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('viser en rolig feilside med «Last inn på nytt» i stedet for en hvit side', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: 'Noe gikk galt' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Last inn på nytt' })).toBeTruthy();
    expect(screen.queryByText('Kaboom')).toBeNull();
  });

  it('viser innholdet når alt går bra', () => {
    render(
      <ErrorBoundary>
        <p>Alt i orden</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Alt i orden')).toBeTruthy();
  });
});
