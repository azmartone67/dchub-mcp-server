// A2 (owner, 2026-10-03): every tool's access tag names the lowest seat that
// gets its full answer (`tier_required`) and says it in one plain sentence
// (`free_answer`). Both are derived from the sets the gates enforce, never typed
// per tool, and adding them must not move a single URL: connect_url and
// pricing_url are what the pricing A/B (2026-10-04 to 10-18) measures.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _accessTagFor, _legacyAccessFor, _tierRequiredFor, FREE_ANSWER_BY_TIER,
  KEY_REQUIRED_STATE_TOOLS, LP_TOOLS, isFreeWithEmailTool } from '../server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The whole registered population (toolspec-is-real keeps it equal to tools/list).
const ALL = JSON.parse(fs.readFileSync(path.join(ROOT, 'toolspec.json'), 'utf8')).map((t) => t.name);
const CLASSES = ['pro', 'email', 'developer_for_full', 'free_key', 'anonymous'];

describe('A2: tier_required and free_answer on every access tag', () => {
  it('covers all 92 tools, each with a known class and its sentence', () => {
    expect(ALL).toHaveLength(92);
    for (const name of ALL) {
      const tag = _accessTagFor(name);
      expect(CLASSES, name).toContain(tag.tier_required);
      expect(tag.free_answer, name).toBe(FREE_ANSWER_BY_TIER[tag.tier_required]);
    }
  });

  it('pins the spec fixtures', () => {
    expect(_accessTagFor('export_dataset').tier_required).toBe('pro');
    expect(_accessTagFor('get_composite_site_score').tier_required).toBe('pro');
    expect(_accessTagFor('get_facility').tier_required).toBe('email');
    expect(_accessTagFor('get_grid_scoreboard').tier_required).toBe('anonymous');
    expect(_accessTagFor('list_standing_intents').tier_required).toBe('free_key');
    expect(_accessTagFor('get_gas_index').tier_required).toBe('developer_for_full');
  });

  it('access reads paid for the two Pro tools the legacy class called free_preview', () => {
    for (const name of ['export_dataset', 'get_composite_site_score']) {
      expect(_legacyAccessFor(name), `${name}: pick another fixture`).toBe('free_preview');
      expect(_accessTagFor(name).access, name).toBe('paid');
    }
  });

  it('every Pro tool reads paid; no free-with-email tool is labelled Pro', () => {
    for (const name of ALL) {
      const tag = _accessTagFor(name);
      if (tag.tier_required === 'pro') expect(tag.access, name).toBe('paid');
      if (isFreeWithEmailTool(name) && !LP_TOOLS.has(name)) expect(tag.tier_required, name).toBe('email');
    }
  });

  it('the URL still follows the legacy class, so no URL moves during the A/B', () => {
    for (const name of ALL) {
      const tag = _accessTagFor(name);
      const gated = ['paid', 'metered'].includes(_legacyAccessFor(name));
      const q = encodeURIComponent(name);
      if (gated) {
        expect(tag.pricing_url, name).toBe(`https://dchub.cloud/pricing/upgrade?tool=${q}&ref=mcp-tools-list`);
        expect(tag.connect_url, name).toBeUndefined();
      } else {
        expect(tag.connect_url, name).toBe(`https://dchub.cloud/connect?ref=mcp-tools-list&tool=${q}`);
        expect(tag.pricing_url, name).toBeUndefined();
      }
    }
  });

  it('the derivation reads the sets, not a per-tool list', () => {
    for (const name of KEY_REQUIRED_STATE_TOOLS) {
      expect(ALL, `${name} is not a registered tool`).toContain(name);
      expect(_tierRequiredFor(name), name).toBe('free_key');
    }
    for (const name of LP_TOOLS) expect(_tierRequiredFor(name), name).toBe('pro');
  });

  it('the sentences name no price and carry no em dash', () => {
    for (const [k, s] of Object.entries(FREE_ANSWER_BY_TIER)) {
      expect(s, k).not.toMatch(/\$|\/mo\b|per month/i);
      expect(s, k).not.toContain('—');
    }
  });
});
