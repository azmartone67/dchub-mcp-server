// get_gas_index: the single-state data date survives masking of `score`.
// Agent panel re-run 2026-10-20: a gated get_gas_index(state=TX) answered
// provenance as_of null ("UNMEASURED") while /api/v1/dcgi/scores/TX carried
// score.data_as_of 2026-07-01. The date sat only inside `score`, which the tier
// mask removes before provenance is built.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _liftDcgiAsOf } from '../server.mjs';
import { collectTimestamps } from '../lib/attribution.mjs';

const BACKEND_TX = {
  index: 'DCGI', ok: true, state: 'TX', license: 'CC BY 4.0',
  score: { dcgi: 71.2, verdict: 'BUILD', data_as_of: '2026-07-01',
           data_as_of_basis: 'OLDEST of the two DCGI inputs', gas_price_period: '2026-07' },
};

describe('get_gas_index lifts the DCGI data date', () => {
  it('copies score.data_as_of and its basis to the top level', () => {
    const out = _liftDcgiAsOf(BACKEND_TX);
    expect(out.as_of).toBe('2026-07-01');
    expect(out.as_of_basis).toBe('OLDEST of the two DCGI inputs');
    expect(out.score).toBe(BACKEND_TX.score);
  });

  it('the date is still found after the score is masked', () => {
    const masked = { ..._liftDcgiAsOf(BACKEND_TX), score: null, _score_in_pro: true };
    const found = JSON.stringify(collectTimestamps(masked));
    expect(found).toContain('2026-07-01');
    const unlifted = { ...BACKEND_TX, score: null, _score_in_pro: true };
    expect(JSON.stringify(collectTimestamps(unlifted))).not.toContain('2026-07-01');
  });

  it('never overwrites a top-level date and passes other shapes through', () => {
    const own = { ...BACKEND_TX, as_of: '2026-09-30' };
    expect(_liftDcgiAsOf(own).as_of).toBe('2026-09-30');
    expect(_liftDcgiAsOf({ error: 'x' })).toEqual({ error: 'x' });
    expect(_liftDcgiAsOf(null)).toBe(null);
    expect(_liftDcgiAsOf([1])).toEqual([1]);
  });

  it('the single-state handler calls it on the backend answer', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const i = src.indexOf("trackedTool(srv, 'get_gas_index'");
    expect(i).toBeGreaterThan(0);
    const body = src.slice(i, src.indexOf('trackedTool(srv,', i + 10));
    expect(body).toMatch(/_liftDcgiAsOf\(await callAPI\(`\/api\/v1\/dcgi\/scores\/\$\{st\}`/);
  });
});
