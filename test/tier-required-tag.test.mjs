// A2 tier-gating (owner 2026-10-03): every tool's access tag names the lowest
// seat that gets its full answer (`tier_required`) and one plain sentence on
// what a free caller gets (`free_answer`), derived from the sets the live gate
// enforces. Additive: `access`, `pricing_url` and `connect_url` keep their
// shape; only the two Pro tools that were advertised free_preview now read paid.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _accessTagFor, _tierRequiredFor, KEY_REQUIRED_TOOLS, FREE_ANSWER_BY_TIER } from '../server.mjs';
import { DIRECTORY_REMOVED } from '../lib/chatgpt-directory.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALL = JSON.parse(fs.readFileSync(path.join(ROOT, 'toolspec.json'), 'utf8')).map((t) => t.name);
const CLASSES = ['pro', 'email', 'developer_for_full', 'free_key', 'anonymous'];

describe('tier_required on the access tag', () => {
  it('covers the whole registered population (94 tools)', () => {
    expect(ALL.length).toBe(94);
    for (const n of ALL) {
      const tag = _accessTagFor(n);
      expect(CLASSES, n).toContain(tag.tier_required);
      expect(tag.free_answer, n).toBe(FREE_ANSWER_BY_TIER[tag.tier_required]);
    }
  });

  it('classifies the spec fixtures', () => {
    expect(_tierRequiredFor('export_dataset')).toBe('pro');
    expect(_tierRequiredFor('get_composite_site_score')).toBe('pro');
    expect(_tierRequiredFor('analyze_site')).toBe('pro');
    expect(_tierRequiredFor('get_facility')).toBe('email');
    expect(_tierRequiredFor('get_grid_scoreboard')).toBe('anonymous');
    expect(_tierRequiredFor('list_standing_intents')).toBe('free_key');
    expect(_tierRequiredFor('save_site')).toBe('free_key');
    expect(_tierRequiredFor('get_gas_index')).toBe('developer_for_full');
  });

  it('reads access paid for the two Pro tools that were tagged free_preview', () => {
    expect(_accessTagFor('export_dataset').access).toBe('paid');
    expect(_accessTagFor('get_composite_site_score').access).toBe('paid');
  });

  it('every pro tool reads paid, and no tool reads paid without a gated class', () => {
    for (const n of ALL) {
      const t = _accessTagFor(n);
      if (t.tier_required === 'pro') expect(t.access, n).toBe('paid');
      if (t.tier_required === 'anonymous' || t.tier_required === 'free_key') expect(t.access, n).not.toBe('paid');
    }
  });

  it('keeps the link key the tool had: relabelling moves no pricing_url/connect_url', () => {
    // export_dataset and get_composite_site_score were ungated on the paywall
    // class and carried connect_url. They still do, and gain no pricing_url.
    for (const n of ['export_dataset', 'get_composite_site_score']) {
      const t = _accessTagFor(n);
      expect(t.connect_url, n).toBe(`https://dchub.cloud/connect?ref=mcp-tools-list&tool=${n}`);
      expect(t.pricing_url, n).toBeUndefined();
    }
    const g = _accessTagFor('get_facility');
    expect(g.pricing_url).toBe('https://dchub.cloud/pricing/upgrade?tool=get_facility&ref=mcp-tools-list');
  });

  it('KEY_REQUIRED_TOOLS stays inside the measured key-only list of the directory profile', () => {
    const removed = new Set(DIRECTORY_REMOVED);
    for (const n of KEY_REQUIRED_TOOLS) {
      expect(removed.has(n), n).toBe(true);
      expect(ALL, n).toContain(n);
    }
  });

  it('free_answer copy carries no price, no em dash', () => {
    for (const s of Object.values(FREE_ANSWER_BY_TIER)) {
      expect(s).not.toMatch(/\$\s?\d|—/);
    }
  });
});
