// r-pro-trial-offer (2026-09-27): the heavy-user 7-day Pro trial rides the
// existing "→ For your human:" line; only the link parameter differs by arm.
//
// Pinned here:
//   * OFF by default: no flag, no backend call, response untouched;
//   * calls 1-4 (backend says not yet) carry nothing; the eligible call carries
//     ONE human line, the offer arm's link has ?offer=pro_trial_7d and
//     structuredContent.for_your_human.offer, the holdout's link is plain;
//   * the two arms' lines are the same sentence apart from the link;
//   * a no-data answer never asks the backend (so never counts, never fires);
//   * anonymous, paid, wrong-tool and wall results are never offered;
//   * the Land & Power preview branch wraps its DATA answer, after _noDataGuard.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  _withProTrialOffer, PRO_TRIAL_OFFER, HUMAN_FIRST_MARKER, _lpPreviewResult,
} from '../server.mjs';

beforeAll(() => { process.env.DCHUB_INTERNAL_KEY = process.env.DCHUB_INTERNAL_KEY || 'test-internal'; });

const ON = { DCHUB_PRO_TRIAL_OFFER: '1' };
const FREE = { api_key: 'dch_live_heavyuser000000000000', tier: 'free', session_id: 'sess-1', platform: 'claude-desktop' };

function preview() {
  const data = { site: { lat: 39.0, lon: -77.4 }, verdict: 'strong', composite_score: 81, substations_count: 4 };
  return _lpPreviewResult('analyze_site', { content: [{ type: 'text', text: JSON.stringify(data) }] });
}
const decider = (arm) => {
  const calls = [];
  const fn = async (c, tool) => { calls.push(tool); return arm ? { fire: true, arm } : null; };
  fn.calls = calls;
  return fn;
};
const markers = (r) => r.content.filter((b) => b.type === 'text' && b.text.includes(HUMAN_FIRST_MARKER));

describe('pro trial offer', () => {
  it('is off by default and never calls the backend', async () => {
    const d = decider('offer');
    const r0 = preview();
    const r = await _withProTrialOffer(r0, 'analyze_site', FREE, {}, d);
    expect(r).toBe(r0);
    expect(d.calls).toEqual([]);
  });

  it('calls 1-4 carry no line; the eligible call carries exactly one', async () => {
    let n = 0;
    const d = async () => (++n === 5 ? { fire: true, arm: 'offer' } : null);
    const out = [];
    for (let i = 0; i < 6; i++) out.push(await _withProTrialOffer(preview(), 'analyze_site', FREE, ON, d));
    expect(out.map((r) => markers(r).length)).toEqual([0, 0, 0, 0, 1, 0]);
    expect(out[4].structuredContent.for_your_human.url).toContain('?offer=' + PRO_TRIAL_OFFER);
  });

  it('offer arm: ?offer link in both channels, offer field set', async () => {
    const r = await _withProTrialOffer(preview(), 'analyze_site', FREE, ON, decider('offer'));
    const fyh = r.structuredContent.for_your_human;
    expect(fyh.offer).toBe('pro_trial_7d');
    expect(fyh.url).toMatch(/^https:\/\/dchub\.cloud\/upgrade\/h\/[^?]+\?offer=pro_trial_7d$/);
    expect(fyh.markdown).toContain(fyh.url);
    const lines = markers(r);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toContain(fyh.url);
    // the data answer is still first and untouched
    expect(JSON.parse(r.content[0].text).verdict).toBe('strong');
  });

  it('holdout arm: the same line with the plain link', async () => {
    const r = await _withProTrialOffer(preview(), 'analyze_site', FREE, ON, decider('holdout'));
    const fyh = r.structuredContent.for_your_human;
    expect(fyh.offer).toBeUndefined();
    expect(fyh.url).not.toContain('?offer');
    expect(markers(r)).toHaveLength(1);
  });

  it('the two arms differ only in the link', async () => {
    const o = await _withProTrialOffer(preview(), 'analyze_site', FREE, ON, decider('offer'));
    const h = await _withProTrialOffer(preview(), 'analyze_site', FREE, ON, decider('holdout'));
    const norm = (r) => markers(r)[0].text.replace(/https:\/\/dchub\.cloud\/upgrade\/h\/\S+?(?= |$)/g, '<URL>');
    expect(norm(o)).toBe(norm(h));
  });

  it('never asks the backend on a no-data answer', async () => {
    const d = decider('offer');
    const noData = { content: [{ type: 'text', text: '{"error":"API 503"}' }],
                     structuredContent: { error: 'API 503', _error_mitigation: { retry: true } } };
    const r = await _withProTrialOffer(noData, 'analyze_site', FREE, ON, d);
    expect(r).toBe(noData);
    const unavailable = { content: [{ type: 'text', text: '{"source_unavailable":true}' }],
                          structuredContent: { source_unavailable: true } };
    expect(await _withProTrialOffer(unavailable, 'analyze_site', FREE, ON, d)).toBe(unavailable);
    expect(d.calls).toEqual([]);
  });

  it('never for anonymous, paid, other tools, walls or /mcp/claude-style exclusions', async () => {
    const d = decider('offer');
    const cases = [
      [{ ...FREE, api_key: '' }, 'analyze_site', preview()],
      [{ ...FREE, tier: 'paid' }, 'analyze_site', preview()],
      [{ ...FREE, tier: 'developer' }, 'analyze_site', preview()],
      [FREE, 'search_facilities', preview()],
      [{ ...FREE, platform: 'python-requests/2.31 dchub-probe' }, 'analyze_site', preview()],
      [FREE, 'analyze_site', _lpPreviewResult('analyze_site', { content: [{ type: 'text', text: 'not json' }] })],
    ];
    for (const [c, tool, res] of cases) {
      expect(await _withProTrialOffer(res, tool, c, ON, d)).toBe(res);
    }
    expect(d.calls).toEqual([]);
  });

  it('get_grid_intelligence only when named in DCHUB_PRO_TRIAL_OFFER_TOOLS', async () => {
    const d = decider('offer');
    const res = preview();
    expect(await _withProTrialOffer(res, 'get_grid_intelligence', FREE, ON, d)).toBe(res);
    const r = await _withProTrialOffer(preview(), 'get_grid_intelligence', FREE,
      { ...ON, DCHUB_PRO_TRIAL_OFFER_TOOLS: 'analyze_site,get_grid_intelligence' }, d);
    expect(markers(r)).toHaveLength(1);
  });

  it('a backend failure leaves the response untouched', async () => {
    const res = preview();
    const boom = async () => { throw new Error('down'); };
    expect(await _withProTrialOffer(res, 'analyze_site', FREE, ON, boom)).toBe(res);
  });

  it('the Land & Power preview branch wraps its data answer after the no-data guard', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(src).toMatch(/_withProTrialOffer\(\s*_lpPreviewResult\(name, _noDataGuard\(await handler\(args\)\)\), name, c\)/);
  });
});
