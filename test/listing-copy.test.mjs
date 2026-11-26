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
//   - tight is at most 160 characters, leads with DCPI, carries the MCP URL,
//     and fits beside the backend Capacity Source line in a 280-char cap
//   - tool_count equals the canon snapshot AND the served /mcp tools/list set
//     (the trackedTool registrations in server.mjs, the same derivation
//     sync-tools-manifest uses) AND the registry manifests
//   - `long` is byte-equal to scripts/smithery_description.txt, so the file
//     Smithery is pushed from and this one cannot drift
//   - the heal engine and the daily job own tool_count and endpoints; third-party
//     description phrases stay count-free (a stale count there is a problem, not a heal)
// HARD GATE (test/hard-gate.txt): qualifies because it is offline and reads
// committed files only.
import { describe, it, expect } from 'vitest';
import { CANON_SENTENCE } from '../lib/dchub-identity.mjs';
import { readFileSync } from 'node:fs';
import {
  LISTING_COPY_PATH, FIELDS, TEXT_FIELDS, GLAMA_MAX, TIGHT_MAX, MCP_URL, endpointsLine,
  copyRuleViolations, loadListingCopy, copyFingerprints, showsCurrentCopy,
  TAGLINE, TAGLINE_SUPERLATIVE, FINGERPRINT_CHARS,
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

  // Owner 2026-10-10: a variant for tight caps. The backend registry builder
  // (dchub-backend routes/mcp_presence_crawler.py) appends its Capacity Source
  // line (118 chars, CAPACITY_SOURCE_BLURB there) when it fits; cursor_directory
  // caps at 280. Repeated here on purpose: if either side grows, this goes red.
  const BACKEND_BLURB_LEN = 118;
  const CURSOR_CAP = 280;

  it('short is at most 160 characters (listing snapshot / context7 cap)', () => {
    expect(COPY.short.length).toBeLessThanOrEqual(160);
  });

  it('tight is at most TIGHT_MAX (160) characters', () => {
    expect(TIGHT_MAX).toBe(160);
    expect(COPY.tight.length).toBeLessThanOrEqual(TIGHT_MAX);
  });

  it('tight + the backend Capacity Source line fits a 280-char cap', () => {
    expect(COPY.tight.length + 1 + BACKEND_BLURB_LEN).toBeLessThanOrEqual(CURSOR_CAP);
  });

  it('tight carries the MCP URL (short does not: why tight exists) and names no tool count', () => {
    expect(COPY.tight).toContain(MCP_URL);
    expect(COPY.short).not.toContain(MCP_URL);
    expect(COPY.tight).not.toMatch(/\btools?\b/);
  });

  // 2026-11-15 (owner, MCP Ecosystem PR review 2026-11-14): listing copy names no plan, no free tier
  // and no pricing page. The price_line field is retired. Owner 2026-11-26 capabilities messaging: long
  // says "A key is optional." (no env-var name); the Glama setup field keeps "DCHUB_API_KEY is optional."
  it('names no plan, no free tier and no pricing page; price_line is retired', () => {
    expect(COPY).not.toHaveProperty('price_line');
    expect(FIELDS).not.toContain('price_line');
    const PLAN = /\bfree[- ]tiers?\b|\bpaid (?:plans?|tiers?|keys?)\b|\/pricing\b|\bpricing page\b/i;
    for (const k of TEXT_FIELDS) expect(COPY[k], k).not.toMatch(PLAN);
    expect(SMITHERY_DESC).not.toMatch(PLAN);
    expect(COPY.long).toContain('A key is optional.');
    expect(COPY.glama_setup_restrictions).toBe('DCHUB_API_KEY is optional.');
  });

  it('no field names a price (no dollar sign anywhere)', () => {
    for (const k of TEXT_FIELDS) expect(COPY[k], k).not.toMatch(/\$/);
    expect(read('canonical/github_description.txt')).not.toMatch(/\$/);
    expect(SERVER_JSON.description).not.toMatch(/\$/);
  });

  // Owner 2026-11-26 capabilities messaging: short and tight lead with the
  // tagline and carry no DCPI; long, glama_400 and the GitHub description still
  // name the index in full. server.json (100-char cap) does not mention DCPI.
  it('short and tight lead with the tagline; long, glama_400 and the GitHub description name DCPI in full', () => {
    expect(COPY.short).toBe(COPY.tagline);
    expect(COPY.tight.startsWith(`DC Hub is the ${COPY.tagline.slice(4)}`)).toBe(true);
    for (const t of [COPY.long, COPY.glama_400, read('canonical/github_description.txt')]) {
      expect(t).toMatch(/Data Center Power Index \(DCPI\)/);
    }
  });

  it('endpoints is exactly the approved count-free line, and stays off third-party description text', () => {
    expect(COPY.endpoints).toBe(endpointsLine());
    // Owner 2026-11-22: no tool count.
    expect(COPY.endpoints).toBe('The full MCP tool catalog at https://dchub.cloud/mcp plus a REST API at https://dchub.cloud/api/v1');
    // Owner 2026-11-26 capabilities messaging: long and glama_400 carry the MCP
    // URL and /connect, and no longer the REST URL.
    expect(COPY.long).toContain(MCP_URL);
    expect(COPY.long).toContain('https://dchub.cloud/connect');
    expect(COPY.glama_400).toContain(MCP_URL);
    expect(COPY.glama_400).toContain('https://dchub.cloud/connect');
    expect(COPY.long).not.toContain(COPY.endpoints);
    expect(COPY.glama_400).not.toContain(COPY.endpoints);
  });

  // Owner 2026-11-19: third-party directory phrases are count-free so a tool
  // addition stops staling ~35-47 listings. tool_count and endpoints keep the
  // served count for our own surfaces.
  it('third-party description phrases are count-free (no tool counts, versions, or facility/asset floors)', () => {
    const THIRD_PARTY = ['short', 'long', 'glama_400', 'tight', 'glama_live', 'mcpmarket_live', 'tagline'];
    const TOOL_COUNT_PHRASE = /\b\d+(?: live| MCP| read-only)* tools\b/;
    const VERSION = /\bv?\d+\.\d+\.\d+\b/;
    const ASSET_FLOOR = /\b\d[\d,]*\+?\s+(?:mapped\s+)?(?:power,?\s+grid,?\s+gas(?:\s+and|,)\s+fiber\s+)?assets\b/i;
    for (const k of THIRD_PARTY) {
      expect(COPY[k], k).not.toMatch(TOOL_COUNT_PHRASE);
      expect(COPY[k], k).not.toMatch(VERSION);
      expect(COPY[k], k).not.toMatch(ASSET_FLOOR);
    }
    expect(SMITHERY_DESC).not.toMatch(TOOL_COUNT_PHRASE);
    expect(SMITHERY_DESC).not.toMatch(VERSION);
    expect(SMITHERY_DESC).not.toMatch(ASSET_FLOOR);
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
    ['plan_price', 'Canon prices: $10 pack, $49 Developer, $99 Pro.'],
    ['plan_price', 'Developer ($49) and Pro ($99)'],
    ['internal_canon_label', 'Canon prices: $10 pack.'],
    ['internal_do_not', 'Do not print exact facility counts.'],
    ['market_count', 'DCPI scores 300+ markets daily'],
    ['market_count', 'across 300+ markets'],
    ['market_count', 'Data Center Power Index (DCPI): 300+ markets daily.'],
    ['market_count', '300+ DCPI markets'],
  ])('%s is caught in %j', (rule, text) => {
    expect(copyRuleViolations(text).map((v) => v.rule)).toContain(rule);
  });

  it('does not flag the approved copy shapes', () => {
    expect(copyRuleViolations('a $10 one-time pack of 1,000 API credits')).toEqual([]);
    expect(copyRuleViolations('live grid feeds from the seven US ISOs')).toEqual([]);
    expect(copyRuleViolations('DCPI scores markets daily')).toEqual([]);
    expect(copyRuleViolations('scores where data centers can get grid power, market by market, daily')).toEqual([]);
    expect(copyRuleViolations('Developer docs and a Pro tier are described at dchub.cloud/pricing')).toEqual([]);
    expect(copyRuleViolations('Canonical surfaces: /api/v1/canon/phrases (the canon prices object is public)')).toEqual([]);
  });
});

describe('listing copy carries no tool count (2026-11-26)', () => {
  it('has no tool_count field, so a published count cannot go stale', () => {
    expect(Object.keys(COPY)).not.toContain('tool_count');
  });

  it('no text field states a tool count', () => {
    for (const k of TEXT_FIELDS) {
      expect(COPY[k], k).not.toMatch(/\b\d+(?: live| MCP| read-only)* tools\b/);
    }
  });
});

describe('the Smithery description cannot drift from it', () => {
  it('long is byte-equal to scripts/smithery_description.txt (trimmed)', () => {
    expect(COPY.long).toBe(SMITHERY_DESC.trim());
  });

  // Owner 2026-11-26 capabilities messaging: long opens "DC Hub is the ..."
  // followed by the tagline, so short (== tagline) is long's opening after "DC Hub is".
  it('short is the opening of long (after "DC Hub is")', () => {
    expect(COPY.long.startsWith(`DC Hub is the ${COPY.short.slice(4)}`)).toBe(true);
    expect(COPY.long.startsWith('DC Hub is the orchestration layer for data center and energy intelligence. '
      + 'Find power. Find land. Find fiber. Find capacity. ')).toBe(true);
  });

  // Owner 2026-11-26 capabilities messaging replaced the Capacity Source closing
  // sentence (2026-09-29) with the citation line, the optional key and /connect.
  it('long carries the cite line and ends with the optional key and /connect', () => {
    expect(COPY.long).toContain(' Cite: Source: DC Hub (dchub.cloud), as of. ');
    expect(COPY.long).toContain('built to work alongside');
    expect(COPY.long.endsWith(' A key is optional. More detail: https://dchub.cloud/connect.')).toBe(true);
  });
});

describe('capacity_blurb', () => {
  it('is exactly the owner-given line (2026-09-29)', () => {
    expect(COPY.capacity_blurb).toBe('Capacity Source by DC Hub: operators and brokers list available '
      + 'data-center capacity (a fee applies only if a deal closes); buyers and AI agents source it by size (kW or MW) and location with '
      + 'the source_capacity MCP tool or at https://dchub.cloud/listings. Contacts are shared only if '
      + 'the provider accepts.');
  });

  it('carries no number beyond the kW/MW units, no off-market wording and no superlative', () => {
    expect(COPY.capacity_blurb).not.toMatch(/\d/);
    expect(COPY.capacity_blurb).not.toMatch(/off[- ]market|not publicly marketed/i);
    expect(COPY.capacity_blurb).not.toMatch(/\bonly (?:one|source)\b|\bthe (?:first|largest|best)\b/i);
  });
});

describe('tagline (owner, 2026-11-26)', () => {
  // The literal is repeated here on purpose: a test that only compared the
  // JSON to the module constant would pass if both drifted together.
  const OWNER_TEXT = 'The orchestration layer for data center and energy intelligence. Find power. Find land. Find fiber. Find capacity.';
  // Retired 2026-10-09 (owner): the old tagline may not appear anywhere.
  const RETIRED = /agentic\s+procurement\s+endpoint|data\s+center\s+knowledge\s+hub/i;

  it('is exactly the owner-approved string', () => {
    expect(COPY.tagline).toBe(OWNER_TEXT);
    expect(TAGLINE).toBe(OWNER_TEXT);
  });

  it('carries no superlative, count, price or retired wording', () => {
    expect(COPY.tagline).not.toMatch(TAGLINE_SUPERLATIVE);
    expect(COPY.tagline).not.toMatch(/\d|\$/);
    expect(COPY.tagline).not.toMatch(RETIRED);
  });

  it('the superlative fence catches the banned shapes', () => {
    for (const bad of ['The only real-time agentic procurement endpoint',
      "The world's first real-time agentic procurement endpoint",
      'the real-time agentic procurement endpoint on the planet',
      'The #1 agentic procurement endpoint', 'the leading data center knowledge hub',
      'The only live data center, power, grid, fiber and deal data',
      "The world's first live data center, power, grid, fiber and deal data",
      'the best data for AI agents and site selection']) {
      expect(bad, bad).toMatch(TAGLINE_SUPERLATIVE);
    }
  });

  it('the retired-wording fence catches the old tagline', () => {
    for (const bad of ['The real-time agentic procurement endpoint and data center knowledge hub.',
      'agentic procurement endpoint', 'the data center knowledge hub']) {
      expect(bad, bad).toMatch(RETIRED);
    }
  });

  // Item 9 (owner 2026-11-11): the canon sentence (lib/dchub-identity.mjs) is the first line under the title;
  // the tagline is the line after it.
  it('is the first line under the title of llms.txt after the canon sentence', () => {
    const lines = read('llms.txt').split('\n');
    expect(lines[0]).toMatch(/^# /);
    const body = lines.slice(1).filter((l) => l.trim() !== '');
    expect(body[0]).toBe(CANON_SENTENCE);
    expect(body[1]).toBe(COPY.tagline);
  });

  it('no file in the repo carries the retired tagline; every copy of the new one is exact', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
      .split('\0').filter((f) => /\.(md|txt|json|m?js|ya?ml|html)$/.test(f)
        && f !== 'test/listing-copy.test.mjs' && f !== 'scripts/listing-copy.mjs');
    let scanned = 0;
    let seen = 0;
    for (const f of files) {
      let text;
      try { text = read(f); } catch { continue; }
      scanned++;
      for (const line of text.split('\n')) {
        expect(line, `${f}: retired tagline wording: ${line.trim().slice(0, 160)}`).not.toMatch(RETIRED);
        let at = line.indexOf(OWNER_TEXT);
        while (at !== -1) {
          const beside = line.slice(Math.max(0, at - 40), at) + ' | '
            + line.slice(at + OWNER_TEXT.length, at + OWNER_TEXT.length + 40);
          expect(beside, `${f}: superlative beside the tagline`).not.toMatch(TAGLINE_SUPERLATIVE);
          seen++;
          at = line.indexOf(OWNER_TEXT, at + 1);
        }
      }
    }
    // A scan that read nothing, or found no copy of the tagline, proves nothing.
    expect(scanned).toBeGreaterThan(50);
    // listing-copy.json + llms.txt + GEMINI.md + kiro-power/README.md at least.
    expect(seen).toBeGreaterThanOrEqual(4);
  });
});

describe('the heal engine owns it', () => {
  it('sync-tools-manifest heals tool_count and endpoints, not third-party description phrases', () => {
    expect(SYNC).toMatch(/listing-copy\.json[\s\S]{0,1500}tool_count/);
    expect(SYNC).toMatch(/listing-copy\.json[\s\S]{0,2500}endpoints/);
    expect(SYNC).toMatch(/do not inject tool counts into third-party/);
  });

  it('daily-manifest-sync stages it in $OWNED, so a heal is not discarded', () => {
    const owned = DAILY.match(/OWNED="([\s\S]*?)"/);
    expect(owned).toBeTruthy();
    expect(owned[1].split(/[\s\\]+/)).toContain(LISTING_COPY_PATH);
  });
});

describe('read-back fingerprints', () => {
  const fps = copyFingerprints(COPY);
  // The tagline is longer than FINGERPRINT_CHARS, so its fingerprint is a prefix.
  const TAGLINE_FP = COPY.tagline.toLowerCase().slice(0, FINGERPRINT_CHARS);

  it('are derived from short / glama_400 / long / tight', () => {
    expect(fps.length).toBeGreaterThan(0);
    expect(fps).toContain(COPY.tight.toLowerCase().slice(0, FINGERPRINT_CHARS));
  });

  // Owner 2026-11-26: long no longer carries a Capacity Source sentence, so
  // listingFingerprints derives none from it; the tagline and capacity_blurb remain.
  it('include the tagline and capacity_blurb (long has no Capacity Source sentence since 2026-11-26)', () => {
    expect(fps).toContain(TAGLINE_FP);
    expect(fps.some((f) => f.startsWith('capacity source adds a capacity marketplace'))).toBe(false);
    expect(fps.some((f) => f.startsWith('capacity source by dc hub:'))).toBe(true);
  });

  // Grok's 2026-09-29 directory edits: the listing LEADS with the tagline and
  // the Capacity Source sentence, and the rest of the text may be truncated.
  it('a tagline-led listing carrying current copy reads as current, and breaks no rule', () => {
    const lobe = `<div class="desc">${COPY.tagline} ${COPY.capacity_blurb.replace(/&/g, '&amp;')}</div>`;
    const truncated = `${COPY.tagline}\n  ${COPY.capacity_blurb.slice(0, 90)}…`;
    for (const page of [lobe, truncated, `${COPY.tagline} ${COPY.short}`]) {
      expect(showsCurrentCopy(page, fps), page).toBe(true);
      expect(copyRuleViolations(page), page).toEqual([]);
    }
    // The capacity_blurb fingerprint is load-bearing: a blurb-only listing
    // matches with it and is drift without it.
    const blurbOnly = `${COPY.capacity_blurb.slice(0, 90)}…`;
    expect(showsCurrentCopy(blurbOnly, fps)).toBe(true);
    const legacy = copyFingerprints({ ...COPY, capacity_blurb: '' });
    expect(showsCurrentCopy(blurbOnly, legacy)).toBe(false);
  });

  it('a tagline-led listing with old copy still fails the copy rules', () => {
    const page = `${COPY.tagline} 24,900+ facilities. Pro $99/mo.`;
    expect(showsCurrentCopy(page, fps)).toBe(true);
    // "Pro $99/mo" is a monthly price and, since 2026-10-15, also a plan priced in listing copy.
    expect(copyRuleViolations(page).map((v) => v.rule).sort()).toEqual(['facility_count', 'monthly_price', 'plan_price']);
  });

  it('a reworded or boastful tagline is not a fingerprint match', () => {
    // The tagline fingerprint must exist, or the filter below is empty and the
    // false verdict would be vacuous.
    expect(fps.filter((f) => f === TAGLINE_FP)).toHaveLength(1);
    expect(showsCurrentCopy('The only live data center, power, grid, fiber and deal data for AI agents and site-selection.',
      fps.filter((f) => f === TAGLINE_FP))).toBe(false);
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
