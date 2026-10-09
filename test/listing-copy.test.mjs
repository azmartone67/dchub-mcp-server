// canonical/listing-copy.json — the single source directory listings are written from.
//
// WHY (2026-09-28). Listing copy lived in several places at once: the Smithery
// description file, REGISTRY-LISTINGS.md, the backend white-glove paste blocks,
// the ecosystem-sync paste line. On 09-28 Glama, LobeHub, PulseMCP and
// mcpservers.org were reported "updated" while they still showed old copy. The
// fix starts with one file that an auto-sync can read, and rules it cannot break.
//
// This test pins:
//   - the schema (exactly the nine fields; capacity_blurb and tagline added 2026-09-29)
//   - tagline is exactly the owner-approved string, with no superlative, and is
//     the first line under the title of llms.txt; every copy in the repo is exact
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
  TAGLINE, TAGLINE_SUPERLATIVE,
} from '../scripts/listing-copy.mjs';
import { execFileSync } from 'node:child_process';

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

  it('glama_400 is unchanged by the Capacity Source copy (owner, 2026-09-29)', () => {
    expect(COPY.glama_400).not.toMatch(/Capacity Source/);
  });

  it('glama_400 is at most 400 characters', () => {
    expect(COPY.glama_400.length).toBeLessThanOrEqual(GLAMA_MAX);
  });

  it('price_line is exactly the approved line', () => {
    expect(COPY.price_line).toBe('Paid plans: dchub.cloud/pricing');
    expect(COPY.price_line).toBe(PRICE_LINE);
  });

  it('glama_400 and long carry the price line and name no price (no dollar sign anywhere)', () => {
    expect(COPY.glama_400).toContain('paid plans: dchub.cloud/pricing');
    expect(COPY.long).toContain('paid plans: dchub.cloud/pricing');
    for (const k of TEXT_FIELDS) expect(COPY[k], k).not.toMatch(/\$/);
    expect(read('canonical/github_description.txt')).not.toMatch(/\$/);
    expect(SERVER_JSON.description).not.toMatch(/\$/);
  });

  it('DCPI appears in sentence 1 or 2 of short, long, glama_400 and the GitHub description', () => {
    const early = (t) => t.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
    for (const t of [COPY.short, COPY.long, COPY.glama_400, read('canonical/github_description.txt'), SERVER_JSON.description]) {
      expect(early(t)).toMatch(/DCPI/);
    }
  });

  it('endpoints is exactly the approved line for the current tool count', () => {
    expect(COPY.endpoints).toBe(endpointsLine(COPY.tool_count));
    expect(COPY.endpoints).toBe('94 MCP tools at https://dchub.cloud/mcp plus a REST API at https://dchub.cloud/api/v1'
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

  // Owner request 2026-09-29: the Capacity Source line rides at the end of
  // `long` (so Smithery carries it too), worded exactly as given.
  it('long ends with the Capacity Source marketplace sentence', () => {
    expect(COPY.long.endsWith(' Capacity Source adds a free capacity marketplace: operators list '
      + 'data-center capacity at https://dchub.cloud/listings, and agents search it by size and '
      + 'location with source_capacity, then request an introduction with request_capacity_intro.'))
      .toBe(true);
  });
});

describe('capacity_blurb', () => {
  it('is exactly the owner-given line (2026-09-29)', () => {
    expect(COPY.capacity_blurb).toBe('Capacity Source by DC Hub: operators and brokers list available '
      + 'data-center capacity free; buyers and AI agents source it by size (kW or MW) and location with '
      + 'the source_capacity MCP tool or at https://dchub.cloud/listings. Contacts are shared only if '
      + 'the provider accepts.');
  });

  it('carries no number beyond the kW/MW units, no off-market wording and no superlative', () => {
    expect(COPY.capacity_blurb).not.toMatch(/\d/);
    expect(COPY.capacity_blurb).not.toMatch(/off[- ]market|not publicly marketed/i);
    expect(COPY.capacity_blurb).not.toMatch(/\bonly (?:one|source)\b|\bthe (?:first|largest|best)\b/i);
  });
});

describe('tagline (owner, 2026-09-29)', () => {
  // The literal is repeated here on purpose: a test that only compared the
  // JSON to the module constant would pass if both drifted together.
  const OWNER_TEXT = 'The real-time agentic procurement endpoint and data center knowledge hub.';

  it('is exactly the owner-approved string', () => {
    expect(COPY.tagline).toBe(OWNER_TEXT);
    expect(TAGLINE).toBe(OWNER_TEXT);
  });

  it('carries no superlative, count or price', () => {
    expect(COPY.tagline).not.toMatch(TAGLINE_SUPERLATIVE);
    expect(COPY.tagline).not.toMatch(/\d|\$/);
  });

  it('the superlative fence catches the banned shapes', () => {
    for (const bad of ['The only real-time agentic procurement endpoint',
      "The world's first real-time agentic procurement endpoint",
      'the real-time agentic procurement endpoint on the planet',
      'The #1 agentic procurement endpoint', 'the leading data center knowledge hub']) {
      expect(bad, bad).toMatch(TAGLINE_SUPERLATIVE);
    }
  });

  it('is the first line under the title of llms.txt', () => {
    const lines = read('llms.txt').split('\n');
    expect(lines[0]).toMatch(/^# /);
    const next = lines.slice(1).find((l) => l.trim() !== '');
    expect(next).toBe(COPY.tagline);
  });

  it('every copy anywhere in the repo is exact, with no superlative beside it', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
      .split('\0').filter((f) => /\.(md|txt|json|m?js|ya?ml|html)$/.test(f)
        && f !== 'test/listing-copy.test.mjs' && f !== 'scripts/listing-copy.mjs');
    let seen = 0;
    for (const f of files) {
      let text;
      try { text = read(f); } catch { continue; }
      if (!/agentic\s+procurement\s+endpoint/i.test(text)) continue;
      for (const line of text.split('\n')) {
        for (const m of line.matchAll(/agentic\s+procurement\s+endpoint/gi)) {
          const start = m.index - 'The real-time '.length;
          const exact = start >= 0 && line.slice(start, start + OWNER_TEXT.length) === OWNER_TEXT;
          expect(exact, `${f}: ${line.trim().slice(0, 160)}`).toBe(true);
          const beside = line.slice(Math.max(0, start - 40), start) + ' | '
            + line.slice(start + OWNER_TEXT.length, start + OWNER_TEXT.length + 40);
          expect(beside, `${f}: superlative beside the tagline`).not.toMatch(TAGLINE_SUPERLATIVE);
          seen++;
        }
      }
    }
    // listing-copy.json + llms.txt at least; a scan that saw nothing proves nothing.
    expect(seen).toBeGreaterThanOrEqual(2);
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

  it('include the tagline, the Capacity Source sentence of long, and capacity_blurb', () => {
    expect(fps).toContain(COPY.tagline.toLowerCase());
    expect(fps.some((f) => f.startsWith('capacity source adds a free capacity marketplace'))).toBe(true);
    expect(fps.some((f) => f.startsWith('capacity source by dc hub:'))).toBe(true);
  });

  // Grok's 2026-09-29 directory edits: the listing LEADS with the tagline and
  // the Capacity Source sentence, and the rest of the text may be truncated.
  it('a tagline-led listing carrying current copy reads as current, and breaks no rule', () => {
    const at = COPY.long.indexOf('Capacity Source adds');
    const lobe = `<div class="desc">${COPY.tagline} ${COPY.long.slice(at).replace(/&/g, '&amp;')}</div>`;
    const truncated = `${COPY.tagline}\n  ${COPY.capacity_blurb.slice(0, 90)}…`;
    for (const page of [lobe, truncated, `${COPY.tagline} ${COPY.short}`]) {
      expect(showsCurrentCopy(page, fps), page).toBe(true);
      expect(copyRuleViolations(page), page).toEqual([]);
    }
    // Without the new fingerprints the same listing was drift.
    const legacy = copyFingerprints({ short: COPY.short, glama_400: COPY.glama_400, long: COPY.long.slice(0, 60) });
    expect(showsCurrentCopy(truncated, legacy)).toBe(false);
  });

  it('a tagline-led listing with old copy still fails the copy rules', () => {
    const page = `${COPY.tagline} 24,900+ facilities. Pro $99/mo.`;
    expect(showsCurrentCopy(page, fps)).toBe(true);
    expect(copyRuleViolations(page).map((v) => v.rule).sort()).toEqual(['facility_count', 'monthly_price']);
  });

  it('a reworded or boastful tagline is not a fingerprint match', () => {
    expect(showsCurrentCopy('The only real-time agentic procurement endpoint and data-center knowledge hub.',
      fps.filter((f) => f === COPY.tagline.toLowerCase()))).toBe(false);
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
