// Owner 2026-11-05: every wall offers $10 credits or Pro; pro_wall leads with Pro.
// Note K item 8 (2026-11-15): ONE route per wall, no plan and no price (the default). The 2026-11-05 offers below
// are pinned under the kill switch DCHUB_WALL_ONE_ROUTE=0; the one-route default is pinned in its own block.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  wallUpgradeOptions, wallUpgradeLine, attachWallUpgradeOffer, wallOneRoute, ONE_ROUTE_LABEL,
  isFeatureWall, PACK_PRICE, PRO_NAME,
} from '../lib/wall-upgrade-offer.mjs';
import { keylessCapEmailResult, markEmailAsk, WALL_ASK_KINDS } from '../lib/keyless-wall.mjs';

const CONNECT = 'https://dchub.cloud/connect';
const PLAN_OR_PRICE = /\b(?:Developer|Pro|Starter|Enterprise|Founding|Lite)\b|\$\s?\d|Credit Pack|\bpaid\b|\bplan\b/;

describe('one route per wall (note K item 8, the default)', () => {
  const urls = { packUrl: 'https://dchub.cloud/go/c/pack', proUrl: 'https://dchub.cloud/go/c/pro' };
  const cases = [
    // Note L1 + L2: whatever links the wall was handed, the one route's link is https://dchub.cloud/connect.
    ['keyless usage wall with an email link', { ...urls, kind: 'anon_daily_cap', keyless: true, emailUrl: 'https://dchub.cloud/u/abc123' }, 'email_unlock', CONNECT],
    ['keyless feature wall with an email link', { ...urls, kind: 'pro_wall', keyless: true, emailUrl: 'https://dchub.cloud/u/abc123' }, 'email_unlock', CONNECT],
    ['keyed feature wall', { ...urls, kind: 'pro_wall' }, 'full_access', CONNECT],
    ['keyed lp wall', { ...urls, kind: 'lp_wall' }, 'full_access', CONNECT],
    ['keyed usage wall', { ...urls, kind: 'trial_cap_exceeded' }, 'more_answers', CONNECT],
  ];
  it.each(cases)('%s: exactly one option, no plan, no price, a plain sentence', (_l, o, id, url) => {
    const opts = wallUpgradeOptions(o);
    expect(opts).toHaveLength(1);
    expect(opts[0]).toEqual({ id, label: ONE_ROUTE_LABEL[id], url, unlocks: expect.any(String) });
    expect(opts[0].plan).toBeUndefined();
    expect(opts[0].price).toBeUndefined();
    expect(JSON.stringify(opts)).not.toMatch(PLAN_OR_PRICE);
    expect(opts[0].label).toMatch(/^[A-Z].*\.$/);
    expect(opts[0].label.split(/\.\s+[A-Z]/)).toHaveLength(1);   // one sentence
    if (id === 'email_unlock') expect(opts[0].label).toContain('with an email');   // option A: no allowance figure
    expect(opts[0].label).not.toMatch(/calls\/day|free key|credits/i);
    expect(wallOneRoute(o)).toEqual(opts);
  });
  it('the wall line is one sentence with the one link, no plan or price', () => {
    for (const kind of ['usage', 'pro_wall']) {
      const line = wallUpgradeLine({ kind, ...urls, tool: 'analyze_site' });
      expect(line).not.toMatch(PLAN_OR_PRICE);
      expect((line.match(/https:\/\//g) || []).length).toBe(1);
    }
  });
  it('attachWallUpgradeOffer: one option, one link, no credits_url / pro_url, one plain line', () => {
    const out = attachWallUpgradeOffer({ content: [{ type: 'text', text: 'preview' }], structuredContent: { tool: 'rank_markets' } },
      { kind: 'trial_cap_exceeded', ...urls, tool: 'rank_markets' });
    expect(out.structuredContent.upgrade_options).toHaveLength(1);
    expect(out.structuredContent.credits_url).toBeUndefined();
    expect(out.structuredContent.pro_url).toBeUndefined();
    expect(out.structuredContent.human_url).toBe(CONNECT);
    expect(out.content.map((b) => b.text).join('\n')).not.toMatch(PLAN_OR_PRICE);
  });
  it('keylessCapEmailResult: the email link is the only route', () => {
    const wall = keylessCapEmailResult({ name: 'rank_markets', link: 'https://dchub.cloud/u/abc123', ...urls, wallKind: 'anon_daily_cap' });
    expect(wall.structuredContent.upgrade_options.map((o) => o.id)).toEqual(['email_unlock']);
    expect(JSON.stringify(wall)).not.toMatch(/\/go\/c\/|\$\d|\bPro\b|Credit Pack/);
  });
});

describe('DCHUB_WALL_ONE_ROUTE=0: the 2026-11-05 pack / Pro offers', () => {
beforeAll(() => { process.env.DCHUB_WALL_ONE_ROUTE = '0'; });
afterAll(() => { delete process.env.DCHUB_WALL_ONE_ROUTE; });

describe('wallUpgradeOptions', () => {
  it('usage wall leads with $10 pack then Pro', () => {
    const opts = wallUpgradeOptions({
      packUrl: 'https://dchub.cloud/go/c/pack',
      proUrl: 'https://dchub.cloud/go/c/pro',
      kind: 'anon_daily_cap',
    });
    expect(opts[0].id).toBe('metered');
    expect(opts[0].price).toBe(PACK_PRICE);
    expect(opts[0].url).toContain('/go/c/pack');
    expect(opts[0].unlocks).toBe('usage_capacity_only');
    expect(opts[1].id).toBe('pro');
    expect(opts[1].label).toContain(PRO_NAME);
  });

  it('pro_wall leads with Pro and notes credits do not unlock', () => {
    const opts = wallUpgradeOptions({
      packUrl: 'https://dchub.cloud/go/c/pack',
      proUrl: 'https://dchub.cloud/go/c/pro',
      kind: 'pro_wall',
    });
    expect(isFeatureWall('pro_wall')).toBe(true);
    expect(opts[0].id).toBe('pro');
    expect(opts[1].id).toBe('metered');
    expect(opts[1].note).toMatch(/do not unlock/i);
  });

  it('keyless usage wall includes free email unlock first', () => {
    const opts = wallUpgradeOptions({
      packUrl: 'https://dchub.cloud/go/c/pack',
      proUrl: 'https://dchub.cloud/go/c/pro',
      kind: 'trial_used',
      keyless: true,
      emailUrl: 'https://dchub.cloud/u/abc123',
    });
    expect(opts[0].id).toBe('email_unlock');
    expect(opts[0].price).toBe('free');
    expect(opts[1].id).toBe('metered');
    expect(opts[2].id).toBe('pro');
  });
});

describe('wallUpgradeLine', () => {
  it('names $10 and Pro on usage walls', () => {
    const line = wallUpgradeLine({
      kind: 'usage',
      packUrl: 'https://dchub.cloud/go/c/pack',
      proUrl: 'https://dchub.cloud/go/c/pro',
    });
    expect(line).toMatch(/\$10/);
    expect(line).toMatch(/\bPro\b/);
    expect(line).toMatch(/do not unlock/i);
  });

  it('pro_wall leads with Pro honesty', () => {
    const line = wallUpgradeLine({
      kind: 'pro_wall',
      packUrl: 'https://dchub.cloud/go/c/pack',
      proUrl: 'https://dchub.cloud/go/c/pro',
      tool: 'analyze_site',
    });
    expect(line.indexOf('Pro')).toBeLessThan(line.indexOf('$10'));
    expect(line).toMatch(/analyze_site/);
    expect(line).toMatch(/do not unlock/i);
  });
});

describe('attachWallUpgradeOffer', () => {
  it('adds upgrade_options and $10/Pro prose without throwing', () => {
    const result = {
      content: [{ type: 'text', text: 'preview' }],
      structuredContent: { tool: 'rank_markets' },
    };
    const out = attachWallUpgradeOffer(result, {
      kind: 'trial_cap_exceeded',
      packUrl: 'https://dchub.cloud/go/c/pack',
      proUrl: 'https://dchub.cloud/go/c/pro',
      tool: 'rank_markets',
    });
    expect(out.structuredContent.upgrade_options.length).toBe(2);
    expect(out.structuredContent.credits_url).toContain('/go/c/pack');
    expect(out.structuredContent.pro_url).toContain('/go/c/pro');
    const text = out.content.map((b) => b.text).join('\n');
    expect(text).toMatch(/\$10/);
    expect(text).toMatch(/\bPro\b/);
  });
});

describe('keylessCapEmailResult carries email + $10 + Pro', () => {
  it('marks email ask and lists all three options', () => {
    const c = {};
    const wall = keylessCapEmailResult({
      name: 'rank_markets',
      link: 'https://dchub.cloud/u/abc123',
      packUrl: 'https://dchub.cloud/go/c/pack',
      proUrl: 'https://dchub.cloud/go/c/pro',
      wallKind: 'anon_daily_cap',
    });
    expect(wall).toBeTruthy();
    expect(wall.structuredContent.human_url).toContain('/u/abc123');
    expect(wall.structuredContent.upgrade_options[0].id).toBe('email_unlock');
    expect(wall.structuredContent.upgrade_options.some((o) => o.id === 'metered')).toBe(true);
    expect(wall.structuredContent.upgrade_options.some((o) => o.id === 'pro')).toBe(true);
    expect(wall.content[0].text).toMatch(/\$10/);
    expect(wall.content[0].text).toMatch(/\bPro\b/);
    markEmailAsk(c, 'link');
    expect(WALL_ASK_KINDS.has(c._emailAsk)).toBe(true);
  });
});
});
