// Grok agent-text daily probe 2026-10-12, item 11.
//
// Item 11: the "For your human" line was capped once per SESSION, so a PJM
// get_energy_prices answer dropped it after an ERCOT answer from the same tool in the
// same session (measured live, anonymous: call 2's text had no "→ **For your human:**"
// marker). The cap is now session + tool + the answer's region. Same answer again is
// still suppressed (r-relay-cap's loop protection stays).
//
import { describe, it, expect } from 'vitest';
import { composeHumanCta, _requestCtx, _relayScopeKey, HUMAN_FIRST_MARKER } from '../server.mjs';

const BODY = 'Preview.\n\nPay https://dchub.cloud/go/c/aaa and https://dchub.cloud/go/c/bbb';
const H = 'https://dchub.cloud/upgrade/h/zzz';
const run = (sid, scope) => _requestCtx.run({ _relayScope: scope }, () => composeHumanCta(H, BODY, null, sid));

describe('relay cap is per tool + region', () => {
  it('scope key is tool + the answer\'s region, case-folded', () => {
    expect(_relayScopeKey('get_energy_prices', { iso: 'PJM' })).toBe('get_energy_prices|pjm');
    expect(_relayScopeKey('get_energy_prices', { state: 'TX' })).toBe('get_energy_prices|tx');
    expect(_relayScopeKey('get_energy_prices', {})).toBe('get_energy_prices|');
    expect(_relayScopeKey('', { iso: 'PJM' })).toBe('');
  });
  it('a different region in the same session and tool carries the human line again', () => {
    const sid = 'sess-relay-scope-0001';
    expect(run(sid, 'get_energy_prices|ercot')).toContain(HUMAN_FIRST_MARKER);
    expect(run(sid, 'get_energy_prices|pjm')).toContain(HUMAN_FIRST_MARKER);
  });
  it('the same tool + region repeated is still capped', () => {
    const sid = 'sess-relay-scope-0002';
    expect(run(sid, 'get_energy_prices|ercot')).toContain(HUMAN_FIRST_MARKER);
    expect(run(sid, 'get_energy_prices|ercot')).not.toContain(HUMAN_FIRST_MARKER);
  });
  it('a different tool on the same region is its own answer', () => {
    const sid = 'sess-relay-scope-0003';
    expect(run(sid, 'get_energy_prices|ercot')).toContain(HUMAN_FIRST_MARKER);
    expect(run(sid, 'get_grid_intelligence|ercot')).toContain(HUMAN_FIRST_MARKER);
  });
});
