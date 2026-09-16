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
    for (const name of [...GATED, ...UNGATED]) {
      const url = _accessTagFor(name).pricing_url;
      expect(url, `${name}: a minted token reached the cached annotation`)
        .not.toMatch(/\/(go\/c|upgrade\/h)\//);
    }
  });

  it('still attributes an UNGATED tool, without sending it to checkout', () => {
    for (const name of UNGATED) {
      const tag = _accessTagFor(name);
      expect(tag.pricing_url).toContain('ref=mcp-tools-list');
      expect(tag.pricing_url).not.toContain('/pricing/upgrade');
      expect(tag.upgrade_relay, `${name} is not gated but carries a relay pointer`)
        .toBeUndefined();
    }
  });

  it('MUST-FAIL CONTROL: no bare pricing URL is left typed in the tag path', () => {
    // The literal this change removed. Both tools/list paths typed it, five
    // thousand lines apart, and they have to stay on one derivation — if this
    // string comes back, one of them has been re-forked.
    const bare = SRC.match(/pricing_url: 'https:\/\/dchub\.cloud\/pricing'/g) || [];
    expect(bare, 'a tools/list path re-typed the bare pricing URL').toEqual([]);
    // ...and the derivation really is shared: exactly one definition, used by
    // the stateless cached path and the registration path.
    expect((SRC.match(/function _accessTagFor\(/g) || []).length).toBe(1);
    expect((SRC.match(/_accessTagFor\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
