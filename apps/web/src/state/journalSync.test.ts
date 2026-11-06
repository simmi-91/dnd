import type { Session, SessionSaveResponse } from '@dnd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/client';
import { JournalSync, type JournalSyncOptions } from './journalSync';

const NOW = '2026-11-06T18:00:00.000Z';

function session(over: Partial<Session> = {}): Session {
  return {
    id: 5,
    gameId: 1,
    number: 7,
    playedOn: '2026-11-06',
    title: '',
    body: '',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function saved(s: Session): SessionSaveResponse {
  return { session: s, createdEntries: [] };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function make(over: Partial<JournalSyncOptions> = {}) {
  const opts: JournalSyncOptions = {
    initial: session(),
    create: vi.fn(),
    update: vi.fn((id, body) => Promise.resolve(saved(session({ id, ...body, version: body.version + 1 })))),
    get: vi.fn(() => Promise.resolve(session())),
    debounceMs: 700,
    retryMs: 5000,
    ...over,
  };
  return { sync: new JournalSync(opts), opts };
}

const conflict = (s: Session) =>
  new ApiRequestError(409, 'version_conflict', 'Økta ble endret', {
    error: 'version_conflict',
    message: 'Økta ble endret',
    session: s,
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('JournalSync', () => {
  it('lagrer 0,7 s etter siste endring, med versjonen', async () => {
    const { sync, opts } = make();
    sync.edit({ body: 'Hei' });
    await vi.advanceTimersByTimeAsync(500);
    sync.edit({ body: 'Hei der' });
    await vi.advanceTimersByTimeAsync(500);
    expect(opts.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(opts.update).toHaveBeenCalledTimes(1);
    expect(opts.update).toHaveBeenCalledWith(
      5,
      { title: '', playedOn: '2026-11-06', body: 'Hei der', version: 1 },
      { keepalive: false },
    );
    expect(sync.getSnapshot()).toMatchObject({ status: 'saved', session: { version: 2 } });
  });

  it('økta i dag opprettes ved første lagring, og deretter oppdateres den', async () => {
    const create = vi.fn(() => Promise.resolve(saved(session({ id: 9, number: 8, body: 'Første' }))));
    const { sync, opts } = make({ initial: null, initialDoc: { playedOn: '2026-11-06' }, create });
    expect(sync.getSnapshot().session).toBeNull();
    // Tom skriveflate lagres ikke.
    sync.edit({ body: '  ' });
    await vi.advanceTimersByTimeAsync(800);
    expect(create).not.toHaveBeenCalled();

    sync.edit({ body: 'Første' });
    await vi.advanceTimersByTimeAsync(800);
    expect(create).toHaveBeenCalledWith(
      { title: '', playedOn: '2026-11-06', body: 'Første' },
      { keepalive: false },
    );
    expect(sync.getSnapshot().session).toMatchObject({ id: 9, number: 8 });

    sync.edit({ body: 'Første og andre' });
    await vi.advanceTimersByTimeAsync(800);
    expect(create).toHaveBeenCalledTimes(1);
    expect(opts.update).toHaveBeenCalledWith(9, expect.objectContaining({ version: 1 }), {
      keepalive: false,
    });
  });

  it('tar inn serverens tekst med ID når brukeren ikke har skrevet videre', async () => {
    const update = vi.fn(() => Promise.resolve(saved(session({ body: 'Møtte @[Brann](e:42)', version: 2 }))));
    const { sync } = make({ update });
    sync.edit({ body: 'Møtte @[Brann](new)' });
    await vi.advanceTimersByTimeAsync(800);
    expect(sync.getSnapshot().doc.body).toBe('Møtte @[Brann](e:42)');
  });

  it('svaret med byttet (new) overskriver ikke tekst skrevet etterpå, og den sendes neste gang', async () => {
    const first = deferred<SessionSaveResponse>();
    const update = vi
      .fn<JournalSyncOptions['update']>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(saved(session({ body: 'Møtte @[Brann](e:42) i byen', version: 3 })));
    const { sync } = make({ update });
    sync.edit({ body: 'Møtte @[Brann](new)' });
    await vi.advanceTimersByTimeAsync(800);
    expect(update).toHaveBeenCalledTimes(1);

    sync.edit({ body: 'Møtte @[Brann](new) i byen' });
    first.resolve(saved(session({ body: 'Møtte @[Brann](e:42)', version: 2 })));
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.getSnapshot().doc.body).toBe('Møtte @[Brann](new) i byen');

    await vi.advanceTimersByTimeAsync(800);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1]?.[1]).toMatchObject({ body: 'Møtte @[Brann](new) i byen', version: 2 });
    expect(sync.getSnapshot().doc.body).toBe('Møtte @[Brann](e:42) i byen');
  });

  it('409 beholder teksten; «Behold min» lagrer på nytt med serverens versjon', async () => {
    const theirs = session({ body: 'Fra mobilen', version: 4 });
    const update = vi
      .fn<JournalSyncOptions['update']>()
      .mockRejectedValueOnce(conflict(theirs))
      .mockResolvedValueOnce(saved(session({ body: 'Min tekst', version: 5 })));
    const { sync } = make({ update });
    sync.edit({ body: 'Min tekst' });
    await vi.advanceTimersByTimeAsync(800);
    expect(sync.getSnapshot()).toMatchObject({
      status: 'error',
      conflict: { version: 4 },
      doc: { body: 'Min tekst' },
    });

    // Mens valget venter, lagres ingenting, og henting overskriver ikke.
    sync.edit({ body: 'Min tekst, mer' });
    await vi.advanceTimersByTimeAsync(800);
    await sync.refetch();
    expect(update).toHaveBeenCalledTimes(1);
    expect(sync.getSnapshot().doc.body).toBe('Min tekst, mer');

    sync.keepMine();
    await vi.advanceTimersByTimeAsync(0);
    expect(update.mock.calls[1]?.[1]).toMatchObject({ body: 'Min tekst, mer', version: 4 });
    expect(sync.getSnapshot()).toMatchObject({ conflict: null, status: 'saved' });
  });

  it('409: «Bruk den andre» bytter til serverens tekst', async () => {
    const theirs = session({ body: 'Fra mobilen', title: 'Vadet', version: 4 });
    const update = vi.fn<JournalSyncOptions['update']>().mockRejectedValueOnce(conflict(theirs));
    const { sync } = make({ update });
    sync.edit({ body: 'Min tekst' });
    await vi.advanceTimersByTimeAsync(800);
    sync.useTheirs();
    expect(sync.getSnapshot()).toMatchObject({
      conflict: null,
      status: 'saved',
      doc: { body: 'Fra mobilen', title: 'Vadet' },
      session: { version: 4 },
    });
    await vi.advanceTimersByTimeAsync(800);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('422 body_too_long viser meldingen og beholder teksten', async () => {
    const update = vi.fn<JournalSyncOptions['update']>().mockRejectedValueOnce(
      new ApiRequestError(422, 'body_too_long', 'Teksten er for lang.', {
        error: 'body_too_long',
        message: 'Teksten er for lang.',
        max: 100000,
      }),
    );
    const { sync } = make({ update });
    sync.edit({ body: 'Lang tekst' });
    await vi.advanceTimersByTimeAsync(6000);
    expect(update).toHaveBeenCalledTimes(1);
    expect(sync.getSnapshot()).toMatchObject({
      status: 'error',
      error: 'Teksten er for lang.',
      tooLong: true,
      doc: { body: 'Lang tekst' },
    });
  });

  it('henter på nytt bare når alt er lagret', async () => {
    const get = vi.fn(() => Promise.resolve(session({ body: 'Ny fra serveren', version: 2 })));
    const { sync } = make({ get });
    sync.edit({ body: 'Ulagret' });
    await sync.refetch();
    expect(get).not.toHaveBeenCalled();
    expect(sync.getSnapshot().doc.body).toBe('Ulagret');

    await vi.advanceTimersByTimeAsync(800);
    get.mockResolvedValueOnce(session({ body: 'Endret et annet sted', version: 5 }));
    await sync.refetch();
    expect(sync.getSnapshot().doc.body).toBe('Endret et annet sted');
  });

  it('sendNow bruker keepalive', async () => {
    const { sync, opts } = make();
    sync.edit({ body: 'Før fanen skjules' });
    sync.sendNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(opts.update).toHaveBeenCalledWith(5, expect.anything(), { keepalive: true });
  });

  it('slettet økt (404) beholder teksten, og kan lagres som ny', async () => {
    const update = vi
      .fn<JournalSyncOptions['update']>()
      .mockRejectedValueOnce(new ApiRequestError(404, 'not_found', 'Fant ikke økta'));
    const create = vi.fn(() => Promise.resolve(saved(session({ id: 11, body: 'Teksten min' }))));
    const { sync } = make({ update, create });
    sync.edit({ body: 'Teksten min' });
    await vi.advanceTimersByTimeAsync(800);
    expect(sync.getSnapshot()).toMatchObject({ gone: true, doc: { body: 'Teksten min' } });
    sync.saveAsNew();
    await vi.advanceTimersByTimeAsync(0);
    expect(create).toHaveBeenCalledTimes(1);
    expect(sync.getSnapshot()).toMatchObject({ gone: false, session: { id: 11 } });
  });
  it('sendNow under en pågående lagring sender den siste teksten med en gang, med neste versjon', async () => {
    const first = deferred<SessionSaveResponse>();
    const update = vi
      .fn<JournalSyncOptions['update']>()
      .mockReturnValueOnce(first.promise)
      .mockImplementation((id, body) =>
        Promise.resolve(saved(session({ id, ...body, version: body.version + 1 }))),
      );
    const { sync } = make({ update });
    sync.edit({ body: 'A' });
    await vi.advanceTimersByTimeAsync(800);
    expect(update).toHaveBeenCalledTimes(1);

    sync.edit({ body: 'AB' });
    sync.sendNow();
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1]?.[1]).toMatchObject({ body: 'AB', version: 2 });
    expect(update.mock.calls[1]?.[2]).toEqual({ keepalive: true });

    first.resolve(saved(session({ body: 'A', version: 2 })));
    await vi.advanceTimersByTimeAsync(800);
    expect(update).toHaveBeenCalledTimes(2);
    expect(sync.getSnapshot()).toMatchObject({
      status: 'saved',
      conflict: null,
      doc: { body: 'AB' },
      session: { version: 3 },
    });
  });

  it('en tom ny økt opprettes ikke når fanen skjules', async () => {
    const create = vi.fn();
    const { sync } = make({ initial: null, initialDoc: { playedOn: '2026-11-06' }, create });
    sync.edit({ title: ' ' });
    sync.sendNow();
    await vi.advanceTimersByTimeAsync(800);
    expect(create).not.toHaveBeenCalled();
  });

  it('før økta i dag opprettes: finnes en økt med datoen nå, legges teksten til i den', async () => {
    const found = session({ id: 8, body: 'Hurtignotat fra kampen.', title: 'Vadet', version: 2 });
    const findByDate = vi.fn(() => Promise.resolve(found));
    const create = vi.fn();
    const update = vi.fn<JournalSyncOptions['update']>((id, body) =>
      Promise.resolve(saved(session({ id, ...body, version: body.version + 1 }))),
    );
    const { sync } = make({
      initial: null,
      initialDoc: { playedOn: '2026-11-06' },
      create,
      update,
      findByDate,
    });
    sync.edit({ body: 'Min tekst.' });
    await vi.advanceTimersByTimeAsync(800);
    expect(findByDate).toHaveBeenCalledWith('2026-11-06');
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      8,
      {
        title: 'Vadet',
        playedOn: '2026-11-06',
        body: 'Hurtignotat fra kampen.\n\nMin tekst.',
        version: 2,
      },
      { keepalive: false },
    );
    expect(sync.getSnapshot()).toMatchObject({
      session: { id: 8, version: 3 },
      doc: { body: 'Hurtignotat fra kampen.\n\nMin tekst.' },
    });
  });

  it('finnes ingen økt med datoen, opprettes den; ved keepalive hoppes oppslaget over', async () => {
    const findByDate = vi.fn(() => Promise.resolve(null));
    const create = vi.fn(() => Promise.resolve(saved(session({ id: 9, body: 'Tekst' }))));
    const a = make({ initial: null, initialDoc: { playedOn: '2026-11-06' }, create, findByDate });
    a.sync.edit({ body: 'Tekst' });
    await vi.advanceTimersByTimeAsync(800);
    expect(findByDate).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);

    const b = make({ initial: null, initialDoc: { playedOn: '2026-11-06' }, create, findByDate });
    b.sync.edit({ body: 'Lukker fanen' });
    b.sync.sendNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(findByDate).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ body: 'Lukker fanen' }), {
      keepalive: true,
    });
  });
});
