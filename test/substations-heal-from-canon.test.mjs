// The substation count must be OWNED by canon, not hand-typed.
//
// MEASURED 2026-09-09. The endpoint has always published substations
// ("127,000+"), but scripts/refresh-canon-phrases.mjs copied only four fields,
// so nothing owned the number and four published surfaces drifted apart in
// THREE different formats:
//
//   README.md                              126,000+ substations
//   integrations/chatgpt/instructions.txt  126,000+ substations
//   smithery.yaml                          127,000  substations   (no "+")
//   mcp-server.json                        126,841  substations   (an EXACT
//                                                    count, stale on arrival)
//   canon                                  127,000+
//
// Four files, three formats, no two agreeing. A field the source publishes and
// the snapshot drops is a number nothing can heal — no amount of re-syncing a
// registry fixes it, because the repo itself never had the right value.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const SNAP = JSON.parse(read('canonical/canon_phrases.json'));

// Every surface that quotes the count in README prose style.
const PROSE_SURFACES = [
  'README.md',
  'integrations/chatgpt/instructions.txt',
  'smithery.yaml',
  'mcp-server.json',
];

const SUBS_RX = /(\d[\d,]*\+?)\s+substations\b/g;

describe('canon carries the substation count', () => {
  it('the snapshot has it, as a floor phrase', () => {
    expect(SNAP.substations, 'canon_phrases.json lost substations — the surfaces below stop healing')
      .toMatch(/^\d[\d,]*\+$/);
  });

  it('the refresh script copies it from the endpoint', () => {
    const src = read('scripts/refresh-canon-phrases.mjs');
    expect(src).toMatch(/substations:\s*body\.substations/);
    // and it must be in the change-detection key list, or an updated value is
    // fetched and then discarded as "already matches"
    expect(src).toMatch(/'markets',\s*'substations'/);
  });

  it('the sync refuses a snapshot without it', () => {
    const src = read('scripts/sync-tools-manifest.mjs');
    expect(src).toMatch(/'countries',\s*'substations'/);
  });
});

describe('every prose surface quotes canon', () => {
  it.each(PROSE_SURFACES)('%s', (f) => {
    const found = [...read(f).matchAll(SUBS_RX)].map((m) => m[1]);
    expect(found.length, `${f} no longer quotes a substation count — the rule is now unexercised here`)
      .toBeGreaterThan(0);
    for (const v of found) expect(v).toBe(SNAP.substations);
  });
});

describe('server.mjs keeps its own form', () => {
  // ASSET_QUANTITIES owns the count in server.mjs in the "127k" style it uses
  // throughout. If the canon rule were applied there too, two rules would match
  // one noun and fight on every run.
  it('is excluded from the canon substation rule', () => {
    expect(read('scripts/sync-tools-manifest.mjs'))
      .toMatch(/q\.label !== 'substation count'/);
  });

  it('still states the count in k-form in live code', () => {
    const live = read('server.mjs')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(live).toMatch(/\d{2,3}k substations\b/);
  });

  // control: the assertion above must be able to fail
  it('control — the k-form matcher is not vacuous', () => {
    expect(/\d{2,3}k substations\b/.test('no counts here')).toBe(false);
  });
});
