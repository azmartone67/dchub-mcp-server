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
    expect(sc.user_message).toContain('DC Hub Pro');
    expect(sc.user_message).toContain('7-day');
    expect(sc.user_message).toContain('https://dchub.cloud/upgrade/h/abc');
    expect(sc.for_your_human.url).toBe('https://dchub.cloud/upgrade/h/abc');
    expect(JSON.parse(result.content[0].text)._wall).toBe(true);
    expect(JSON.stringify(sc)).not.toMatch(/\$\d/);
  });
  it('keeps a compliant user_message and for_your_human, replaces one that names neither Pro nor the trial', () => {
    const good = 'DC Hub Pro has the report. Start a 7-day Pro trial: https://u.test/1';
    const keep = _stampProWall(mk({ _gated: true, required_plan: 'pro', user_message: good,
      for_your_human: { text: good, url: 'https://u.test/1' } }), 'analyze_site', {}).result.structuredContent;
    expect(keep.user_message).toBe(good); expect(keep.for_your_human.text).toBe(good);
    const fix = _stampProWall(mk({ _gated: true, required_plan: 'pro', user_message: 'open the link',
      for_your_human: { text: 'see what I found', url: 'https://u.test/2' } }), 'analyze_site', {}).result.structuredContent;
    expect(fix.user_message).toContain('DC Hub Pro'); expect(fix.user_message).toContain('7-day Pro trial: https://u.test/2');
    expect(fix.for_your_human.url).toBe('https://u.test/2'); expect(fix.for_your_human.text).toBe(fix.user_message);
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
  it('copy names DC Hub Pro and the 7-day trial with no price', () => {
    for (const t of ['analyze_site', 'compare_sites', 'get_dchub_recommendation', 'generate_site_analysis', 'export_dataset']) {
      const m = proWallUserMessage(t, 'https://x.test/l') + ' ' + proWallAgentMessage(t);
      expect(m).toContain('DC Hub Pro'); expect(m).toContain('7-day'); expect(m).not.toMatch(/\$\d/);
    }
  });
});

describe('handler wiring', () => {
  it('logs the status pro_wall from the stamper', () => {
    expect(SRC).toMatch(/_stampProWall\(_proWallRaw, name, c\)[\s\S]{0,80}status = 'pro_wall'/);
  });
});

describe('item 2: every Pro wall arm names DC Hub Pro and the 7-day trial, with no price', () => {
  it('the person line, for each Pro-only tool', async () => {
    const W = await import('../lib/wall-user-line.mjs');
    for (const t of ['analyze_site', 'compare_sites', 'get_dchub_recommendation', 'generate_site_analysis', 'export_dataset']) {
      const line = W.userLineText({ tool: t, offer: 'pro', link: 'https://dchub.cloud/u/abc234', headline: null });
      expect(line, t).toContain('DC Hub Pro');
      expect(line, t).toContain('7-day Pro trial: https://dchub.cloud/u/abc234');
      expect(line, t).not.toMatch(/\$\d|unlock/i);
    }
  });
  it('the relay link label on a Pro tool names Pro and the trial for Claude and Grok alike', async () => {
    const S = await import('../server.mjs');
    for (const p of ['claude', 'grok', 'chatgpt', '']) {
      const l = S._relayLinkLabel(p, 'analyze_site');
      expect(l, p).toContain('DC Hub Pro'); expect(l, p).toMatch(/7-day (free )?trial/); expect(l, p).not.toMatch(/\$\d/);
    }
  });
});
