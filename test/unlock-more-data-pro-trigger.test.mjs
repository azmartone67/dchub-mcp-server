// unlock-more-data-pro-trigger.test.mjs — Grok audit 2026-10-06, item 3.
// After a Pro-only preview, unlock_more_data must lead with the 7-day Pro trial, describe the pack as
// API capacity that does not cover Pro tools, and never call the pack an unlock.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _ctxALS, _unlockMoreDataEnvelope, _noteProWall, _proTriggerTool } from '../server.mjs';

let saved;
beforeEach(() => { saved = process.env.DCHUB_INTERNAL_KEY; process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret'; });
afterEach(() => { if (saved === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = saved; });

const run = (sid, args) => _ctxALS.run({ session_id: sid, tier: 'free', platform: 'cursor' }, () => _unlockMoreDataEnvelope(args));

describe('unlock_more_data after a Pro-only wall', () => {
  it('leads with the Pro trial, pack as API capacity without Pro tools, no unlock next to the pack', () => {
    _noteProWall('sess-trigger-1', 'analyze_site');
    const r = run('sess-trigger-1', {});
    const first = r.content[0].text.split('\n')[0];
    expect(first).toContain('DC Hub Pro has the full site analysis');
    expect(first).toContain('7-day Pro trial: https://');
    const sc = r.structuredContent;
    expect(sc.user_message).toContain('7-day Pro trial');
    expect(sc.human_message).toContain('Pro tools not included');
    expect(sc.human_message).not.toMatch(/very next query/);
    expect(sc.human_message).not.toMatch(/\bunlock/i);
    expect(sc.human_message).not.toMatch(/\$99|\$49/);
    // the pack line says API capacity and sits AFTER the Pro line
    expect(sc.human_message.indexOf('7-day Pro trial')).toBeLessThan(sc.human_message.indexOf('API capacity'));
  });
  it('a Pro-only tool named in reason is enough, with no prior wall in the session', () => {
    expect(_proTriggerTool('fresh-sid', 'I was running compare_sites')).toBe('compare_sites');
    const r = run('fresh-sid', { reason: 'analyze_site returned a preview' });
    expect(r.content[0].text.split('\n')[0]).toContain('7-day Pro trial');
  });
  it('no Pro trigger: the pack still leads, described as capacity, never as an unlock', () => {
    const r = run('no-wall-sid', {});
    const m = r.structuredContent.human_message;
    expect(m).toContain('$10 one-time = 1,000 API credits');
    expect(m).not.toMatch(/\bunlock/i);
    expect(m).not.toMatch(/my very next query returns the complete data \(/);
  });
  it('MPP wording no longer calls analyze_site / compare_sites a covered per-call tool without the Pro note', () => {
    process.env.MPP_ENABLED = 'true';
    const r = run('mpp-sid', {});
    const t = r.content[0].text;
    if (t.includes('Stripe MPP')) expect(t).toMatch(/analyze_site and compare_sites are DC Hub Pro tools/);
    delete process.env.MPP_ENABLED;
  });
});
