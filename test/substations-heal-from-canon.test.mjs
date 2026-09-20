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

  it('the refresh script copies it from the endpoint', async () => {
    // ★2026-09-20 REWRITTEN FROM SOURCE-TEXT TO BEHAVIOUR. This asserted
    // /substations:\s*body\.substations/ and /'markets',\s*'substations'/ — two
    // literals from an implementation that named its fields one at a time.
    // That is exactly the implementation the drop-six bug lived in, so the
    // guard was pinning the shape that caused the problem: eligibility is now
    // decided by phrase SHAPE and substations qualifies like every other
    // quantity. Asking the module what it selects survives the next refactor
    // and is strictly stronger than grepping for a name.
    const { selectPhrases, quantityKeys } =
      await import('../scripts/refresh-canon-phrases.mjs');
    const body = { ok: true, source: 'x (live)', tools: 91,
      facilities: '22,900+', countries: '170+', deals: '2,200+',
      markets: '300+', substations: '127,000+' };
    const { fields, bad } = selectPhrases(body, null);
    expect(bad).toEqual([]);
    expect(fields.substations).toBe('127,000+');
    // and it must be in the change-detection key set, or an updated value is
    // fetched and then discarded as "already matches"
    expect(quantityKeys({ _meta: 1, retrieved_at: 'z', tools: 91, substations: '127,000+' }))
      .toContain('substations');
  });

  it('the sync refuses a snapshot without it', () => {
    // ★2026-09-20: substations moved into CANON_LAYERS when the grid layers
    // collapsed onto canon_phrases.json, so the literal this used to match
    // ("'countries', 'substations'") no longer exists. The BEHAVIOUR is proved
    // end-to-end in test/facts-collapsed-onto-canon.test.mjs, which doctors the
    // snapshot and asserts the CLI refuses; this stays as the cheap structural
    // check that the key is in the canon read at all.
    const src = read('scripts/sync-tools-manifest.mjs');
    expect(src).toMatch(/const CANON_LAYERS = \[[^\]]*'substations'/);
    expect(src).toMatch(/'countries',\s*\.\.\.CANON_LAYERS/);
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
  // ★2026-09-19: anchored to the server.mjs filter specifically. COVERAGE_ASSETS
  // now carries the same `q.label !== 'substation count'` clause for the same
  // reason, so the bare substring matches in two places and would keep passing
  // off the OTHER one if this exclusion were deleted.
  it('is excluded from the canon substation rule', () => {
    expect(read('scripts/sync-tools-manifest.mjs'))
      .toMatch(/'country count'\s*&&\s*q\.label !== 'substation count'/);
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
