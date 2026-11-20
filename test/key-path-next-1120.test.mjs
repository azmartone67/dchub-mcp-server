// Grok cold-start note 2026-11-20, fix 2 (lib/key-path-next.mjs): a keyless execute_plan answer names the key tool.
//
// Pins, over the real server.mjs app on loopback with a stub backend (no network):
//   - keyless execute_plan on /mcp carries next_tools -> {tool: get_api_key, args: {}, say: KEY_PATH_LINE}, last;
//   - a keyed caller, a ChatGPT-identified client and /mcp/core do not get it;
//   - within one session it rides the first keyless answer only; DCHUB_KEY_PATH_NEXT=0 turns it off;
//   - the line names no plan, price or allowance, and the entry carries no email.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import * as K from '../lib/key-path-next.mjs';

const FORBIDDEN = /\b(paid|upgrade|trial|plans?|pricing|price|\$\s?\d|per month|subscription|free|credits?|calls? a day|per day|Pro|Developer|Enterprise)\b/i;
const UA = { 'user-agent': 'Claude-User' };
const INTENT = { intent: 'Which US markets have the most available power for a 100 MW data center by 2028?' };

let H, fence;
beforeAll(async () => { fence = fenceNetwork(); H = await startHarness(); }, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
afterEach(() => { delete process.env[K.KEY_PATH_NEXT_FLAG]; });

const body0 = (r) => { const res = (r.msg && r.msg.result) || {}; try { return JSON.parse(res.content[0].text); } catch (_) { return res.structuredContent || {}; } };
const keyEntries = (r) => (body0(r).next_tools || []).filter((e) => e && (e.tool === 'get_api_key' || e.tool === 'claim_free_key'));
let n = 0;
const sid = () => `keypath-test-${Date.now()}-${n++}`;

describe('keyless execute_plan -> get_api_key in next_tools', () => {
  it('a keyless answer carries the entry, last, with the line', async () => {
    const r = await H.call('/mcp', 'execute_plan', INTENT, { ...UA, 'mcp-session-id': sid() });
    const nt = body0(r).next_tools;
    expect(Array.isArray(nt)).toBe(true);
    expect(nt[nt.length - 1]).toEqual({ tool: 'get_api_key', args: {}, say: K.KEY_PATH_LINE });
    expect(keyEntries(r)).toHaveLength(1);
  });
  it('rides the first keyless answer of a session only', async () => {
    const h = { ...UA, 'mcp-session-id': sid() };
    expect(keyEntries(await H.call('/mcp', 'execute_plan', INTENT, h))).toHaveLength(1);
    expect(keyEntries(await H.call('/mcp', 'execute_plan', INTENT, h))).toHaveLength(0);
  });
  it('a keyed caller does not get it', async () => {
    const r = await H.call('/mcp', 'execute_plan', INTENT, { ...UA, 'x-api-key': PRO_KEY, 'mcp-session-id': sid() });
    expect(keyEntries(r)).toHaveLength(0);
  });
  it('a ChatGPT-identified client and /mcp/core do not get it (the freeze surfaces)', async () => {
    expect(keyEntries(await H.call('/mcp', 'execute_plan', INTENT, { 'user-agent': 'openai-mcp/1.0.0', 'mcp-session-id': sid() }))).toHaveLength(0);
    expect(keyEntries(await H.call('/mcp/core', 'execute_plan', INTENT, { ...UA, 'mcp-session-id': sid() }))).toHaveLength(0);
  });
  it('DCHUB_KEY_PATH_NEXT=0 turns it off', async () => {
    process.env[K.KEY_PATH_NEXT_FLAG] = '0';
    expect(keyEntries(await H.call('/mcp', 'execute_plan', INTENT, { ...UA, 'mcp-session-id': sid() }))).toHaveLength(0);
  });
});

describe('lib/key-path-next.mjs', () => {
  it('the line names no plan, price or allowance; the entry carries no email', () => {
    expect(K.KEY_PATH_LINE).not.toMatch(FORBIDDEN);
    expect(K.keyPathNextTool({}).args).toEqual({});
  });
  it('follows the listed key-tool name, appends once, leaves a non-array alone', () => {
    expect(K.keyPathNextTool({ DCHUB_GET_API_KEY_LISTED: '0' })).toEqual({ tool: 'claim_free_key', args: {}, say: 'To keep this shortlist and get alerts, share your email with claim_free_key.' });
    const o = { next_tools: [{ tool: 'report_finding' }] };
    K.attachKeyPathNext(o, {}); K.attachKeyPathNext(o, {});
    expect(o.next_tools.map((e) => e.tool)).toEqual(['report_finding', 'get_api_key']);
    expect(K.attachKeyPathNext({ next_tools: 'x' }, {})).toEqual({ next_tools: 'x' });
  });
});
