// offer-floor-standing.test.mjs: every wall row says where it stands under the offer floor (owner 2026-11-11,
// "Measure allowed only"). The floor (lib/wall-offer-floor.mjs) skips Grok, the directory / Claude / core
// profiles, a clean platform, execute_plan steps and the key / email tools by design; the funnel reads the
// 95% offer target over the walls it is allowed on, so each row carries offer_floor (server.mjs
// _floorStanding -> lib/keyless-wall.mjs quotaWallEventBody; dchub-backend OFFER_FLOOR_STANDINGS).
// The every-wall HTTP test asserts offer_floor 'allowed' on every row it sees, plan step rows included.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { quotaWallEventBody, OFFER_FLOOR_STANDINGS } from '../lib/keyless-wall.mjs';
import { FLOOR_EMAIL_LEAD, FLOOR_DIGEST_LEAD } from '../lib/wall-offer-floor.mjs';

let S, fence;
const prev = {};
beforeAll(async () => {
  fence = fenceNetwork();
  for (const k of ['DCHUB_WALL_OFFER_FLOOR', 'DCHUB_API_BASE', 'DCHUB_WORKOS_OAUTH_ENABLED']) prev[k] = process.env[k];
  delete process.env.DCHUB_WALL_OFFER_FLOOR;
  // The standing is read with WorkOS validation off; the OAuth lead (and Grok's extra block) are in test/wall-oauth-lead.test.mjs.
  delete process.env.DCHUB_WORKOS_OAUTH_ENABLED;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:9';
  S = await import('../server.mjs');
}, 60_000);
afterAll(() => {
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (fence) fence.restore();
});

const wall = () => ({ content: [{ type: 'text', text: '{"preview":true}' }] });
const ctx = (o = {}, tool = 'rank_markets') => ({ session_id: 's-floor', platform: 'cursor', auth_source: 'none', tier: 'anonymous',
  _pendingWallHits: [{ name: tool, status: 'anon_hard_wall', sent: false }], ...o });
const textOf = (r) => r.content.map((b) => b.text || '').join('\n');
const floored = (r) => textOf(r).includes(FLOOR_EMAIL_LEAD) || textOf(r).includes(FLOOR_DIGEST_LEAD);

describe('_floorStanding via _wallOfferFloorStep', () => {
  it('control: a plain /mcp wall is allowed and gets the floor line', () => {
    const c = ctx();
    const out = S._wallOfferFloorStep(wall(), 'rank_markets', c);
    expect(c._offerFloor).toBe('allowed');
    expect(floored(out)).toBe(true);
  });
  it.each([
    ['grok', { platform: 'grok' }, 'rank_markets'],
    ['grok', { platform: 'connectors-manager' }, 'rank_markets'],
    ['profile', { profile: 'claude_directory' }, 'rank_markets'],
    ['profile', { profile: 'chatgpt_directory' }, 'rank_markets'],
    ['profile', { profile: 'core_profile' }, 'rank_markets'],
    ['plan_step', { loopback_step: true }, 'rank_markets'],
    ['tool', {}, 'bind_email'],
  ])('%s (%j, %s): stamped, and the wall is left as it was', (want, o, tool) => {
    const c = ctx(o, tool);
    const input = wall();
    const out = S._wallOfferFloorStep(input, tool, c);
    expect(c._offerFloor).toBe(want);
    expect(out).toBe(input);
  });
  it('kill switch: off, no line', () => {
    process.env.DCHUB_WALL_OFFER_FLOOR = '0';
    try {
      const c = ctx();
      const input = wall();
      expect(S._wallOfferFloorStep(input, 'rank_markets', c)).toBe(input);
      expect(c._offerFloor).toBe('off');
    } finally { delete process.env.DCHUB_WALL_OFFER_FLOOR; }
  });
  it('every standing the server stamps is one the wall body sends', () => {
    for (const s of ['allowed', 'grok', 'profile', 'plan_step', 'tool', 'off', 'clean']) expect(OFFER_FLOOR_STANDINGS.has(s)).toBe(true);
  });
});

describe('quotaWallEventBody offer_floor', () => {
  const body = (c) => quotaWallEventBody({ c: { session_id: 's-1', ...c }, name: 'rank_markets', status: 'anon_hard_wall' });
  it('sends the standing it was given', () => {
    for (const s of OFFER_FLOOR_STANDINGS) expect(body({ _offerFloor: s }).offer_floor).toBe(s);
  });
  it('absent or unknown: no field (the backend reads unknown, never allowed)', () => {
    expect('offer_floor' in body({})).toBe(false);
    expect('offer_floor' in body({ _offerFloor: 'maybe' })).toBe(false);
  });
});
