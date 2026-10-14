// G-1014-12 (Grok 10-14): NEISO ("New England ISO" reordered) was rejected by the
// MCP ISO validator and the error then suggested NYISO, a different RTO (the
// spelling is one edit from NYISO). The backend accepts it (be#7019); the MCP
// path must agree and must never name NYISO for it.
import { describe, it, expect } from 'vitest';
import { _validateToolArgs, _foldIsoArg } from '../server.mjs';

const STRICT = ['get_grid_data', 'get_interconnection_queue', 'get_iso_context'];

describe('NEISO alias on the strict ISO tools', () => {
  for (const tool of STRICT) {
    for (const spelling of ['NEISO', 'neiso', ' NEISO ', 'NE-ISO']) {
      it(`${tool} accepts iso=${JSON.stringify(spelling)}`, () => {
        expect(_validateToolArgs(tool, { iso: spelling })).toBeNull();
      });
    }
  }
  it('still rejects a genuinely unknown ISO, and does not hint NYISO for it', () => {
    const r = _validateToolArgs('get_grid_data', { iso: 'ZZZ' });
    expect(r && r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text).error).toBe('invalid_iso');
  });
  it('the real NYISO typo path still suggests NYISO', () => {
    const r = _validateToolArgs('get_grid_data', { iso: 'NYIS' });
    const m = JSON.parse(r.content[0].text)._error_mitigation;
    expect(m.deterministic_hint).toContain('did you mean "NYISO"');
  });
});

describe('_foldIsoArg', () => {
  it('rewrites the alias to the documented code and keeps other params', () => {
    expect(_foldIsoArg({ iso: 'NEISO', limit: 5 })).toEqual({ iso: 'ISONE', limit: 5 });
    expect(_foldIsoArg({ iso: ' neiso' })).toEqual({ iso: 'ISONE' });
  });
  it('returns every other value untouched (same object)', () => {
    const a = { iso: 'ISO-NE' };
    expect(_foldIsoArg(a)).toBe(a);
    const b = { iso: 'PJM' };
    expect(_foldIsoArg(b)).toBe(b);
    expect(_foldIsoArg({})).toEqual({});
    expect(_foldIsoArg(null)).toBeNull();
  });
});
