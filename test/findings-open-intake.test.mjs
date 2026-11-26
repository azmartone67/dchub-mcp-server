// report_finding opened to every caller + request_enhancement (2026-11-16, owner "Let's do both").
// Pins:
//   - both tools are in tools/list on /mcp and /mcp/claude (97 on /mcp), neither on the frozen /mcp/chatgpt;
//   - a KEYLESS call files (finding_id back, not a key-required error) and reaches the backend with no X-API-Key;
//   - the tags are the server's: entry tool, client and caller IP ride as headers beside the internal key, and a
//     caller-sent caller_tier / client / entry_tool / triage_status in the arguments is never forwarded;
//   - request_enhancement is a pure wrapper: same endpoint, class feature_request (coverage_gap when about coverage);
//   - the backend's daily limit (the 6th keyless call) comes back as a polite not-filed answer, no plan or price words;
//   - next_tools -> report_finding appears on a gap answer and never on a clean one;
//   - discovery: the instructions line, the discover_tools front_door line, the feedback family.
// NO real network: the backend is a loopback stub.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer as httpServer } from 'node:http';
import { resultGaps, planGaps, findingNextTool, attachFindingNext, isAccessReason } from '../lib/finding-nudge.mjs';
import { CLAUDE_FEEDBACK_TOOLS, CLAUDE_TOOLS, CLAUDE_INSTRUCTIONS } from '../lib/claude-directory.mjs';
import { withPlanSuffix } from '../lib/dchub-identity.mjs';

const PARTNER = 'dchub_pro_' + 'partnerkey000000'.repeat(2);
const INTERNAL = 'test-internal-key-not-a-real-secret';
// What agent-facing text written for these tools must never say (owner rule: no plan, no price,
// never "paid", "upgrade" or "trial").
const FORBIDDEN = /\b(paid|upgrade|trial|plans?|pricing|price|\$\s?\d|per month|subscription)\b/i;

let S, stub, srv, PORT, hits = [];
let keylessFiled = 0;
let canvasMode = 'clean';
let queueMode = 'clean';
const ENV = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY'];
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
        if (u.pathname === '/api/v1/inbox/findings' && req.method === 'POST') {
          const body = JSON.parse(b || '{}');
          const key = req.headers['x-api-key'];
          if (!key) {
            keylessFiled += 1;
            if (keylessFiled > 5) {
              res.statusCode = 429;
              res.end(JSON.stringify({ ok: false, error: 'rate_limited', status: 'not_filed', limit_per_day: 5, retry_after_seconds: 3600,
                message: 'DC Hub has received as many findings from this caller as it takes in one day. Nothing was filed this time; please try again tomorrow.' }));
              return;
            }
          }
          if (body.class === 'feature_request' && !body.summary) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'summary_required' })); return; }
          res.statusCode = 201;
          const tier = key === PARTNER ? 'partner' : 'keyless';
          res.end(JSON.stringify({ ok: true, finding_id: 77, status: 'received', recurrence: 1,
            message: 'Thanks. The DC Hub team reviews findings daily.', id: 77, result: 'created',
            issue_label: `external_audit:${body.class}:${body.tool}`, detector: 'external_audit', caller_tier: tier,
            quoted_fields_hash: 'abcdef0123456789',
            ...(tier === 'partner' ? { slug: 'slug-test', route: 'needs_human', lane: 'x', route_persisted: true } : {}) }));
          return;
        }
        if (u.pathname === '/api/v1/site-selection/canvas') {
          const base = { ok: true, matched: 3, shortlist: [{ market: 'Dallas', verdict: 'BUILD' }] };
          if (canvasMode === 'gap') base.constraint_coverage = { max_months: { applied: false, status: 'not_tracked', reason: 'no time-to-power estimate for markets in this region' } };
          if (canvasMode === 'capmw') base.constraint_coverage = { capacity_mw: { applied: false, status: 'unavailable', reason: 'The shortlist is NOT sized to this target.' } };
          if (canvasMode === 'locked') base.constraint_coverage = { max_months: { applied: false, status: 'locked', reason: 'needs a full-access key' } };
          if (canvasMode === 'access') base.constraint_coverage = { max_months: { applied: false, status: 'not_applied', reason: 'a full-access key reads this filter' } };
          res.end(JSON.stringify(base)); return;
        }
        if (u.pathname === '/api/v1/interconnection-queue/refined') {
          const base = { ok: true, results: [{ project: 'p1' }], filters_applied: { iso: 'ERCOT' } };
          if (queueMode === 'gap') base._ignored_params = { developer: 'developer names are carried for ERCOT only; this ISO has none' };
          if (queueMode === 'region') Object.assign(base, { results: [], _error_mitigation: { error_code: 'region_not_covered' }, requested: 'Ontario' });
          res.end(JSON.stringify(base)); return;
        }
        res.end('{}');
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = INTERNAL;
  S = await import('../server.mjs');
  await new Promise((resolve) => { srv = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = srv.address().port;
}, 60000);
afterEach(() => { hits = []; keylessFiled = 0; canvasMode = 'clean'; queueMode = 'clean'; });
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
async function open(path = '/mcp', extra = {}, clientName = 'findings-test') {
  const init = await post(path, extra, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...(sid ? { 'mcp-session-id': sid } : {}), ...extra };
  if (sid) await post(path, h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return { h, path, instructions: init.msg && init.msg.result && init.msg.result.instructions };
}
const call = (s, name, args, id = 9) => post(s.path, s.h, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args || {} } });
const list = async (s) => (await post(s.path, s.h, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).msg.result.tools;
const findingHits = () => hits.filter((x) => x.path === '/api/v1/inbox/findings');
const textOf = (r) => (r.content || []).map((c) => c.text || '').join('\n');

describe('tools/list on each endpoint', () => {
  it('/mcp lists both, 98 tools, with the owner-approved descriptions', async () => {
    const t = await list(await open('/mcp'));
    expect(t.length).toBe(98);   // 97 on 2026-11-16; 98 on 2026-11-20: accept_capacity_intro
    const rf = t.find((x) => x.name === 'report_finding');
    const re = t.find((x) => x.name === 'request_enhancement');
    expect(rf && re).toBeTruthy();
    expect(rf.description).toBe(withPlanSuffix('report_finding', S.REPORT_FINDING_DESCRIPTION));
    expect(re.description).toBe(withPlanSuffix('request_enhancement', S.REQUEST_ENHANCEMENT_DESCRIPTION));
    expect(rf.inputSchema.properties.class.enum).toEqual([...S.FINDING_CLASSES]);
    for (const c of ['wrong_number', 'missing_data', 'coverage_gap', 'bug', 'feature_request']) expect(S.FINDING_CLASSES).toContain(c);
    // tool is optional now (feature_request needs none); every 2026-10-08 field is still there
    expect(rf.inputSchema.required || []).toEqual(['class']);
    for (const p of ['class', 'tool', 'args', 'quoted_fields', 'observed_at', 'session_id', 'recurrence', 'note',
      'summary', 'user_goal', 'region', 'contact_email']) expect(rf.inputSchema.properties, p).toHaveProperty(p);
    expect(rf.inputSchema.properties.summary).toMatchObject({ minLength: 10, maxLength: 280 });
    expect(rf.inputSchema.properties.user_goal).toMatchObject({ maxLength: 500 });
    expect(re.inputSchema.required).toEqual(['summary']);
    expect(Object.keys(re.inputSchema.properties).sort()).toEqual(
      ['contact_email', 'evidence', 'region', 'summary', 'tool', 'url', 'user_goal']);
    expect(rf.annotations.readOnlyHint).toBe(false);
    expect(re.annotations.readOnlyHint).toBe(false);
    expect(re.annotations.destructiveHint).toBe(false);
    expect(rf.annotations.tier_required).toBe('anonymous');
  });
  it('/mcp/claude lists both, the same words, write-annotated', async () => {
    const t = await list(await open('/mcp/claude', {}, 'claude-ai'));
    const rf = t.find((x) => x.name === 'report_finding');
    const re = t.find((x) => x.name === 'request_enhancement');
    expect(rf && re).toBeTruthy();
    // the Claude directory profile serves its plain-language variant (its review flags "your human" and
    // "stale"); same meaning, same no-plan/no-price rule
    expect(rf.description).toBe(CLAUDE_FEEDBACK_TOOLS.report_finding);
    expect(re.description).toBe(CLAUDE_FEEDBACK_TOOLS.request_enhancement);
    for (const d of [rf.description, re.description]) {
      expect(d).not.toMatch(/your human|\bstale\b/i);
      expect(d).not.toMatch(FORBIDDEN);
      expect(d).toMatch(/Works with or without a key\./);
      expect(d).not.toMatch(/\bfree\b/i);
    }
    expect(rf.annotations.readOnlyHint).toBe(false);
    expect(re.annotations.readOnlyHint).toBe(false);
    expect(Object.keys(CLAUDE_TOOLS).slice(-2)).toEqual(['report_finding', 'request_enhancement']);
  });
  it('/mcp/chatgpt (frozen) lists neither', async () => {
    const t = await list(await open('/mcp/chatgpt', {}, 'openai-mcp'));
    expect(t.map((x) => x.name)).not.toContain('report_finding');
    expect(t.map((x) => x.name)).not.toContain('request_enhancement');
  });
});

describe('keyless filing', () => {
  it('report_finding with no key returns a finding_id, not a key-required error', async () => {
    const s = await open('/mcp');
    const r = (await call(s, 'report_finding', { class: 'wrong_number', tool: 'get_grid_data', summary: 'ERCOT demand shows 0 MW at noon',
      quoted_fields: { demand_mw: 0 } })).msg.result;
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ _entity: 'finding', finding_id: 77, status: 'received', recurrence: 1,
      message: 'Thanks. The DC Hub team reviews findings daily.' });
    // a keyless caller gets the four receipt fields, not the backend's internal ones
    for (const k of ['caller_tier', 'issue_label', 'quoted_fields_hash', 'route', 'slug']) expect(r.structuredContent, k).not.toHaveProperty(k);
    expect(textOf(r)).toContain('Thanks. The DC Hub team reviews findings daily.');
    const [h] = findingHits();
    expect(h.method).toBe('POST');
    expect(h.headers['x-api-key']).toBeUndefined();
    expect(h.headers['x-internal-key']).toBe(INTERNAL);
    expect(h.headers['x-dchub-entry-tool']).toBe('report_finding');
    expect(h.headers['x-dchub-finding-client']).toBe('other');
    expect(h.headers['x-mcp-client']).toBe('findings-test');
  });
  it('feature_request with no tool is filed against "general"', async () => {
    const s = await open('/mcp');
    await call(s, 'report_finding', { class: 'feature_request', summary: 'Please add hourly LMP history for SPP' });
    expect(JSON.parse(findingHits()[0].body).tool).toBe('general');
  });
  it('a caller-sent caller_tier / client / entry_tool / triage_status never reaches the backend', async () => {
    const s = await open('/mcp');
    await call(s, 'report_finding', { class: 'bug', tool: 'get_news', summary: 'get_news returned an empty list',
      caller_tier: 'partner', client: 'claude', entry_tool: 'request_enhancement', triage_status: 'shipped', key_id: 'k:forged' });
    const h = findingHits()[0];
    const body = JSON.parse(h.body);
    for (const k of ['caller_tier', 'client', 'entry_tool', 'triage_status', 'key_id']) expect(body, k).not.toHaveProperty(k);
    expect(h.headers['x-dchub-entry-tool']).toBe('report_finding');
    expect(h.headers['x-dchub-finding-client']).toBe('other');
    // the handler's own field list, not only the tool schema, keeps them out (a direct call skips the schema)
    const seen = [];
    await S._reportFindingTool('', { class: 'bug', tool: 'get_news', summary: 'get_news returned an empty list',
      caller_tier: 'partner', client: 'claude', entry_tool: 'request_enhancement', triage_status: 'shipped', key_id: 'k:forged',
      ip_hash: 'forged', tags: { caller_tier: 'partner' } },
      async (_u, init) => { seen.push(init); return new Response('{"ok":true,"finding_id":1}', { status: 201 }); }, { ctx: null });
    expect(Object.keys(JSON.parse(seen[0].body)).sort()).toEqual(['class', 'summary', 'tool']);
  });
  it('the client tag comes from the endpoint, then clientInfo', async () => {
    await call(await open('/mcp/claude', {}, 'claude-ai'), 'report_finding', { class: 'bug', tool: 'get_news', summary: 'news tool timed out twice' });
    await call(await open('/mcp', {}, 'cursor-vscode'), 'report_finding', { class: 'bug', tool: 'get_news', summary: 'news tool timed out twice' });
    expect(findingHits().map((h) => h.headers['x-dchub-finding-client'])).toEqual(['claude', 'cursor']);
  });
  it('a QA caller is marked for the backend', async () => {
    await call(await open('/mcp', { 'x-dchub-qa': '1' }), 'report_finding', { class: 'bug', tool: 'get_news', summary: 'qa probe finding here' });
    expect(findingHits()[0].headers['x-dchub-qa']).toBe('1');
  });
  it('a partner key keeps its receipt (route, issue label) beside the four new fields', async () => {
    const r = (await call(await open('/mcp', { 'x-api-key': PARTNER }), 'report_finding',
      { class: 'count_drift', tool: 'discover_tools', note: 'counts disagree' })).msg.result;
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ finding_id: 77, status: 'received', recurrence: 1, route: 'needs_human',
      issue_label: 'external_audit:count_drift:discover_tools' });
    expect(textOf(r)).toMatch(/route needs_human/);
    expect(findingHits()[0].headers['x-api-key']).toBe(PARTNER);
  });
});

describe('request_enhancement is a pure wrapper', () => {
  it('feature_request, same endpoint, entry tool request_enhancement', async () => {
    const r = (await call(await open('/mcp'), 'request_enhancement', { summary: 'Let me export the shortlist to CSV', user_goal: 'share with my team' })).msg.result;
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.finding_id).toBe(77);
    const h = findingHits()[0];
    expect(h.headers['x-dchub-entry-tool']).toBe('request_enhancement');
    expect(JSON.parse(h.body)).toEqual({ class: 'feature_request', tool: 'general', summary: 'Let me export the shortlist to CSV', user_goal: 'share with my team' });
  });
  it('coverage_gap when it is about coverage', async () => {
    const s = await open('/mcp');
    await call(s, 'request_enhancement', { summary: 'Add queue data for Ontario', region: 'Ontario' });
    await call(s, 'request_enhancement', { summary: 'DC Hub does not cover Mexican grid operators' }, 10);
    expect(findingHits().map((h) => JSON.parse(h.body).class)).toEqual(['coverage_gap', 'coverage_gap']);
  });
  it('a too-short summary is refused by the schema before any backend call', async () => {
    const m = (await call(await open('/mcp'), 'request_enhancement', { summary: 'short' })).msg;
    expect(m.error || (m.result && m.result.isError)).toBeTruthy();
    expect(findingHits()).toEqual([]);
  });
});

describe('call-volume limits never refuse a filing (the backend holds the findings limit)', () => {
  it('a free key past its daily cap still files; a data tool is refused at the same point', async () => {
    const KEY = 'dch_live_findings_capped_fixture';
    S._setValidateFetchImpl(async (_url, req) => {
      const b = JSON.parse(req.body);
      return { ok: true, json: async () => (b.count_call === true
        ? { valid: false, tier: 'free', reason: 'daily_cap' }
        : { valid: true, tier: 'free', email: null, counts_tool_calls: true }) };
    });
    try {
      const ctx = { api_key: KEY, tier: 'free', profile: '', session_id: 'findings-cap' };
      S._dropKeyCache(KEY);
      const control = await S._freeKeyCallRefusal(ctx, 'get_grid_intelligence', true);
      expect(control && control.reason).toBe('daily_cap');
      for (const n of ['report_finding', 'request_enhancement']) {
        S._dropKeyCache(KEY);
        expect(await S._freeKeyCallRefusal(ctx, n, true), n).toBeNull();
      }
    } finally { S._setValidateFetchImpl(null); S._dropKeyCache(KEY); }
  });
});

describe('the daily limit is answered politely', () => {
  it('the 6th keyless call is not filed and says so, with no plan or price words', async () => {
    keylessFiled = 0;
    const s = await open('/mcp');
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push((await call(s, 'report_finding', { class: 'bug', tool: 'get_news', summary: `news tool timed out, run ${i}` }, 20 + i)).msg.result);
    }
    for (const r of results.slice(0, 5)) expect(r.structuredContent.finding_id).toBe(77);
    const last = results[5];
    expect(last.isError).toBe(true);
    expect(last.structuredContent).toMatchObject({ error: 'rate_limited', status: 'not_filed', retry_after_seconds: 3600 });
    expect(textOf(last)).toMatch(/Nothing was filed this time; please try again tomorrow\./);
    expect(textOf(last)).not.toMatch(FORBIDDEN);
    // the fallback text (a backend that sends no message) holds the same rule
    const fb = await S._reportFindingTool('', { class: 'bug', tool: 't', summary: 'xxxxxxxxxxxx' },
      async () => new Response('{}', { status: 429 }), { ctx: null });
    expect(textOf(fb)).toMatch(/please try again tomorrow/);
    expect(textOf(fb)).not.toMatch(FORBIDDEN);
  });
});

describe('agent-facing text names no plan, no price, no paid/upgrade/trial', () => {
  it('descriptions, instructions line, front_door line, schema text, nudge text', async () => {
    const t = await list(await open('/mcp'));
    for (const n of ['report_finding', 'request_enhancement']) {
      const x = t.find((y) => y.name === n);
      expect(JSON.stringify({ d: x.description, s: x.inputSchema }), n).not.toMatch(FORBIDDEN);
    }
    expect(S.INSTR_FEEDBACK_LINE).not.toMatch(FORBIDDEN);
    expect(S.FINDING_THANKS).not.toMatch(FORBIDDEN);
    const n = findingNextTool('execute_plan', planGaps([], null, [], 'colo_pricing'));
    expect(JSON.stringify(n)).not.toMatch(FORBIDDEN);
  });
});

describe('discovery', () => {
  it('the instructions line rides /mcp, /mcp/grok and /mcp/claude, not /mcp/chatgpt', async () => {
    // Note F / option A (owner 2026-11-17): "Both are free." is dropped from the owner-approved line.
    expect(S.INSTR_FEEDBACK_LINE).toBe("If data looks wrong or missing, call report_finding; if your human wants something DC Hub doesn't do, call request_enhancement.");
    // Capabilities messaging (2026-11-26): the approved paragraph says the same line with "does not".
    const FEEDBACK = 'If data looks wrong or missing, call report_finding; if your human wants something DC Hub does not do, call request_enhancement.';
    for (const p of ['/mcp', '/mcp/grok']) expect((await open(p)).instructions, p).toContain(FEEDBACK);
    // /mcp/claude says the same in its own plain words (no "your human" on that profile)
    const ci = (await open('/mcp/claude', {}, 'claude-ai')).instructions;
    expect(ci).toBe(CLAUDE_INSTRUCTIONS);
    expect(ci).toContain('If data looks wrong or missing, report_finding files it; if the user wants something DC Hub does not do, request_enhancement files that.');
    expect(ci).not.toContain('Both are free');
    expect((await open('/mcp/chatgpt', {}, 'openai-mcp')).instructions).not.toContain('report_finding');
    // keyed sessions carry it once, and the partner tail no longer restates report_finding
    const keyed = (await open('/mcp', { 'x-api-key': PARTNER })).instructions;
    expect(keyed.split(FEEDBACK).length).toBe(2);
    expect(S._INSTR_TAIL_INBOX).not.toContain('report_finding');
  });
  it('discover_tools carries the front_door line and the feedback family', async () => {
    const r = (await call(await open('/mcp'), 'discover_tools', {})).msg.result;
    const sc = r.structuredContent || JSON.parse(r.content[0].text);
    expect(sc.feedback).toBe('Wrong or missing data: report_finding. Feature ideas: request_enhancement.');
    const fam = S._TOOL_FAMILIES_TABLE.find((f) => f.family === 'feedback');
    expect(fam.tools).toEqual(['report_finding', 'request_enhancement']);
  });
});

describe('next_tools -> report_finding: gap answers only', () => {
  const NEXT = (tool) => ({ tool: 'report_finding', args: expect.objectContaining({ class: 'coverage_gap', tool }) });
  const body = (r) => JSON.parse(r.content[0].text);
  it('site_selection_canvas: a constraint the data cannot apply -> next_tools', async () => {
    canvasMode = 'gap';
    const r = (await call(await open('/mcp'), 'site_selection_canvas', { capacity_mw: 100, region: 'TX', max_months: 24 })).msg.result;
    const b = body(r);
    expect(b.next_tools).toEqual([NEXT('site_selection_canvas')]);
    expect(b.next_tools[0].args.summary).toMatch(/max_months not applied \(no time-to-power estimate/);
    expect(b.next_tools[0].args.summary.length).toBeLessThanOrEqual(280);
  });
  it('site_selection_canvas: a clean answer, a locked filter or an access reason -> none', async () => {
    for (const mode of ['clean', 'locked', 'access', 'capmw']) {
      canvasMode = mode;
      const r = (await call(await open('/mcp'), 'site_selection_canvas', { capacity_mw: 100, region: 'TX', max_months: 24 })).msg.result;
      expect(body(r).next_tools, mode).toBeUndefined();
    }
  });
  it('get_refined_queue: an ignored parameter or an uncovered region -> next_tools; clean -> none', async () => {
    queueMode = 'gap';
    let r = (await call(await open('/mcp'), 'get_refined_queue', { iso: 'PJM', developer: 'tenaska' })).msg.result;
    expect(r.structuredContent.next_tools).toEqual([NEXT('get_refined_queue')]);
    expect(r.structuredContent.next_tools[0].args.summary).toMatch(/developer not applied/);
    queueMode = 'region';
    r = (await call(await open('/mcp'), 'get_refined_queue', { iso: 'PJM' })).msg.result;
    expect(r.structuredContent.next_tools[0].args.summary).toMatch(/region not covered: Ontario/);
    queueMode = 'clean';
    r = (await call(await open('/mcp'), 'get_refined_queue', { iso: 'PJM' })).msg.result;
    expect(r.structuredContent.next_tools).toBeUndefined();
    expect(r.content[0].text).not.toContain('report_finding');
  });
  it('not on /mcp/chatgpt (frozen), even on a gap answer', async () => {
    canvasMode = 'gap';
    const r = (await call(await open('/mcp/chatgpt', {}, 'openai-mcp'), 'site_selection_canvas', { capacity_mw: 100, region: 'TX', max_months: 24 })).msg;
    expect(JSON.stringify(r)).not.toContain('report_finding');
  });
  it('not for a ChatGPT client on /mcp (the clean-platform path), even on a gap answer', async () => {
    for (const [tool, args, mode] of [['site_selection_canvas', { capacity_mw: 100, region: 'TX', max_months: 24 }, 'gap'],
      ['get_refined_queue', { iso: 'PJM', developer: 'tenaska' }, 'gap']]) {
      canvasMode = mode; queueMode = mode;
      const r = (await call(await open('/mcp', {}, 'openai-mcp'), tool, args)).msg;
      expect(JSON.stringify(r), tool).not.toContain('report_finding');
    }
    // control: the same calls from another client carry it
    canvasMode = 'gap';
    const c = (await call(await open('/mcp'), 'site_selection_canvas', { capacity_mw: 100, region: 'TX', max_months: 24 })).msg;
    expect(JSON.stringify(c)).toContain('report_finding');
  });
});

describe('finding-nudge (pure)', () => {
  it('planGaps: a skipped step, a dropped filter, an uncovered region, a coverage topic; never a locked or access drop', () => {
    const executed = [
      { step: 1, tool: 'get_market_intel', status: 'executed', result: { ok: true } },
      { step: 2, tool: 'get_fiber_intel', status: 'skipped_unresolved', missing: 'market' },
      { step: 3, tool: 'get_grid_intelligence', status: 'executed', result: { _error_mitigation: { error_code: 'region_not_covered' }, requested: 'Ontario' } },
      { step: 4, tool: 'plan_query', status: 'skipped_meta' },
      { step: 5, tool: 'x', status: 'not_run', note: 'max_steps reached' },
    ];
    const dropped = [
      { step: 1, tool: 'get_market_intel', param: 'metric', kind: 'not_applied', reason: 'vacancy is not tracked for this market' },
      { step: 1, tool: 'get_market_intel', param: 'period', kind: 'locked', reason: 'needs a full-access key' },
      { step: 1, tool: 'get_market_intel', param: 'x', kind: 'not_applied', reason: 'a MW threshold is a paid filter' },
    ];
    const g = planGaps(executed, null, dropped, 'lease_comps');
    expect(g).toEqual([
      'step 2 get_fiber_intel skipped (no market resolved)',
      'step 3 get_grid_intelligence: region not covered (Ontario)',
      'step 1 get_market_intel: metric not applied (vacancy is not tracked for this market)',
      'lease comparables are not covered',
    ]);
    expect(findingNextTool('execute_plan', g).args.summary.length).toBeLessThanOrEqual(280);
  });
  it('a step skipped after a gated preview is about access, not data: no gap', () => {
    const executed = [{ step: 1, tool: 'rank_markets', status: 'gated_preview', result: {} },
      { step: 2, tool: 'get_market_dcpi_rank', status: 'skipped_unresolved', missing: 'market_slug' }];
    expect(planGaps(executed, null, [], null)).toEqual([]);
    executed[0].status = 'executed';
    expect(planGaps(executed, null, [], null)).toEqual(['step 2 get_market_dcpi_rank skipped (no market_slug resolved)']);
  });
  it('the canvas capacity_mw not_applied is a known limit, not a gap; the same drop on another tool still is (2026-11-25)', () => {
    const executed = [{ step: 1, tool: 'site_selection_canvas', status: 'executed', result: { ok: true } }];
    const canvas = { step: 1, tool: 'site_selection_canvas', param: 'capacity_mw', kind: 'not_applied', reason: 'The shortlist is NOT sized to this target.' };
    expect(planGaps(executed, null, [canvas], null)).toEqual([]);
    expect(findingNextTool('execute_plan', planGaps(executed, null, [canvas], null))).toBeNull();
    const other = { ...canvas, tool: 'find_sites' };
    expect(planGaps(executed, null, [other], null)).toEqual(['step 1 find_sites: capacity_mw not applied (The shortlist is NOT sized to this target.)']);
    const otherParam = { ...canvas, param: 'region' };
    expect(planGaps(executed, null, [otherParam], null)).toEqual(['step 1 site_selection_canvas: region not applied (The shortlist is NOT sized to this target.)']);
  });
  it('a clean plan has no gaps and no entry', () => {
    const executed = [{ step: 1, tool: 'rank_markets', status: 'executed', result: { ok: true } },
      { step: 2, tool: 'plan_query', status: 'skipped_meta' }, { step: 3, tool: 'x', status: 'gated_preview', result: {} }];
    expect(planGaps(executed, null, [], null)).toEqual([]);
    expect(findingNextTool('execute_plan', [])).toBeNull();
    expect(resultGaps({ ok: true, results: [] })).toEqual([]);
    expect(resultGaps(null)).toEqual([]);
  });
  it('resultGaps reads _ignored_params, filters_applied._x_not_applied and constraint_coverage (only what was asked)', () => {
    const r = { _ignored_params: { a: 'no data for a here' }, filters_applied: { _b_not_applied: 'b is not carried for this ISO' },
      constraint_coverage: { c: { applied: false, reason: 'c is not tracked' }, d: { applied: false, reason: 'd is not tracked' } } };
    expect(resultGaps(r, { c: 1 })).toEqual(['a not applied (no data for a here)', 'b not applied (b is not carried for this ISO)', 'c not applied (c is not tracked)']);
  });
  it('access reasons are never gaps', () => {
    for (const s of ['a MW threshold is a paid filter', 'needs a full-access key', 'preview depth', 'locked below Pro', 'this tier does not read it']) {
      expect(isAccessReason(s), s).toBe(true);
    }
    expect(isAccessReason('no fiber routes mapped in this state')).toBe(false);
  });
  it('attachFindingNext appends to an existing array, leaves any other next_tools alone', () => {
    const e = { tool: 'report_finding', args: {} };
    expect(attachFindingNext({}, e)).toEqual({ next_tools: [e] });
    expect(attachFindingNext({ next_tools: [1] }, e)).toEqual({ next_tools: [1, e] });
    expect(attachFindingNext({ next_tools: 'x' }, e)).toEqual({ next_tools: 'x' });
    expect(attachFindingNext({ a: 1 }, null)).toEqual({ a: 1 });
  });
});
