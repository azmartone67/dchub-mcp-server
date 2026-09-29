// frz-canon-facility-floor (owner decision 2026-09-29): canon `facilities` is
// held at 24,900+ until the corroborated "r3" count lands, while every other
// canon key keeps refreshing daily. canonical/canon_frozen.json is the list;
// scripts/canon-freeze.mjs is the rule. Hermetic: no network, no file writes.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { phrasesForSnapshot } from '../scripts/refresh-canon-phrases.mjs';
import { parseFrozen, readFrozen, applyFreeze, describeHeld } from '../scripts/canon-freeze.mjs';
import { repoDrift } from '../scripts/ecosystem-sync.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// A live body shaped like /api/v1/canon/phrases, with facilities ABOVE the
// frozen value and every other key moved too.
const LIVE = {
  ok: true, source: 'resolve_public_floors (live)', tools: 92,
  facilities: '25,000+', deals: '1,700+', markets: '310+', countries: '171+',
  substations: '135,000+', assets: '331,000+', fiber_routes: '59,000+',
  transmission_lines: '95,000+', dcpi_countries: '30+', news_sources: '2,000+',
  dcpi_regions: 'North America, Europe and Asia-Pacific',
};
const PREV = {
  tools: 92, facilities: '24,900+', deals: '1,600+', markets: '300+', countries: '170+',
  substations: '134,000+', assets: '330,000+', fiber_routes: '58,000+',
  transmission_lines: '94,000+', dcpi_countries: '30+', news_sources: '2,000+',
};
const FROZEN = {
  facilities: {
    id: 'frz-canon-facility-floor', value: '24,900+', reason: 'corroboration pending (r3)',
    since: '2026-09-29', lifts_when: 'corroborated r3 count lands', lifted_by: 'owner only',
  },
};

describe('refresh-canon-phrases holds a frozen key and refreshes the rest', () => {
  it('leaves a frozen key untouched when live is higher', () => {
    const { fields, bad, held } = phrasesForSnapshot(LIVE, PREV, FROZEN);
    expect(bad).toEqual([]);
    expect(fields.facilities).toBe('24,900+');
    expect(held).toEqual([expect.objectContaining({ key: 'facilities', value: '24,900+', live: '25,000+', aboveLive: false })]);
  });

  it('still updates every unfrozen key', () => {
    const { fields } = phrasesForSnapshot(LIVE, PREV, FROZEN);
    for (const k of ['deals', 'markets', 'countries', 'substations', 'assets', 'fiber_routes', 'transmission_lines']) {
      expect(fields[k], k).toBe(LIVE[k]);
    }
  });

  it('removing the freeze restores normal behaviour (live wins)', () => {
    const { fields, held } = phrasesForSnapshot(LIVE, PREV, {});
    expect(fields.facilities).toBe('25,000+');
    expect(held).toEqual([]);
    // and the default argument is the no-freeze behaviour
    expect(phrasesForSnapshot(LIVE, PREV).fields.facilities).toBe('25,000+');
  });

  it('a frozen key holds even when live stops publishing it', () => {
    const { facilities, ...noFac } = LIVE;
    const { fields, bad } = phrasesForSnapshot(noFac, PREV, FROZEN);
    expect(bad).toEqual([]);
    expect(fields.facilities).toBe('24,900+');
  });

  it('a live value BELOW the freeze is reported loudly, never failed', () => {
    const { fields, bad, held } = phrasesForSnapshot({ ...LIVE, facilities: '16,000+' }, PREV, FROZEN);
    expect(bad).toEqual([]);
    expect(fields.facilities).toBe('24,900+');
    expect(held[0].aboveLive).toBe(true);
    expect(describeHeld(held[0], 'r3')).toMatch(/^::warning::FROZEN facilities held at 24,900\+ \(live 16,000\+\)/);
    expect(describeHeld({ ...held[0], aboveLive: false })).not.toMatch(/::warning::/);
  });

  it('applyFreeze never mutates the body it is given', () => {
    const body = { ...LIVE };
    applyFreeze(body, FROZEN);
    expect(body.facilities).toBe('25,000+');
  });
});

describe('the freeze file', () => {
  it('a malformed entry is reported, never silently dropped into "unfrozen"', () => {
    expect(parseFrozen({ frozen: { facilities: { id: 'x', value: 'lots', reason: 'r', since: 's', lifts_when: 'l' } } }).bad).toHaveLength(1);
    expect(parseFrozen({ frozen: { facilities: { value: '24,900+' } } }).bad).toHaveLength(1);
    expect(parseFrozen({ frozen: [] }).bad).toHaveLength(1);
    expect(parseFrozen({ frozen: FROZEN })).toEqual({ frozen: FROZEN, bad: [] });
  });

  it('a missing file means nothing is frozen; unparseable JSON is bad', () => {
    // Read-only on purpose: no test here writes a file (smithery-canon-guard).
    expect(readFrozen(path.join(ROOT, 'canonical', 'no-such-freeze.json'))).toEqual({ frozen: {}, bad: [] });
    expect(readFrozen(path.join(ROOT, 'README.md')).bad).toHaveLength(1);
  });

  it('the committed freeze holds facilities at the committed snapshot value', () => {
    const { frozen, bad } = readFrozen();
    expect(bad).toEqual([]);
    expect(Object.keys(frozen)).toEqual(['facilities']);
    const e = frozen.facilities;
    expect(e.id).toBe('frz-canon-facility-floor');
    expect(e.value).toBe('24,900+');
    expect(e.value).toBe(readJson('canonical/canon_phrases.json').facilities);
    expect(e.reason).toMatch(/corroboration pending/);
    expect(e.lifts_when).toMatch(/r3/);
    expect(e.lifted_by).toBe('owner only');
  });
});

describe('canon floor checks treat a frozen key as intentional', () => {
  const serverJson = { _meta: { 'io.modelcontextprotocol.registry/publisher-provided': { toolCount: 92 } } };

  it('ecosystem-sync repoDrift does not count a frozen key as drift', () => {
    expect(repoDrift({ snapshot: PREV, canon: LIVE, serverJson, liveTools: 92, frozen: FROZEN }))
      .not.toContain('canon_phrases.json facilities 24,900+ -> 25,000+');
  });

  it('CONTROL: without the freeze the same difference IS drift', () => {
    expect(repoDrift({ snapshot: PREV, canon: LIVE, serverJson, liveTools: 92 }))
      .toContain('canon_phrases.json facilities 24,900+ -> 25,000+');
  });

  it('unfrozen keys are still drift with the freeze on', () => {
    expect(repoDrift({ snapshot: PREV, canon: LIVE, serverJson, liveTools: 92, frozen: FROZEN }))
      .toContain('canon_phrases.json deals 1,600+ -> 1,700+');
  });
});
