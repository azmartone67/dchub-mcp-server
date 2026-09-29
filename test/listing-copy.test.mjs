// canonical/listing-copy.json — the single source directory listings are written from.
//
// WHY (2026-09-28). Listing copy lived in several places at once: the Smithery
// description file, REGISTRY-LISTINGS.md, the backend white-glove paste blocks,
// the ecosystem-sync paste line. On 09-28 Glama, LobeHub, PulseMCP and
// mcpservers.org were reported "updated" while they still showed old copy. The
// fix starts with one file that an auto-sync can read, and rules it cannot break.
//
// This test pins:
//   - the schema (exactly the seven fields)
//   - the copy rules on every text field: no facility count, no monthly price,
//     no "$10 unlocks full answers", no "seven layers"
//   - glama_400 is at most 400 characters
//   - tool_count equals the canon snapshot AND the served /mcp tools/list set
//     (the trackedTool registrations in server.mjs, the same derivation
//     sync-tools-manifest uses) AND the registry manifests
//   - `long` is byte-equal to scripts/smithery_description.txt, so the file
//     Smithery is pushed from and this one cannot drift
//   - the heal engine and the daily job own the file, so a tool-count move heals it
// HARD GATE (test/hard-gate.txt): qualifies because it is offline and reads
// committed files only.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  LISTING_COPY_PATH, FIELDS, TEXT_FIELDS, GLAMA_MAX, PRICE_LINE, endpointsLine,
  copyRuleViolations, loadListingCopy, copyFingerprints, showsCurrentCopy,
} from '../scripts/listing-copy.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const COPY = JSON.parse(read(LISTING_COPY_PATH));
const CANON = JSON.parse(read('canonical/canon_phrases.json'));
const SERVER_JSON = JSON.parse(read('server.json'));
const MCP_SERVER_JSON = JSON.parse(read('mcp-server.json'));
const SERVER_SRC = read('server.mjs');
const SMITHERY_DESC = read('scripts/smithery_description.txt');
const SYNC = read('scripts/sync-tools-manifest.mjs');
const DAILY = read('.github/workflows/daily-manifest-sync.yml');

/** The tool names /mcp tools/list serves: every trackedTool(srv, 'name', ...)
 *  registration in server.mjs. Same regex shape as canonicalTools(). */
function servedToolNames(src) {
  return [...new Set([...src.matchAll(/trackedTool\(\s*srv\s*,\s*'([a-z_]+)'/g)].map((m) => m[1]))];
}

describe('schema', () => {
  it('has exactly the agreed fields (plus an optional $comment)', () => {
    const keys = Object.keys(COPY).filter((k) => k !== '$comment').sort();
    expect(keys).toEqual([...FIELDS].sort());
  });

  it('every text field is a non-empty single-line string', () => {
    for (const k of TEXT_FIELDS) {
      expect(typeof COPY[k], k).toBe('string');
      expect(COPY[k].trim().length, k).toBeGreaterThan(0);
      expect(COPY[k], k).not.toMatch(/\n/);
    }
  });

  it('updated_at is a YYYY-MM-DD date', () => {
    expect(COPY.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(COPY.updated_at))).toBe(false);
  });

  it('loadListingCopy() reads the committed file', () => {
    expect(loadListingCopy()).toEqual(COPY);
  });
});

describe('copy rules', () => {
  it.each(TEXT_FIELDS)('%s breaks no copy rule', (k) => {
    expect(copyRuleViolations(COPY[k])).toEqual([]);
  });

  it('glama_400 is at most 400 characters', () => {
    expect(COPY.glama_400.length).toBeLessThanOrEqual(GLAMA_MAX);
  });

  it('price_line is exactly the approved line', () => {
    expect(COPY.price_line).toBe('$10 one-time pack of 1,000 API credits');
    expect(COPY.price_line).toBe(PRICE_LINE);
  });

  it('glama_400 carries the price line; long names the $10 pack and its credits', () => {
    expect(COPY.glama_400).toContain(PRICE_LINE);
    expect(COPY.long).toMatch(/\$10 one-time pack/);
    expect(COPY.long).toMatch(/1,000 API credits/);
  });

  it('endpoints is exactly the approved line for the current tool count', () => {
    expect(COPY.endpoints).toBe(endpointsLine(COPY.tool_count));
    expect(COPY.endpoints).toBe('92 MCP tools at https://dchub.cloud/mcp plus a REST API at https://dchub.cloud/api/v1'
      .replace(/^\d+/, String(COPY.tool_count)));
    expect(COPY.long).toContain(COPY.endpoints);
    expect(COPY.glama_400).toContain(COPY.endpoints);
  });

  // Must-fail controls: the rules have to catch each banned shape, or the
  // green above is vacuous.
  it.each([
    ['facility_count', 'A map of 24,900+ facilities worldwide.'],
    ['facility_count', 'covers 25K+ data centers'],
    ['monthly_price', 'Pro is $99/mo.'],
    ['monthly_price', 'Developer $49 per month'],
    ['monthly_price', 'Starter ($9/month)'],
    ['ten_unlocks_full_answers', '$10 unlocks full answers for your agent.'],
    ['seven_layers', 'seven layers of infrastructure data'],
    ['seven_layers', '7 data layers'],
  ])('%s is caught in %j', (rule, text) => {
    expect(copyRuleViolations(text).map((v) => v.rule)).toContain(rule);
  });

  it('does not flag the approved copy shapes', () => {
    expect(copyRuleViolations('a $10 one-time pack of 1,000 API credits')).toEqual([]);
    expect(copyRuleViolations('live grid feeds from the seven US ISOs')).toEqual([]);
    expect(copyRuleViolations('scores 300+ markets daily')).toEqual([]);
  });
});

describe('tool_count is the served count', () => {
  const served = servedToolNames(SERVER_SRC);

  it('the served set was actually found', () => {
    expect(served.length).toBeGreaterThan(50);
  });

  it('equals the /mcp tools/list registrations in server.mjs', () => {
    expect(COPY.tool_count).toBe(served.length);
  });

  it('equals the canon snapshot', () => {
    expect(COPY.tool_count).toBe(Number(CANON.tools));
  });

  it('equals the registry manifests', () => {
    expect(COPY.tool_count).toBe(MCP_SERVER_JSON.tools.length);
    expect(COPY.tool_count)
      .toBe(SERVER_JSON._meta['io.modelcontextprotocol.registry/publisher-provided'].toolCount);
  });

  it('every "N tools" phrase in the copy says tool_count', () => {
    for (const k of TEXT_FIELDS) {
      for (const m of COPY[k].matchAll(/\b(\d+)(?: live| MCP| read-only)* tools\b/g)) {
        expect(Number(m[1]), `${k}: "${m[0]}"`).toBe(COPY.tool_count);
      }
    }
  });
});

describe('the Smithery description cannot drift from it', () => {
  it('long is byte-equal to scripts/smithery_description.txt (trimmed)', () => {
    expect(COPY.long).toBe(SMITHERY_DESC.trim());
  });

  it('short is the opening of long', () => {
    expect(COPY.long.startsWith(COPY.short)).toBe(true);
  });
});

describe('the heal engine owns it', () => {
  it('sync-tools-manifest heals its "N tools" phrases and its tool_count', () => {
    const loop = SYNC.slice(SYNC.indexOf("for (const f of ['smithery.yaml', 'README.md'"),
      SYNC.indexOf("'canonical/github_description.txt']) {") + 40);
    expect(loop).toContain(`'${LISTING_COPY_PATH}'`);
    expect(SYNC).toMatch(/listing-copy\.json[\s\S]{0,1500}tool_count/);
  });

  it('daily-manifest-sync stages it in $OWNED, so a heal is not discarded', () => {
    const owned = DAILY.match(/OWNED="([\s\S]*?)"/);
    expect(owned).toBeTruthy();
    expect(owned[1].split(/[\s\\]+/)).toContain(LISTING_COPY_PATH);
  });
});

describe('read-back fingerprints', () => {
  const fps = copyFingerprints(COPY);

  it('are derived from short / glama_400 / long', () => {
    expect(fps.length).toBeGreaterThan(0);
  });

  it('a page carrying the copy (re-wrapped, entity-encoded, truncated) matches', () => {
    const page = `<p>${COPY.glama_400.slice(0, 120).replace(/ /g, '\n  ').replace(/&/g, '&amp;')}…</p>`;
    expect(showsCurrentCopy(page, fps)).toBe(true);
  });

  it('a page carrying older copy does not', () => {
    expect(showsCurrentCopy('DC Hub: 92 tools, 24,500+ facilities. Pro $99/mo.', fps)).toBe(false);
    expect(showsCurrentCopy('anything', [])).toBe(false);
  });
});
