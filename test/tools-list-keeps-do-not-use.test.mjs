// tools-list-keeps-do-not-use.test.mjs — Grok QA v2.12.48 (2026-11-13, P3).
//
// /mcp tools/list served request_capacity_intro without its last routing sentence, "Do NOT use to save
// or monitor a site (use save_site / set_site_alert)." The registered text was 1331 characters; the
// list slimmer (lib/list-slim.mjs slimTool) cuts a description to SLIM_DESC_MAX (1300) at a sentence end
// while keeping the execute_plan pointer last, so the sentence before the pointer is what fell off.
// The fix tightens one clause of the registered text (the disclosure-block sentence restated what the
// sentence on the accepted deal already says) so the whole description fits and nothing is cut.
//
// The ratchet below: other tools also lose a "Do NOT use" sentence to the slimmer today. Protecting
// those sentences in the slimmer would push out other content (measured 2026-11-13: 17 descriptions
// change and source_capacity loses its terms link), which is a copy decision, so they are listed here
// and the list may only shrink: a new tool losing one fails, and a listed tool that keeps its sentence
// again must be taken off.
//
// The real server.mjs on loopback (the harness sets PORT before importing it, so no static import).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { SLIM_DESC_MAX } from '../lib/list-slim.mjs';

const SENTENCE = 'Do NOT use to save or monitor a site (use save_site / set_site_alert).';
const TERMS_API = 'https://dchub.cloud/api/v1/listings/terms';
const DO_NOT = /Do NOT use[^.(]*(?:\([^)]*\)[^.(]*)*\./g;

// Tools whose "Do NOT use" sentence the slimmer drops on /mcp today (2026-11-13). May only shrink.
const KNOWN_LOSING = new Set([
  'compare_isos', 'find_sites', 'get_energy_prices', 'get_fiber_readiness', 'get_gas_intelligence',
  'get_hosting_capacity', 'get_infra_projects', 'get_metro_fiber', 'get_peering_intel',
  'get_power_availability_timeline', 'get_subsea_cables', 'register_standing_intent',
  'search_intelligence', 'source_capacity', 'summarize_for_citation',
]);

let H, fence, served, registered;
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({});
  served = (await H.list('/mcp')).msg.result.tools;
  const S = await import('../server.mjs');
  registered = (await S._buildToolsListResult(null)).tools;
}, 240_000);
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
});

describe('/mcp tools/list: request_capacity_intro keeps its routing sentence', () => {
  it('the served description ends "Do NOT use ... set_site_alert)." before the execute_plan pointer', () => {
    const d = served.find((t) => t.name === 'request_capacity_intro').description;
    expect(d).toContain(SENTENCE);
    expect(d).toMatch(/set_site_alert\)\. For multi-step data center or energy questions, start with execute_plan\.$/);
    expect(d.split(TERMS_API).length - 1).toBe(1);          // the terms link stays too
    expect(d.length).toBeLessThanOrEqual(SLIM_DESC_MAX);
  });

  it('the registered text fits the cap, so the slimmer cuts nothing from it', () => {
    const reg = registered.find((t) => t.name === 'request_capacity_intro').description;
    const d = served.find((t) => t.name === 'request_capacity_intro').description;
    expect(reg.length).toBeLessThanOrEqual(SLIM_DESC_MAX);
    expect(d).toBe(reg.replace(/\s+/g, ' ').trim());
  });
});

describe('ratchet: a tool losing its "Do NOT use" sentence on /mcp', () => {
  it('only the known tools lose one, and each known tool still does (take it off when fixed)', () => {
    const byName = new Map(served.map((t) => [t.name, t.description]));
    const losing = [];
    for (const t of registered) {
      const src = t.description.match(DO_NOT) || [];
      const d = byName.get(t.name) || '';
      if (src.some((s) => !d.includes(s))) losing.push(t.name);
    }
    expect(losing.length).toBeGreaterThan(0);                // the scan reads something
    expect(losing.filter((n) => !KNOWN_LOSING.has(n)), 'new tools losing a Do NOT sentence').toEqual([]);
    expect([...KNOWN_LOSING].filter((n) => !losing.includes(n)), 'fixed: remove from KNOWN_LOSING').toEqual([]);
    expect(losing).not.toContain('request_capacity_intro');
  });
});
