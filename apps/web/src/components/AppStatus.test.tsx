import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { reportRequest } from '../offline/connectivity';
import { OfflineBadge } from './AppStatus';

afterEach(() => {
  cleanup();
  reportRequest(true);
});

describe('OfflineBadge', () => {
  it('har et status-område i DOM-en også når nettet er oppe, så endringen blir lest opp', () => {
    render(<OfflineBadge />);
    expect(screen.getByRole('status').textContent).toBe('');
    act(() => reportRequest(false));
    expect(screen.getByRole('status').textContent).toContain('Uten nett');
    act(() => reportRequest(true));
    expect(screen.getByRole('status').textContent).toBe('');
  });
});
