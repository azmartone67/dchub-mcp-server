// =============================================================================
// Every surface a registry reads must say DC Hub sources capacity.
// -----------------------------------------------------------------------------
// ★2026-09-16. Capacity Source shipped across 2.12.13-2.12.16 and the copy the
// registries actually read did not follow it. #436 fixed README.md and
// server.json; this pins the rest — the GitHub About text Glama re-derives its
// listing from, the Smithery listing body, the paste-ready blocks a human uses
// to repair a listing by hand, and mcp-server.json's top-level description.
//
// The failure this prevents is quiet: none of these files is executed, so
// nothing breaks when the line is dropped. The listing simply goes back to
// describing a DC Hub that has no capacity to offer, and the first evidence is
// a directory page nobody reads for weeks.
//
// Each assertion names a DIFFERENT file. A single "the repo mentions Capacity
// Source somewhere" grep would pass on README.md alone and prove nothing about
// the nine other surfaces.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const ABOUT = read('canonical/github_description.txt');
const SMITHERY = read('scripts/smithery_description.txt');
const LISTINGS = read('REGISTRY-LISTINGS.md');
const MANIFEST = JSON.parse(read('mcp-server.json'));
const SERVER_JSON = JSON.parse(read('server.json'));

describe('the GitHub About text (Glama re-derives its listing from it)', () => {
  it('names the tool that reaches Capacity Source', () => {
    expect(ABOUT).toContain('source_capacity');
  });

  it('still fits the 350-char ceiling the push step refuses past', () => {
    // ★ The refusal is `exit 0` with a warning — over the limit, the About
    // field silently stops updating and every listing mirroring it freezes.
    // The canon healer rewrites the quantities in this file, so this is the
    // guard standing between "21,900+ became 100,000+" and a dead sync.
    expect(ABOUT.trim().length).toBeLessThanOrEqual(350);
  });
});

describe('the Smithery listing body', () => {
  it('states the capability, the tool and the page', () => {
    expect(SMITHERY).toContain('Capacity Source');
    expect(SMITHERY).toContain('source_capacity');
    expect(SMITHERY).toContain('dchub.cloud/listings');
  });
});

describe('the paste-ready blocks a human repairs a listing with', () => {
  // Per-registry, because these are four separate copy blocks and a reader
  // pastes exactly one of them.
  //
  // ★ Scoped to the "(b) Tuned long descriptions" section FIRST. The file
  //   carries a SECOND set of `### Smithery` / `### Glama` / `### PulseMCP` /
  //   `### Cursor Directory` headings further up, under "Per-registry
  //   submission notes" — submission URLs and mechanics, not copy. Searching
  //   the file for a bare heading finds those instead, which is how the first
  //   version of this test failed against copy that was correctly in place.
  const TUNED = (() => {
    const i = LISTINGS.indexOf('## (b) Tuned long descriptions');
    expect(i, 'the tuned-descriptions section is gone').toBeGreaterThan(-1);
    const end = LISTINGS.indexOf('\n## ', i + 10);
    return LISTINGS.slice(i, end === -1 ? LISTINGS.length : end);
  })();

  const block = (heading) => {
    const i = TUNED.indexOf(heading);
    expect(i, `heading not found in the tuned section: ${heading}`).toBeGreaterThan(-1);
    const next = TUNED.indexOf('\n### ', i + heading.length);
    return TUNED.slice(i, next === -1 ? TUNED.length : next);
  };

  for (const heading of ['### Smithery', '### Glama', '### PulseMCP',
                         '### Cursor Directory']) {
    it(`${heading.slice(4)} copy names source_capacity`, () => {
      expect(block(heading)).toContain('source_capacity');
    });
  }

  it('the generic long description carries a Capacity Source coverage bullet', () => {
    expect(LISTINGS).toMatch(/- \*\*Capacity Source\*\* —/);
  });

  it('Capacity Source is in the headline-tools list an operator highlights', () => {
    const i = LISTINGS.indexOf('## Headline tools');
    const tools = LISTINGS.slice(i, LISTINGS.indexOf('\n## ', i + 10));
    expect(tools).toContain('`source_capacity`');
  });
});

describe('the manifests the registries ingest', () => {
  it('mcp-server.json description names Capacity Source, the tool and the page', () => {
    expect(MANIFEST.description).toContain('Capacity Source');
    expect(MANIFEST.description).toContain('source_capacity');
    expect(MANIFEST.description).toContain('dchub.cloud/listings');
  });

  it('server.json (the official-registry cascade source) still carries it', () => {
    // #436 spent the 100-char schema cap on this; a later edit reclaiming
    // those characters for something else would silently un-publish the
    // capability from PulseMCP, Glama and mcp.so, which all mirror it.
    expect(SERVER_JSON.description).toMatch(/off-market/i);
    expect(SERVER_JSON.description).toMatch(/capacity/i);
  });

  it('the Pro price is $99 and $299 appears on no published surface', () => {
    // The 2.12.11 note: mcp.so served "$299/mo Pro" seven times for months
    // after the reprice, because server.json's version had not moved.
    for (const [name, text] of [['mcp-server.json', MANIFEST.description],
                                ['github About', ABOUT],
                                ['smithery description', SMITHERY]]) {
      expect(text, `${name} quotes the retired $299 price`).not.toContain('$299');
    }
    expect(MANIFEST.description).toContain('$99/mo');
  });
});

describe('the canonical floors survive in the copy that carries them', () => {
  // The Capacity Source line must not have been paid for by dropping a floor.
  it('the About text still states tools, facilities, markets and deals', () => {
    const canon = JSON.parse(read('canonical/canon_phrases.json'));
    expect(ABOUT).toContain(`${canon.tools} tools`);
    expect(ABOUT).toContain(canon.facilities);
    expect(ABOUT).toContain(canon.markets);
    expect(ABOUT).toContain(canon.deals);
  });
});
