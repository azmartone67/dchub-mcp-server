// agent-feedback-ask.test.mjs — Change 5 (Grok -> Brain 2026-11-27): DCHUB_AGENT_FEEDBACK_ASK, default OFF.
// Pins:
//   - flag off (unset, 0, false, no, off): the result is the very object it was given, and no counter is asked;
//   - flag on: a full answer gains ONE extra text item, once per MCP session (replicas agree via the counter);
//     the existing items and structuredContent are the same objects, byte for byte;
//   - never on an error, wall, preview, partial or withheld answer, QA / bot callers, the frozen and review
//     profiles, a loopback step, no session, or the filing / key tools;
//   - the line names report_finding, class="agent_feedback" and the summary, and passes NOTE_F_WORDS;
//   - report_finding accepts class agent_feedback; a filed one stops the ask for that session and carries the tool;
//   - the call row of the answer that carried the line is marked params._feedback_ask = 1;
//   - end to end over /mcp (loopback backend stub): flag off = no line; on = one line on the first full answer only.
// NO real network.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer as httpServer } from 'node:http';
import * as FA from '../lib/agent-feedback-ask.mjs';
import { NOTE_F_WORDS } from '../lib/continuity-ask.mjs';
import { DIRECTORY_PROFILE } from '../lib/chatgpt-directory.mjs';
import { CLAUDE_PROFILE } from '../lib/claude-directory.mjs';
import { CORE_PROFILE } from '../lib/core-profile.mjs';

const FULL = () => ({ content: [{ type: 'text', text: '{"ok":true,"rows":[1,2]}' }, { type: 'text', text: 'Source: DC Hub' }],
  structuredContent: { ok: true, rows: [1, 2], citation: { completeness: 'full' } } });
const counter = () => { const m = new Map(); const calls = []; return { calls,
  consume: async (k) => { calls.push(k); const n = (m.get(k) || 0) + 1; m.set(k, n); return n; } }; };
const ON = { DCHUB_AGENT_FEEDBACK_ASK: '1' };
const step = (r, tool, o) => FA.feedbackAskStep(r, tool, { env: ON, sessionId: 's1', ...o });

describe('the copy', () => {
  it('names the tool, the class and the summary, and passes NOTE_F_WORDS (no price, plan, allowance or "free")', () => {
    for (const t of ['analyze_site', 'execute_plan', 'get_grid_intelligence', 'NOT A TOOL']) {
      const s = FA.feedbackAskText(t);
      expect(s).toContain('report_finding');
      expect(s).toContain('class="agent_feedback"');
      expect(s).toMatch(/summary/);
      expect(s).toMatch(/useful/);
      expect(s).toMatch(/missing/);
      expect(NOTE_F_WORDS.test(s), s).toBe(false);
      expect(/\b(price|paid|upgrade|subscription|allowance|limit)\b/i.test(s), s).toBe(false);
    }
    expect(FA.feedbackAskText('NOT A TOOL')).toContain('this tool');
  });
});

describe('the flag', () => {
  it('default OFF: unset and every off spelling return the same object and ask no counter', async () => {
    for (const env of [{}, { DCHUB_AGENT_FEEDBACK_ASK: '' }, ...['0', 'false', 'no', 'off', 'OFF', 'maybe'].map((v) => ({ DCHUB_AGENT_FEEDBACK_ASK: v }))]) {
      const C = counter(); const r = FULL();
      const out = await FA.feedbackAskStep(r, 'analyze_site', { env, sessionId: 's1', memo: FA.createFeedbackAskMemo(), consume: C.consume });
      expect(out.result).toBe(r);
      expect(out.shown).toBe(false);
      expect(C.calls).toEqual([]);
    }
  });
  it('on spellings', () => {
    for (const v of ['1', 'true', 'yes', 'on', 'TRUE', ' On ']) expect(FA.feedbackAskOn({ DCHUB_AGENT_FEEDBACK_ASK: v })).toBe(true);
  });
});

describe('once per session', () => {
  it('first full answer gets one extra item; existing items and structuredContent are the same objects', async () => {
    const C = counter(); const memo = FA.createFeedbackAskMemo(); const r = FULL();
    const before = JSON.stringify({ content: r.content, structuredContent: r.structuredContent });
    const out = await step(r, 'analyze_site', { memo, consume: C.consume });
    expect(out.shown).toBe(true);
    expect(out.result.content.length).toBe(r.content.length + 1);
    for (let i = 0; i < r.content.length; i++) expect(out.result.content[i]).toBe(r.content[i]);
    expect(out.result.structuredContent).toBe(r.structuredContent);
    expect(JSON.stringify({ content: out.result.content.slice(0, -1), structuredContent: out.result.structuredContent })).toBe(before);
    expect(out.result.content.at(-1)).toEqual({ type: 'text', text: FA.feedbackAskText('analyze_site') });
  });
  it('a second full answer in the same session: no line, and no second counter call on this replica', async () => {
    const C = counter(); const memo = FA.createFeedbackAskMemo();
    expect((await step(FULL(), 'analyze_site', { memo, consume: C.consume })).shown).toBe(true);
    const r2 = FULL();
    const out2 = await step(r2, 'get_grid_intelligence', { memo, consume: C.consume });
    expect(out2.shown).toBe(false);
    expect(out2.result).toBe(r2);
    expect(C.calls.length).toBe(1);
  });
  it('two replicas, one session, alternating: shown exactly once', async () => {
    const C = counter(); const reps = [FA.createFeedbackAskMemo(), FA.createFeedbackAskMemo()];
    const shown = [];
    for (let i = 0; i < 6; i++) shown.push((await step(FULL(), 'analyze_site', { memo: reps[i % 2], consume: C.consume })).shown);
    expect(shown).toEqual([true, false, false, false, false, false]);
  });
  it('another session gets its own line', async () => {
    const C = counter(); const memo = FA.createFeedbackAskMemo();
    expect((await step(FULL(), 'analyze_site', { memo, consume: C.consume, sessionId: 'a' })).shown).toBe(true);
    expect((await step(FULL(), 'analyze_site', { memo, consume: C.consume, sessionId: 'b' })).shown).toBe(true);
  });
  it('counter down, throwing or malformed: fail closed (no line), and the next answer may still ask', async () => {
    for (const bad of [async () => null, async () => { throw new Error('x'); }, async () => 'one', undefined]) {
      const memo = FA.createFeedbackAskMemo(); const r = FULL();
      const out = await step(r, 'analyze_site', { memo, consume: bad });
      expect(out.shown).toBe(false); expect(out.result).toBe(r);
      expect(memo.done('s1')).toBe(false);
    }
  });
  it('a session that filed agent_feedback first is never asked (this replica, and another via the counter)', async () => {
    const C = counter(); const a = FA.createFeedbackAskMemo(); const b = FA.createFeedbackAskMemo();
    expect(await FA.noteFeedbackFiled('s1', { memo: a, consume: C.consume })).toBe(true);
    expect((await step(FULL(), 'analyze_site', { memo: a, consume: C.consume })).shown).toBe(false);
    expect((await step(FULL(), 'analyze_site', { memo: b, consume: C.consume })).shown).toBe(false);
  });
  it('the counter key is a hash, never the session id', () => {
    const k = FA.sharedAskKey('sess-123');
    expect(k).toMatch(/^fa:[0-9a-f]{32}$/);
    expect(k).not.toContain('sess-123');
  });
});

describe('never on', () => {
  const memo = () => FA.createFeedbackAskMemo();
  const variants = {
    isError: (r) => ({ ...r, isError: true }),
    error_field: (r) => ({ ...r, structuredContent: { ...r.structuredContent, error: 'pro_required' } }),
    ok_false: (r) => ({ ...r, structuredContent: { ...r.structuredContent, ok: false } }),
    wall: (r) => ({ ...r, structuredContent: { ...r.structuredContent, _wall: true } }),
    gated: (r) => ({ ...r, structuredContent: { ...r.structuredContent, _gated: true } }),
    preview_only: (r) => ({ ...r, structuredContent: { ...r.structuredContent, _preview_only: true } }),
    pro_wall: (r) => ({ ...r, structuredContent: { ...r.structuredContent, pro_wall: { tool: 'x' } } }),
    quota_wall: (r) => ({ ...r, structuredContent: { ...r.structuredContent, quota_wall: true } }),
    upgrade: (r) => ({ ...r, structuredContent: { ...r.structuredContent, _upgrade: { tier: 'trial' } } }),
    partial_preview: (r) => ({ ...r, structuredContent: { ...r.structuredContent, citation: { completeness: 'partial_preview' } } }),
    completeness_partial: (r) => ({ ...r, structuredContent: { ...r.structuredContent, completeness: { status: 'partial' } } }),
    withheld_fields: (r) => ({ ...r, structuredContent: { ...r.structuredContent, provenance: { preview: { withheld_fields: ['mw'] } } } }),
    star_withheld: (r) => ({ ...r, structuredContent: { ...r.structuredContent, capacity_mw_withheld: true } }),
    status_wall: (r) => ({ ...r, structuredContent: { ...r.structuredContent, status: 'trial_cap_exceeded' } }),
    failure_envelope: (r) => ({ ...r, structuredContent: { ...r.structuredContent, _error_mitigation: { error_code: 'x' } } }),
    text_json_error: () => ({ content: [{ type: 'text', text: '{"error":"tool_execution_failed"}' }] }),
    empty_content: () => ({ content: [] }),
  };
  for (const [k, mk] of Object.entries(variants)) {
    it(k, async () => {
      const C = counter(); const r = mk(FULL());
      const out = await step(r, 'analyze_site', { memo: memo(), consume: C.consume });
      expect(out.shown).toBe(false); expect(out.result).toBe(r); expect(C.calls).toEqual([]);
    });
  }
  it('gated / excluded / skipProfile / no session / no memo', async () => {
    for (const o of [{ gated: true }, { excluded: true }, { skipProfile: true }, { sessionId: '' }, { memo: null }]) {
      const C = counter(); const r = FULL();
      const out = await step(r, 'analyze_site', { memo: memo(), consume: C.consume, ...o });
      expect(out.result).toBe(r); expect(C.calls).toEqual([]);
    }
  });
  it('the filing, key and self-description tools', async () => {
    for (const t of ['report_finding', 'request_enhancement', 'get_api_key', 'discover_tools', 'dchub_services', 'why_dchub']) {
      const C = counter(); const r = FULL();
      expect((await step(r, t, { memo: memo(), consume: C.consume })).result).toBe(r);
    }
  });
  it('an answer that already carries the line', async () => {
    const C = counter(); const r = FA.appendFeedbackAsk(FULL(), 'analyze_site');
    expect((await step(r, 'analyze_site', { memo: memo(), consume: C.consume })).result).toBe(r);
  });
});

describe('asks-shown mark on the held call row', () => {
  it('marks only unsent rows of the tool, and leaves params otherwise unchanged', () => {
    const c = { _heldTrackRows: [
      { sent: false, row: { tool: 'analyze_site', params: { lat: 1 } } },
      { sent: true, row: { tool: 'analyze_site', params: { lat: 2 } } },
      { sent: false, row: { tool: 'other', params: {} } },
    ] };
    expect(FA.markHeldRowsAsked(c, 'analyze_site')).toBe(1);
    expect(c._heldTrackRows[0].row.params).toEqual({ lat: 1, _feedback_ask: 1 });
    expect(c._heldTrackRows[1].row.params).toEqual({ lat: 2 });
    expect(c._heldTrackRows[2].row.params).toEqual({});
  });
});

// ── server.mjs wiring, over a loopback backend ───────────────────────────────────────────────
const PARTNER = 'dchub_pro_' + 'feedbackkey00000'.repeat(2);
const INTERNAL = 'test-internal-key-not-a-real-secret';
let S, stub, srv, PORT, hits = [];
const counts = new Map();
const ENV = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_AGENT_FEEDBACK_ASK'];
const prev = {};

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = httpServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
        hits.push({ path: u.pathname, method: req.method, headers: { ...req.headers }, body: b });
        res.setHeader('content-type', 'application/json');
        if (u.pathname === '/api/v1/keys/validate') {
          const k = (() => { try { return JSON.parse(b).api_key; } catch { return ''; } })();
          res.end(JSON.stringify(k === PARTNER ? { valid: true, tier: 'pro' } : { valid: false, tier: 'free' })); return;
        }
        if (u.pathname === '/api/v1/mcp/full-cap/consume') {
          const j = JSON.parse(b || '{}'); const key = j.identity + '|' + j.tool;
          const n = (counts.get(key) || 0) + 1; counts.set(key, n);
          res.end(JSON.stringify({ ok: true, n, remaining: Math.max(0, (j.cap || 0) - n), exceeded: n > (j.cap || 0) })); return;
        }
        if (u.pathname === '/api/v1/inbox/findings' && req.method === 'POST') {
          const body = JSON.parse(b || '{}');
          res.statusCode = 201;
          res.end(JSON.stringify({ ok: true, finding_id: 91, status: 'received', recurrence: 1,
            message: 'Thanks. The DC Hub team reviews findings daily.', id: 91, result: 'created',
            issue_label: `external_audit:${body.class}:${body.tool}`, detector: 'external_audit', caller_tier: 'keyless' }));
          return;
        }
        if (u.pathname === '/api/v1/site-selection/canvas') {
          res.end(JSON.stringify({ ok: true, matched: 3, shortlist: [{ market: 'Dallas', verdict: 'BUILD' }] })); return;
        }
        res.end('{}');
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = INTERNAL;
  delete process.env.DCHUB_AGENT_FEEDBACK_ASK;
  S = await import('../server.mjs');
  await new Promise((resolve) => { srv = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = srv.address().port;
}, 60000);
afterEach(() => { hits = []; delete process.env.DCHUB_AGENT_FEEDBACK_ASK; });
afterAll(async () => {
  await new Promise((r) => srv.close(r)); await new Promise((r) => stub.close(r));
  for (const k of ENV) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
});

async function post(path, headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
  const raw = await res.text();
  const json = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, raw, msg: json.trim() ? JSON.parse(json) : null };
}
async function open(path = '/mcp', extra = {}, clientName = 'codex-mcp-client') {
  const init = await post(path, extra, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...(sid ? { 'mcp-session-id': sid } : {}), ...extra };
  if (sid) await post(path, h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return { h, path, sid };
}
const call = (s, name, args, id = 9) => post(s.path, s.h, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args || {} } });
const list = async (s) => (await post(s.path, s.h, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).msg.result.tools;
const asked = (r) => (r.content || []).some((c) => typeof c.text === 'string' && c.text.includes(FA.FEEDBACK_ASK_MARKER));
const CANVAS = { region: 'texas', capacity_mw: 100 };
const KEYED = { 'x-api-key': PARTNER, 'user-agent': 'codex-mcp-client/0.160.0' };

describe('server.mjs: report_finding takes class agent_feedback', () => {
  it('/mcp lists agent_feedback in report_finding\'s class enum; /mcp/claude does not (its reviewed schema)', async () => {
    const t = await list(await open('/mcp', {}, 'acme-agent'));
    expect(t.length).toBe(99);
    expect(t.find((x) => x.name === 'report_finding').inputSchema.properties.class.enum).toContain('agent_feedback');
    const tc = await list(await open('/mcp/claude', {}, 'acme-agent'));
    const rc = tc.find((x) => x.name === 'report_finding');
    expect(rc.inputSchema.properties.class.enum).not.toContain('agent_feedback');
    expect(String(rc.inputSchema.properties.class.description || '')).not.toContain('agent_feedback');
    expect([...rc.inputSchema.properties.class.enum]).toEqual(S.FINDING_CLASSES.filter((x) => x !== 'agent_feedback'));
  });
  it('a keyless agent_feedback with no tool files under the tool whose answer carried the ask', async () => {
    const memo = S._feedbackAskMemoForTest;
    memo.shown('sess-fb-1', 'analyze_site');
    const consumed = [];
    const r = await S._reportFindingTool(null, { class: 'agent_feedback', summary: 'The headline was useful; the substation list was missing.' },
      undefined, { ctx: { session_id: 'sess-fb-1' }, consumeAsk: async (k) => { consumed.push(k); return 2; } });
    expect(r.isError).toBeFalsy();
    const f = hits.filter((x) => x.path === '/api/v1/inbox/findings');
    expect(f.length).toBe(1);
    const body = JSON.parse(f[0].body);
    expect(body).toMatchObject({ class: 'agent_feedback', tool: 'analyze_site' });
    expect(f[0].headers['x-api-key']).toBeUndefined();
    expect(memo.get('sess-fb-1').state).toBe('filed');
    expect(consumed).toEqual([], 'already shown on this replica: the counter is already past 1');
  });
  it('agent_feedback with no session and no tool files under general', async () => {
    await S._reportFindingTool(null, { class: 'agent_feedback', summary: 'Useful answer, missing the water data.' }, undefined, { ctx: {} });
    expect(JSON.parse(hits.find((x) => x.path === '/api/v1/inbox/findings').body).tool).toBe('general');
  });
});

describe('server.mjs: the step skips', () => {
  const C = () => counter();
  it('QA, bots, the frozen and review profiles, a clean platform, a loopback step, no session', async () => {
    for (const c of [
      { session_id: 'sx1', user_agent: 'dchub-qa-readonly' }, { session_id: 'sx2', qa_marker: true },
      { session_id: 'sx3', user_agent: 'SomeCrawlerBot/1.0' },
      { session_id: 'sx4', profile: DIRECTORY_PROFILE }, { session_id: 'sx4b', profile: CLAUDE_PROFILE }, { session_id: 'sx4c', profile: CORE_PROFILE }, { session_id: 'sx5', source: 'claude-directory' },
      { session_id: 'sx6', source: 'meta-muse' }, { session_id: 'sx7', platform: 'chatgpt' },
      { session_id: 'sx8', loopback_step: true }, { session_id: 'no-session' }, {},
      { session_id: 'Content-Type, Mcp-Session-Id' },
    ]) {
      const k = C(); const r = FULL();
      const out = await S._feedbackAskStep(r, 'analyze_site', c, k.consume, ON);
      expect(out, JSON.stringify(c)).toBe(r);
      expect(k.calls).toEqual([]);
    }
  });
  it('flag off: the same object; flag on, an ordinary session: one line', async () => {
    const k = C(); const r = FULL();
    expect(await S._feedbackAskStep(r, 'analyze_site', { session_id: 'sy1' }, k.consume, {})).toBe(r);
    const out = await S._feedbackAskStep(r, 'analyze_site', { session_id: 'sy1' }, k.consume, ON);
    expect(asked(out)).toBe(true);
  });
});

describe('end to end on /mcp', () => {
  it('flag off: a full answer carries no line', async () => {
    const s = await open('/mcp', KEYED);
    const r = (await call(s, 'site_selection_canvas', CANVAS)).msg.result;
    expect(r.isError).toBeFalsy();
    expect(asked(r)).toBe(false);
    expect(hits.some((x) => x.path === '/api/v1/mcp/full-cap/consume' && x.body.includes('agent_feedback_ask'))).toBe(false);
  });
  it('flag on: the first full answer carries one line, the second does not; the rest of the answer is unchanged', async () => {
    const off = (await call(await open('/mcp', KEYED), 'site_selection_canvas', CANVAS)).msg.result;
    process.env.DCHUB_AGENT_FEEDBACK_ASK = '1';
    const s = await open('/mcp', KEYED);
    const r1 = (await call(s, 'site_selection_canvas', CANVAS, 10)).msg.result;
    const r2 = (await call(s, 'site_selection_canvas', CANVAS, 11)).msg.result;
    expect(r1.content.filter((c) => c.text && c.text.includes(FA.FEEDBACK_ASK_MARKER)).length).toBe(1);
    expect(r1.content.at(-1).text).toBe(FA.feedbackAskText('site_selection_canvas'));
    expect(asked(r2)).toBe(false);
    // Aside from the extra item, the answer is the flag-off answer (timestamps and per-session ids normalised).
    const norm = (x) => JSON.stringify(x).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, 'T')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'U').replace(/"duration_ms":\d+/g, '"duration_ms":0');
    expect(norm(r1.content.slice(0, -1))).toBe(norm(off.content));
    expect(norm(r1.structuredContent)).toBe(norm(off.structuredContent));
    expect(norm(r2.content)).toBe(norm(off.content));
    // asks shown: exactly one /api/v1/mcp/track call row carries params._feedback_ask = 1 (the first answer's).
    await new Promise((r) => setTimeout(r, 300));
    const rows = hits.filter((x) => x.path === '/api/v1/mcp/track').map((x) => { try { return JSON.parse(x.body); } catch { return {}; } })
      .filter((j) => j.tool === 'site_selection_canvas');
    expect(rows.filter((j) => j.params && j.params._feedback_ask === 1).length).toBe(1);
  });
});
