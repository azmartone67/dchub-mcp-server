// unlock-more-data-pro-trigger.test.mjs — Grok audit 2026-10-06, item 3.
// After a Pro-only preview, unlock_more_data must lead with the 7-day trial, describe the pack as
// API capacity that does not cover the paid-plan tools, and never call the pack an unlock.
// v13 (owner 2026-10-10): that response names no plan (Grok rule: no price or plan names in tool text).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _ctxALS, _unlockMoreDataEnvelope, _noteProWall, _proTriggerTool } from '../server.mjs';

let saved;
beforeEach(() => { saved = process.env.DCHUB_INTERNAL_KEY; process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret'; });
afterEach(() => { if (saved === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = saved; });

const run = (sid, args) => _ctxALS.run({ session_id: sid, tier: 'free', platform: 'cursor' }, () => _unlockMoreDataEnvelope(args));

describe('unlock_more_data after a Pro-only wall', () => {
  it('leads with the 7-day trial, pack as API capacity without the paid-plan tools, no unlock next to the pack, no plan name', () => {
    _noteProWall('sess-trigger-1', 'analyze_site');
    const r = run('sess-trigger-1', {});
    const first = r.content[0].text.split('\n')[0];
    expect(first).toContain("DC Hub's paid plan has the full site analysis");
    expect(first).toContain('Start a 7-day trial: https://');
    const sc = r.structuredContent;
    expect(sc.user_message).toContain('Start a 7-day trial');
    expect(sc.human_message).toContain('paid-plan tools not included');
    // No plan name in the lead, the person line, the pack line or the plans list.
    expect(sc.human_message).not.toMatch(/\bPro\b/);
    expect(sc.user_message).not.toMatch(/\bPro\b/);
    expect(JSON.stringify(sc.plans)).not.toMatch(/\bPro\b/);
    expect(sc.plans[0]).toMatchObject({ id: 'pro_trial', label: 'Paid DC Hub plan, 7-day trial' });
    expect(sc.human_message).not.toMatch(/very next query/);
    expect(sc.human_message).not.toMatch(/\bunlock/i);
    expect(sc.human_message).not.toMatch(/\$99|\$49/);
    // the pack line says API capacity and sits AFTER the Pro line
    expect(sc.human_message.indexOf('Start a 7-day trial')).toBeGreaterThan(-1);
    expect(sc.human_message.indexOf('Start a 7-day trial')).toBeLessThan(sc.human_message.indexOf('API capacity'));
  });
  it('a Pro-only tool named in reason is enough, with no prior wall in the session', () => {
    expect(_proTriggerTool('fresh-sid', 'I was running compare_sites')).toBe('compare_sites');
    const r = run('fresh-sid', { reason: 'analyze_site returned a preview' });
    expect(r.content[0].text.split('\n')[0]).toContain('Start a 7-day trial');
  });
  it('no Pro trigger: the pack still leads, described as capacity, never as an unlock', () => {
    const r = run('no-wall-sid', {});
    const m = r.structuredContent.human_message;
    expect(m).toContain('a one-time pack of 1,000 API credits (usage capacity, not a subscription)');
    expect(m).not.toContain('$');   // owner 2026-10-10: no amount in unlock_more_data's copy
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

describe('unlock_more_data after a Pro wall: one link in both channels (Grok 2026-10-07)', () => {
  it('structuredContent carries only the trial and the pack, and the same link as the text line', () => {
    _noteProWall('sess-one-link', 'analyze_site', 'https://dchub.cloud/u/fghrpj');
    const r = run('sess-one-link', {});
    const sc = r.structuredContent;
    const first = r.content[0].text.split('\n')[0];
    expect(first).toContain('https://dchub.cloud/u/fghrpj');
    expect(sc.for_your_human.url).toBe('https://dchub.cloud/u/fghrpj');
    expect(sc.human_url).toBe('https://dchub.cloud/u/fghrpj');
    expect(sc.plans.map((p) => p.id)).toEqual(['pro_trial', 'credits']);
    expect(sc.plans[0].checkout_url).toBe('https://dchub.cloud/u/fghrpj');
    expect(sc.recommended).toBe('pro_trial');
    expect(JSON.stringify(sc.plans)).not.toMatch(/developer|"pro"/);
  });
  it('no short link on the wall: the trial relay is the same URL in text and structure', () => {
    _noteProWall('sess-long', 'analyze_site');
    const r = run('sess-long', {});
    const url = r.structuredContent.for_your_human.url;
    expect(url).toContain('/upgrade/h/');
    expect(r.content[0].text.split('\n')[0]).toContain(url);
    expect(r.structuredContent.plans[0].checkout_url).toBe(url);
  });
});
