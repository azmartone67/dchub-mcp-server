// pro-wall-stamp.test.mjs — Grok audit 2026-10-06, items 1-2.
// A gated Pro answer must carry _wall:true, required_plan:'pro', a user_message and a
// for_your_human that name DC Hub Pro and the 7-day trial, with no dollar figure; a full
// Pro answer and a non-Pro tool must be left alone. The handler wiring is pinned by a
// source scan so the 'pro_wall' log status cannot be dropped silently.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _stampProWall, proWallUserMessage, proWallAgentMessage } from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const mk = (sc, text) => ({ content: [{ type: 'text', text: text ?? JSON.stringify(sc) }], structuredContent: sc });

describe('_stampProWall', () => {
  it('stamps a free-key analyze_site preview', () => {
    const r = mk({ ok: true, _gated: true, _preview_only: true, required_plan: 'pro', interpretation: 'Excellent site',
      for_your_human: { text: 'x', url: 'https://dchub.cloud/upgrade/h/abc' } });
    const { result, wall } = _stampProWall(r, 'analyze_site', { tier: 'free', session_id: 's' });
    expect(wall).toBe(true);
    const sc = result.structuredContent;
    expect(sc._wall).toBe(true);
    expect(sc.required_plan).toBe('pro');
    // Note V keyed follow-up (owner 2026-11-16): the line names no plan and no trial.
    expect(sc.user_message).toMatch(/^This preview leaves out .+\. Open https:\/\/dchub\.cloud\/upgrade\/h\/abc to see what your agent found\.$/);
    expect(sc.user_message).not.toMatch(/\bPro\b|paid|trial|\bplan\b/i);
    expect(sc.agent_message.startsWith('This result is partial: some fields are not included at this access level. ')).toBe(true);   // item 1 leftover (2026-10-17)
    expect(sc.agent_message).not.toMatch(/\bPro\b/);
    expect(sc.user_message).toContain('https://dchub.cloud/upgrade/h/abc');
    expect(sc.for_your_human.url).toBe('https://dchub.cloud/upgrade/h/abc');
    expect(JSON.parse(result.content[0].text)._wall).toBe(true);
    expect(JSON.stringify(sc)).not.toMatch(/\$\d/);
  });
  it('keeps a compliant user_message and for_your_human, replaces one that is not the neutral line', () => {
    const good = 'This preview leaves out the report. Open https://u.test/1 to see what your agent found.';
    const keep = _stampProWall(mk({ _gated: true, required_plan: 'pro', user_message: good,
      for_your_human: { text: good, url: 'https://u.test/1' } }), 'analyze_site', {}).result.structuredContent;
    expect(keep.user_message).toBe(good); expect(keep.for_your_human.text).toBe(good);
    const fix = _stampProWall(mk({ _gated: true, required_plan: 'pro', user_message: 'open the link',
      for_your_human: { text: 'see what I found', url: 'https://u.test/2' } }), 'analyze_site', {}).result.structuredContent;
    expect(fix.user_message).toBe('This preview leaves out the full site analysis for this location: power, gas, fiber, market and risk scores, nearby substations and power cost. Open https://u.test/2 to see what your agent found.');
    // the pre-Note-V line (paid plan + trial) is no longer compliant: it is replaced too
    const old = "DC Hub's paid plan has the report. Start a 7-day trial: https://u.test/4";
    const fix2 = _stampProWall(mk({ _gated: true, required_plan: 'pro', user_message: old,
      for_your_human: { text: old, url: 'https://u.test/4' } }), 'analyze_site', {}).result.structuredContent;
    expect(fix2.user_message).toMatch(/^This preview leaves out .+\. Open https:\/\/u\.test\/4 to see what your agent found\.$/);
    expect(fix.for_your_human.url).toBe('https://u.test/2'); expect(fix.for_your_human.text).toBe(fix.user_message);
  });
  it('v13: replaces a line that still names the plan (the v12 spelling), even though it names the trial', () => {
    const v12 = 'DC Hub Pro has the report. Start a 7-day Pro trial: https://u.test/3';
    const fix = _stampProWall(mk({ _gated: true, required_plan: 'pro', user_message: v12,
      for_your_human: { text: v12, url: 'https://u.test/3' } }), 'analyze_site', {}).result.structuredContent;
    expect(fix.user_message).not.toBe(v12);
    expect(fix.user_message).toMatch(/^This preview leaves out .+\. Open https:\/\/u\.test\/3 to see what your agent found\.$/);
    expect(fix.for_your_human.text).toBe(fix.user_message);
  });
  it('leaves a full Pro answer alone', () => {
    const r = mk({ ok: true, composite_score: 81 });
    expect(_stampProWall(r, 'analyze_site', {}).wall).toBe(false);
  });
  it('leaves a non-Pro tool alone even when it carries required_plan', () => {
    const r = mk({ _gated: true, required_plan: 'pro' });
    expect(_stampProWall(r, 'get_facility', {}).wall).toBe(false);
  });
  it('keeps prose-bearing content[0] intact and still stamps structuredContent', () => {
    const r = mk({ _gated: true, required_plan: 'pro', upgrade_url: 'https://dchub.cloud/go/x' }, '{"a":1}\n\nprose');
    const { result, wall } = _stampProWall(r, 'compare_sites', {});
    expect(wall).toBe(true);
    expect(result.content[0].text).toBe('{"a":1}\n\nprose');
    expect(result.structuredContent._wall).toBe(true);
  });
  it('copy names no plan, no trial and no price (Note V keyed follow-up)', () => {
    for (const t of ['analyze_site', 'compare_sites', 'get_dchub_recommendation', 'generate_site_analysis', 'export_dataset']) {
      const m = proWallUserMessage(t, 'https://x.test/l') + ' ' + proWallAgentMessage(t);
      expect(m).toContain('This preview leaves out '); expect(m).toContain('This result is partial: some fields are not included at this access level.');
      expect(m).not.toMatch(/paid|trial|\bplan\b/i);
      expect(m).not.toMatch(/\$\d/); expect(m).not.toMatch(/\bPro\b/);
    }
  });
});

describe('handler wiring', () => {
  it('logs the status pro_wall from the stamper', () => {
    expect(SRC).toMatch(/_stampProWall\(_proWallRaw, name, c\)[\s\S]{0,80}status = 'pro_wall'/);
  });
});

describe('item 2: every Pro wall arm says what the preview leaves out, with no plan, trial or price (Note V keyed follow-up)', () => {
  it('the person line, for each Pro-only tool', async () => {
    const W = await import('../lib/wall-user-line.mjs');
    for (const t of ['analyze_site', 'compare_sites', 'get_dchub_recommendation', 'generate_site_analysis', 'export_dataset']) {
      const line = W.userLineText({ tool: t, offer: 'pro', link: 'https://dchub.cloud/u/abc234', headline: null });
      expect(line, t).toContain('This preview leaves out ');
      expect(line, t).toContain('. Open https://dchub.cloud/u/abc234 to see what your agent found.');
      expect(line, t).not.toMatch(/paid|trial|\bplan\b/i);
      expect(line, t).not.toMatch(/\bPro\b/);
      expect(line, t).not.toMatch(/\$\d|unlock/i);
    }
  });
  it('the relay link label on a Pro tool names no plan and no trial for Claude and Grok alike', async () => {
    const S = await import('../server.mjs');
    for (const p of ['claude', 'grok', 'chatgpt', '']) {
      const l = S._relayLinkLabel(p, 'analyze_site');
      expect(l, p).toMatch(/DC Hub/); expect(l, p).not.toMatch(/paid|trial|\bplan\b/i); expect(l, p).not.toMatch(/\$\d/);
      expect(l, p).not.toMatch(/\bPro\b/);
    }
  });
});
