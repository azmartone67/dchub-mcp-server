/**
 * Agent QA round 2 (2026-10-20), item 6: get_fiber_intel's envelope.
 *  - "Full-fidelity trial answer 1 of 10" rode beside provenance.completeness "partial_preview":
 *    the note is stamped before the >120KB taste trim. A partial answer never says Full-fidelity.
 *  - Lean mode (mcp#1083, DCHUB_LEAN_RESPONSES) did not touch the fiber promotion because none of
 *    it sat under a key it drops (agent_payment, machine_pay, map CTAs, plans).
 */
import { describe, it, expect } from 'vitest';
import { meteredTrialNote, limitMeteredNote, limitedAnswerCopy, noFullFidelityOnPartial } from '../lib/metered-note.mjs';
import { leanObject } from '../lib/lean-response.mjs';

const full = (o) => meteredTrialNote({ call: 1, cap: 10, name: 'get_fiber_intel', ...o, limited: false });
const lim = (o) => meteredTrialNote({ call: 1, cap: 10, name: 'get_fiber_intel', ...o, limited: true });

describe('no "Full-fidelity" on a partial answer', () => {
  it('limitMeteredNote turns each unlimited wording into the limited one', () => {
    for (const o of [{}, { paidTaste: true }, { emailAllowance: true, cap: 3 }]) {
      expect(full(o)).toMatch(/^Full-fidelity /);
      expect(limitMeteredNote(full(o))).toBe(lim(o));
    }
    expect(limitMeteredNote(lim({}))).toBe(lim({}));   // already limited: unchanged
  });
  it('the final-result step rewrites the stamped note when the payload is partial', () => {
    const body = { _metered_trial: { call: 1, of: 10, note: full({}) }, provenance: { completeness: 'partial_preview' } };
    const out = limitedAnswerCopy({ content: [{ type: 'text', text: JSON.stringify(body) }] });
    expect(out.content[0].text).not.toContain('Full-fidelity');
    expect(JSON.parse(out.content[0].text)._metered_trial.note).toBe(lim({}));
  });
  it('a taste-bounded payload counts as partial', () => {
    const body = { _taste_bounded: true, _metered_trial: { note: full({}) } };
    const out = noFullFidelityOnPartial({ content: [{ type: 'text', text: JSON.stringify(body) }] });
    expect(out.content[0].text).not.toContain('Full-fidelity');
  });
  it('a complete answer keeps "Full-fidelity" (the rewrite is not unconditional)', () => {
    const body = { _metered_trial: { note: full({}) }, provenance: { completeness: 'complete' } };
    const r = { content: [{ type: 'text', text: JSON.stringify(body) }] };
    expect(noFullFidelityOnPartial(r)).toBe(r);
  });
});

describe('lean mode covers the fiber envelope', () => {
  it('drops the self-pay and plan-pitch keys, keeps data and the relay contract', () => {
    const o = leanObject({
      type: 'FeatureCollection', features: [1], provenance: { a: 1 },
      agent_payment: { price_usd: '0.50' }, machine_pay: { x: 1 }, agent_pay_hint: 'x', map_cta: 'x',
      plans: [{ id: 'mpp' }], recommended: 'mpp', recommended_subscription: 'developer',
      human_url: 'https://dchub.cloud/upgrade/h/x', human_message: 'm', for_your_human: { url: 'u', text: 't' },
    });
    for (const k of ['agent_payment', 'machine_pay', 'agent_pay_hint', 'map_cta', 'plans', 'recommended', 'recommended_subscription']) {
      expect(o).not.toHaveProperty(k);
    }
    for (const k of ['type', 'features', 'provenance', 'human_url', 'human_message', 'for_your_human']) {
      expect(o).toHaveProperty(k);
    }
  });
});
