// r-gated-cta (2026-09-16): where a GATED tool sends the human.
//
// WHAT THIS PROTECTS. An agent picks a tool out of tools/list and, when it hits
// the paywall, hands its human whatever URL the annotation carried. That URL
// was `https://dchub.cloud/pricing` — bare — on all 91 tools, identically for a
// free tool and a Pro-only one. Unattributed (a click there is
// indistinguishable from someone typing the URL) and it is the WALL rather than
// a way through.
//
// What this file will NOT assert: that a tokenized /go/c or /upgrade/h link
// rides the annotation. It deliberately must not. Those carry an HMAC over the
// CALLER's session and a mint timestamp, and tools/list is cached and shared
// across sessions — freezing one caller's token there misattributes every other
// caller's click. The tokenized links are minted per CALL, in the gated result.
// So the guard is: attributed + tier-resolving on the gated tools, and a
// pointer telling the agent where the real link comes from.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _accessTagFor } from '../server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
// The whole registered population, not a sample. toolspec.json is the repo's
// own tool-name snapshot and test/toolspec-is-real.test.mjs already fails when
// it drifts from the live registry, so a tool added tomorrow lands here too —
// which the three hand-picked fixtures below could never do.
const ALL_TOOL_NAMES = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'toolspec.json'), 'utf8')).map((t) => t.name);

const GATED = ['get_fiber_intel', 'get_grid_intelligence', 'analyze_site', 'compare_sites'];
const UNGATED = ['why_dchub', 'discover_tools', 'source_capacity'];

describe('the gated-tool CTA', () => {
  it('sends a gated tool through the tier-resolving upgrade route, attributed', () => {
    for (const name of GATED) {
      const tag = _accessTagFor(name);
      expect(['paid', 'metered'], `${name} is no longer gated — pick another fixture`)
        .toContain(tag.access);
      expect(tag.pricing_url).toContain('/pricing/upgrade?tool=' + name);
      expect(tag.pricing_url).toContain('ref=mcp-tools-list');
    }
  });

  it('names where the tokenized link actually comes from', () => {
    for (const name of GATED) {
      const tag = _accessTagFor(name);
      expect(tag.upgrade_relay, `${name} has no relay pointer`).toBeTruthy();
      expect(tag.upgrade_relay).toContain('/go/c/');
      expect(tag.upgrade_relay).toContain('/upgrade/h/');
    }
  });

  it('never freezes a token into the shared, cached tools/list', () => {
    // The whole reason the static tag is not tokenized. A token here would be
    // one caller's, served to every caller.
    // Over the WHOLE population and the WHOLE tag: the destination key moved
    // from pricing_url to connect_url for 63 tools, and a check pinned to one
    // key name would have read `undefined` and passed for every one of them.
    for (const name of ALL_TOOL_NAMES) {
      const blob = JSON.stringify(_accessTagFor(name));
      expect(blob, `${name}: a minted token reached the cached annotation`)
        .not.toMatch(/dchub\.cloud\/(go\/c|upgrade\/h)\/[A-Za-z0-9_-]/);
    }
  });

  // r-no-bare-wall (2026-09-19): this block used to assert the OPPOSITE —
  // that an ungated tool carried a pricing_url with `ref=mcp-tools-list` and
  // no `/pricing/upgrade`. That assertion was satisfied by
  // `https://dchub.cloud/pricing?ref=mcp-tools-list&tool=…`, which is the bare
  // WALL with a query string on it, and it held for 63 of the 91 tools on
  // live. A guard that accepts the defect is why the defect survived the fix
  // that was written to remove it.
  it('sends an UNGATED tool to connect — never to a pricing wall', () => {
    for (const name of UNGATED) {
      const tag = _accessTagFor(name);
      expect(['free', 'free_preview'], `${name} is now gated — pick another fixture`)
        .toContain(tag.access);
      expect(tag.connect_url).toContain('https://dchub.cloud/connect?');
      expect(tag.connect_url).toContain('ref=mcp-tools-list');
      expect(tag.pricing_url, `${name} still carries a pricing URL`).toBeUndefined();
      expect(tag.upgrade_relay, `${name} is not gated but carries a relay pointer`)
        .toBeUndefined();
    }
  });

  // The population check. The three UNGATED fixtures above cannot notice a
  // 64th tool re-acquiring the wall, and the defect this change removes was
  // exactly a whole CLASS that no fixture named. So walk every registered
  // tool, not a sample.
  it('POPULATION: no registered tool emits a bare /pricing anywhere in its tag', () => {
    const names = ALL_TOOL_NAMES;
    expect(names.length, 'the tool registry came back empty — this test would pass vacuously')
      .toBeGreaterThan(60);
    const offenders = [];
    for (const name of names) {
      const blob = JSON.stringify(_accessTagFor(name));
      // The wall is dchub.cloud/pricing NOT followed by `/upgrade`.
      if (/dchub\.cloud\/pricing(?!\/upgrade)/.test(blob)) offenders.push(name);
    }
    expect(offenders, `${offenders.length} tool(s) still hand out a bare pricing wall`)
      .toEqual([]);
  });

  it('POPULATION: every tool carries exactly one destination, and the right one', () => {
    const names = ALL_TOOL_NAMES;
    for (const name of names) {
      const tag = _accessTagFor(name);
      const gated = tag.access === 'paid' || tag.access === 'metered';
      expect(Boolean(tag.pricing_url), `${name} (${tag.access}): pricing_url presence`)
        .toBe(gated);
      expect(Boolean(tag.connect_url), `${name} (${tag.access}): connect_url presence`)
        .toBe(!gated);
    }
  });

  it('MUST-FAIL CONTROL: no bare pricing URL is left typed in the tag path', () => {
    // The literal this change removed. Both tools/list paths typed it, five
    // thousand lines apart, and they have to stay on one derivation — if this
    // string comes back, one of them has been re-forked.
    const bare = SRC.match(/pricing_url: 'https:\/\/dchub\.cloud\/pricing'/g) || [];
    expect(bare, 'a tools/list path re-typed the bare pricing URL').toEqual([]);
    // r-no-bare-wall: and the SECOND shape — the wall with attribution glued
    // on. `/pricing?…` is still /pricing. Only `/pricing/upgrade` may appear.
    const walled = (SRC.match(/dchub\.cloud\/pricing\?/g) || []);
    expect(walled, 'the attributed-but-still-a-wall /pricing? URL is back in server.mjs')
      .toEqual([]);
    // ...and the derivation really is shared: exactly one definition, used by
    // the stateless cached path and the registration path.
    expect((SRC.match(/function _accessTagFor\(/g) || []).length).toBe(1);
    expect((SRC.match(/_accessTagFor\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
