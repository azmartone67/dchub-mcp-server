// Owner 2026-11-05: every wall offers $10 credits or Pro; pro_wall leads with Pro.
import { describe, it, expect } from 'vitest';
import {
  wallUpgradeOptions, wallUpgradeLine, attachWallUpgradeOffer,
  isFeatureWall, PACK_PRICE, PRO_NAME,
} from '../lib/wall-upgrade-offer.mjs';
import { keylessCapEmailResult, markEmailAsk, WALL_ASK_KINDS } from '../lib/keyless-wall.mjs';

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
