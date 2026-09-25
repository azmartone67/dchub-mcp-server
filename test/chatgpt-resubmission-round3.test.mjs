// ── Grok re-verify of mcp#565 (07a9d83, 2026-09-25 23:16–23:19Z) ──
//
// 1 fetch with an unknown id said "No DC Hub facility has that id" with no
//   isError: the anonymous over-cap rewrite rebuilt the result and dropped it.
// 2 source_capacity still carried sign-in, lead-register and 12-month terms
//   copy, and keyless it returned 0 listings: off the directory profile.
// 3 canvas {locked: true} / "decision layer locked"; get_grid_data
//   "<gated: identified-tier or higher>"; numeric-id fetch lost connectivity.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { _facilityFetch } from '../server.mjs';
import { DIRECTORY_TOOLS, DIRECTORY_REMOVED, DIRECTORY_INSTRUCTIONS, scrubText, scrubToolResult,
  isDirectoryTool } from '../lib/chatgpt-directory.mjs';

const SRC = readFileSync(fileURLToPath(new URL('../server.mjs', import.meta.url)), 'utf8');

describe('1: an unknown id is an error, end to end', () => {
  it('fetch answers isError for every miss shape', async () => {
    for (const miss of [{ success: false, error: 'Invalid slug' }, { error: 'API 404' }, {}, null,
                        { success: true, data: {} }]) {
      const r = await _facilityFetch('no-such-facility-zzz-000', async () => miss);
      expect(r.isError, JSON.stringify(miss)).toBe(true);
      expect(r.content).toHaveLength(1);
      expect(r.content[0].text).toMatch(/No DC Hub facility has that id/);
    }
  });

  it('the handler result keeps isError through the over-cap and capped rewrites', () => {
    const at = SRC.indexOf('const result = _noDataGuard(await handler(gate.params || args));');
    const cap = SRC.indexOf('await _anonOverCap(c.client_ip)', at);
    const guard = SRC.indexOf('if (result && result.isError === true) return result;', at);
    expect(at).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(at);
    expect(guard).toBeLessThan(cap);
    const trial = SRC.indexOf('const _trialResult = _noDataGuard(await handler(args));');
    expect(SRC.slice(trial, trial + 250)).toMatch(/_trialResult\.isError === true\) return _trialResult/);
  });

  it('the directory scrub keeps isError', () => {
    const r = scrubToolResult({ content: [{ type: 'text', text: '{"error":"No DC Hub facility has that id."}' }], isError: true }, 'fetch');
    expect(r.isError).toBe(true);
  });
});

describe('2: source_capacity is off the directory profile', () => {
  it('not listed, not callable, not named in the instructions', () => {
    expect(Object.keys(DIRECTORY_TOOLS)).not.toContain('source_capacity');
    expect(DIRECTORY_REMOVED).toContain('source_capacity');
    expect(isDirectoryTool('source_capacity')).toBe(false);
    expect(DIRECTORY_INSTRUCTIONS).not.toMatch(/source_capacity|Capacity Source/);
  });
});

describe('3: lock wording and fetch connectivity', () => {
  it('lock and gated-tier copy is dropped; a locked flag reads withheld', () => {
    expect(scrubText('12 markets scored. Preview: decision layer locked.')).toBe('12 markets scored.');
    expect(scrubText('<gated: identified-tier or higher>')).toBe('');
    expect(scrubText('<gated: developer>')).toBe('');
    const r = scrubToolResult({ content: [{ type: 'text', text: '{}' }],
      structuredContent: { synthesis: { locked: true, markets: 12 }, peak_mw: '<gated: identified-tier or higher>' } }, 'site_selection_canvas');
    expect(r.structuredContent.synthesis).toEqual({ withheld: true, markets: 12 });
    expect(JSON.stringify(r)).not.toMatch(/locked|gated|identified/);
  });

  it('a numeric-id fetch reads the carrier count for the connectivity line', async () => {
    const calls = [];
    const api = async (path) => {
      calls.push(path);
      if (path === '/api/v1/facility/1109') return { success: true, data: { id: 1109, name: 'CoreSite NY1', city: 'New York', state: 'NY', latitude: 40.72, longitude: -74.0 } };
      if (path === '/api/v1/facility/1109/carriers') return { carrier_count: 517, carriers: [] };
      return null;
    };
    const r = await _facilityFetch('1109', api);
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0].text).text).toMatch(/Connectivity: 517 on-site fiber carrier\(s\)\./);
    expect(calls).toEqual(['/api/v1/facility/1109', '/api/v1/facility/1109/carriers']);
  });

  it('a carriers failure leaves the record intact without the line', async () => {
    const api = async (path) => {
      if (path.endsWith('/carriers')) throw new Error('down');
      return { success: true, data: { id: 5, name: 'X', city: 'Dallas', state: 'TX' } };
    };
    const r = await _facilityFetch('5', api);
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0].text).text).not.toMatch(/Connectivity/);
  });
});
