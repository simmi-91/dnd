import { describe, expect, it } from 'vitest';
import { ELOWEN_ID, LEGO_ID, fakeDdb } from '../test/helpers.ts';
import { DDB_API, DDB_USER_AGENT, DdbError, createDdbClient, parseDdbRef, sheetFromRaw } from './client.ts';

function setup(opts: { cacheSeconds?: number; fetchesPerHour?: number } = {}) {
  const fake = fakeDdb();
  let t = 1_000_000;
  const client = createDdbClient({
    fetch: fake.fetch,
    now: () => t,
    cacheSeconds: opts.cacheSeconds ?? 300,
    fetchesPerHour: opts.fetchesPerHour ?? 10,
  });
  return { fake, client, tick: (ms: number) => (t += ms) };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof DdbError) return e.code;
    throw e;
  }
}

describe('parseDdbRef', () => {
  it.each([
    ['1000001', 1000001],
    ['  1000001 ', 1000001],
    ['https://www.dndbeyond.com/characters/1000001', 1000001],
    ['https://www.dndbeyond.com/characters/1000001/', 1000001],
    ['https://www.dndbeyond.com/characters/1000001/AbCdEf', 1000001],
    ['dndbeyond.com/characters/1000001?x=1#y', 1000001],
    ['www.dndbeyond.com/profile/player/characters/1000001', 1000001],
    [`${DDB_API}1000001`, 1000001],
  ])('godtar %s', (input, id) => {
    expect(parseDdbRef(input)).toBe(id);
  });

  it.each([
    [''],
    ['abc'],
    ['0'],
    ['-5'],
    ['https://example.com/characters/1000001'],
    ['https://dndbeyond.com.evil.no/characters/1000001'],
    ['https://www.dndbeyond.com/monsters/1000001'],
    ['1'.repeat(20)],
  ])('avviser %s', (input) => {
    expect(parseDdbRef(input)).toBeNull();
  });
});

describe('createDdbClient', () => {
  it('henter med tydelig User-Agent og regner ut arket', async () => {
    const { client, fake } = setup();
    const r = await client.fetchCharacter(1, 'https://www.dndbeyond.com/characters/1000001');
    expect(r.ddbId).toBe(ELOWEN_ID);
    expect(r.sheet.hpMax).toBe(40);
    expect(fake.calls).toEqual([`${DDB_API}${ELOWEN_ID}`]);
    expect(fake.headers[0]?.['User-Agent']).toBe(DDB_USER_AGENT);
  });

  it('bufrer per ID i cacheSeconds, og treff i bufferen teller ikke', async () => {
    const { client, fake, tick } = setup({ fetchesPerHour: 2 });
    await client.fetchCharacter(1, String(ELOWEN_ID));
    for (let i = 0; i < 5; i++) await client.fetchCharacter(1, String(ELOWEN_ID));
    // Bufferen deles mellom brukere, siden den er per ID.
    await client.fetchCharacter(2, String(ELOWEN_ID));
    expect(fake.calls).toHaveLength(1);
    tick(299_000);
    await client.fetchCharacter(1, String(ELOWEN_ID));
    expect(fake.calls).toHaveLength(1);
    tick(2_000);
    await client.fetchCharacter(1, String(ELOWEN_ID));
    expect(fake.calls).toHaveLength(2);
  });

  it('bufrer ikke når cacheSeconds er 0', async () => {
    const { client, fake } = setup({ cacheSeconds: 0 });
    await client.fetchCharacter(1, String(ELOWEN_ID));
    await client.fetchCharacter(1, String(ELOWEN_ID));
    expect(fake.calls).toHaveLength(2);
  });

  it('har en grense per bruker per time', async () => {
    const { client, fake, tick } = setup({ cacheSeconds: 0, fetchesPerHour: 3 });
    for (let i = 0; i < 3; i++) await client.fetchCharacter(1, String(LEGO_ID));
    const err = await client.fetchCharacter(1, String(LEGO_ID)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DdbError);
    expect((err as DdbError).code).toBe('ddb_rate_limited');
    expect((err as DdbError).retryAfterSeconds).toBe(3600);
    expect(fake.calls).toHaveLength(3);
    // En annen bruker har sin egen grense.
    expect(await codeOf(client.fetchCharacter(2, String(LEGO_ID)))).toBe('ok');
    tick(60 * 60 * 1000 + 1);
    expect(await codeOf(client.fetchCharacter(1, String(LEGO_ID)))).toBe('ok');
  });

  it('feil fra D&D Beyond teller også mot grensen', async () => {
    const { client, fake } = setup({ fetchesPerHour: 2 });
    fake.responses.set(5, 403);
    expect(await codeOf(client.fetchCharacter(1, '5'))).toBe('ddb_private');
    expect(await codeOf(client.fetchCharacter(1, '5'))).toBe('ddb_private');
    expect(await codeOf(client.fetchCharacter(1, '5'))).toBe('ddb_rate_limited');
  });

  it('samtidige forespørsler slipper ikke forbi grensen', async () => {
    const { client, fake } = setup({ cacheSeconds: 0, fetchesPerHour: 2 });
    const codes = await Promise.all(
      Array.from({ length: 6 }, () => codeOf(client.fetchCharacter(1, String(LEGO_ID)))),
    );
    expect(codes.filter((c) => c === 'ok')).toHaveLength(2);
    expect(codes.filter((c) => c === 'ddb_rate_limited')).toHaveLength(4);
    expect(fake.calls).toHaveLength(2);
  });

  it('405 og 429 fra D&D Beyond (struping) teller mot grensen', async () => {
    const { client, fake } = setup({ cacheSeconds: 0, fetchesPerHour: 2 });
    fake.responses.set(31, 405);
    fake.responses.set(32, 429);
    expect(await codeOf(client.fetchCharacter(1, '31'))).toBe('ddb_unavailable');
    expect(await codeOf(client.fetchCharacter(1, '32'))).toBe('ddb_unavailable');
    expect(await codeOf(client.fetchCharacter(1, '31'))).toBe('ddb_rate_limited');
  });

  it('User-Agent er ren ASCII (D&D Beyond svarer 400 ellers)', () => {
    expect(DDB_USER_AGENT).toMatch(/^[\x20-\x7e]+$/);
  });

  it('nettfeil og 5xx teller ikke mot grensen, og statusen følger med feilen', async () => {
    const { client, fake } = setup({ cacheSeconds: 0, fetchesPerHour: 1 });
    fake.responses.set(21, 503);
    fake.responses.set(22, new TypeError('fetch failed'));
    for (let i = 0; i < 3; i++) {
      const err = (await client.fetchCharacter(1, '21').catch((e: unknown) => e)) as DdbError;
      expect(err.code).toBe('ddb_unavailable');
      expect(err.upstreamStatus).toBe(503);
      const net = (await client.fetchCharacter(1, '22').catch((e: unknown) => e)) as DdbError;
      expect(net.code).toBe('ddb_unavailable');
      expect(net.upstreamStatus).toBeNull();
    }
    expect(await codeOf(client.fetchCharacter(1, String(ELOWEN_ID)))).toBe('ok');
    expect(await codeOf(client.fetchCharacter(1, String(ELOWEN_ID)))).toBe('ddb_rate_limited');
  });

  it('gir faste feilkoder for 403, 404, 5xx, nettfeil og ukjent format', async () => {
    const { client, fake } = setup({ cacheSeconds: 0, fetchesPerHour: 100 });
    fake.responses.set(11, 403);
    fake.responses.set(13, 500);
    fake.responses.set(14, new TypeError('fetch failed'));
    fake.responses.set(15, { success: true, data: { name: 'x' } });
    fake.responses.set(16, 'ikke json');
    expect(await codeOf(client.fetchCharacter(1, '11'))).toBe('ddb_private');
    expect(await codeOf(client.fetchCharacter(1, '12'))).toBe('ddb_not_found');
    expect(await codeOf(client.fetchCharacter(1, '13'))).toBe('ddb_unavailable');
    expect(await codeOf(client.fetchCharacter(1, '14'))).toBe('ddb_unavailable');
    expect(await codeOf(client.fetchCharacter(1, '15'))).toBe('ddb_format');
    expect(await codeOf(client.fetchCharacter(1, '16'))).toBe('ddb_format');
    expect(await codeOf(client.fetchCharacter(1, 'tull'))).toBe('ddb_invalid_ref');
  });

  it('ugyldig lenke teller ikke mot grensen', async () => {
    const { client, fake } = setup({ fetchesPerHour: 1 });
    expect(await codeOf(client.fetchCharacter(1, 'tull'))).toBe('ddb_invalid_ref');
    expect(await codeOf(client.fetchCharacter(1, String(ELOWEN_ID)))).toBe('ok');
    expect(fake.calls).toHaveLength(1);
  });
});

describe('sheetFromRaw', () => {
  it('finner ID-en i rådataene', () => {
    const fake = fakeDdb();
    const r = sheetFromRaw(fake.responses.get(LEGO_ID));
    expect(r.ddbId).toBe(LEGO_ID);
    expect(r.sheet.name).toBeTruthy();
  });

  it('kaster ddb_format for ukjent format', () => {
    expect(() => sheetFromRaw([1, 2])).toThrow(DdbError);
    expect(() => sheetFromRaw({ data: { stats: 'x' } })).toThrow(DdbError);
  });
});
