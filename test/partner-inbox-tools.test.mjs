// read_inbox / report_finding (2026-10-08, owner: "add the two tools").
// 2026-11-16 (owner "Let's do both"): report_finding is open to every caller (keyless, any key,
// partner; the backend holds the daily limits) and has its own pins in
// test/findings-open-intake.test.mjs; here it keeps the partner receipt and the helper failure
// shapes. read_inbox stays the partner tool. Pins: both are registered for every caller (keyed and keyless
// servers list the same 94 names, so the per-session catalog is stable); the
// report_finding schema carries the closed class enum; discover_tools reaches
// them through the `partner` family; both proxy the backend with the SESSION's
// key and nothing else (no internal key); no key / 401 / 403 / 400 / 429 /
// network failure each render as an isError text, never a throw; a partner key
// gets the notes (text + structuredContent) and a filing receipt. NO real
// network: the backend is a local stub and globalThis.fetch is stubbed for the
// direct helper calls.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer as httpServer } from 'node:http';

const PARTNER = 'dchub_pro_' + 'partnerkey000000'.repeat(2);
const PLAIN = 'dchub_free_' + 'x'.repeat(32);
const NOTES = { ok: true, inbox_slug: 'slug-test', count: 1, peek: false,
  notes: [{ id: 7, title: 'hello', body: 'note body', author: 'owner', created_at: '2026-10-07T00:00:00+00:00' }] };
// 2026-10-14: 'consumed' = an earlier session already read every note (the Grok
// "partner inbox still fails" shape): the default read is empty and carries the hint.
let inboxMode = 'notes';
let S, stub, srv, PORT, hits = [];
const ENV = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY'];
const prev = {};
const realFetch = globalThis.fetch;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = httpServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
        hits.push({ path: u.pathname, query: u.search, method: req.method, key: req.headers['x-api-key'] || null,
                    internal: req.headers['x-internal-key'] || null, body: b });
        res.setHeader('content-type', 'application/json');
        if (u.pathname === '/api/v1/keys/validate') {
          const k = (() => { try { return JSON.parse(b).api_key; } catch { return ''; } })();
          res.end(JSON.stringify(k === PARTNER || k === PLAIN ? { valid: true, tier: 'pro' } : { valid: false, tier: 'free' })); return;
        }
        if (u.pathname === '/api/v1/inbox' || u.pathname === '/api/v1/inbox/findings') {
          const key = req.headers['x-api-key'];
          // 2026-11-16: findings are open to every caller; the inbox GET stays partner-only.
          const isInbox = u.pathname === '/api/v1/inbox';
          if (isInbox && !key) { res.statusCode = 401; res.end('{"ok":false,"error":"api_key_required"}'); return; }
          if (isInbox && key !== PARTNER) { res.statusCode = 403; res.end('{"ok":false,"error":"not_a_partner_key"}'); return; }
          if (u.pathname === '/api/v1/inbox' && u.searchParams.get('include_read') === '1') {
            res.end(JSON.stringify({ ok: true, inbox_slug: 'slug-test', count: 2, peek: true, include_read: true,
              days: Number(u.searchParams.get('days') || 14), unread_count: 1,
              notes: [{ id: 8, title: 'new', body: 'unread body', author: 'brain', created_at: '2026-10-14T15:00:00+00:00', read_at: null },
                      { ...NOTES.notes[0], read_at: '2026-10-14T15:00:44+00:00' }] }));
            return;
          }
          if (u.pathname === '/api/v1/inbox' && inboxMode === 'consumed') {
            res.end(JSON.stringify({ ok: true, inbox_slug: 'slug-test', count: 0, peek: u.searchParams.get('peek') === '1',
              recent_read_count: 2, recent_read_days: 14, hint: 'backend hint: pass include_read=1', notes: [] }));
            return;
          }
          if (u.pathname === '/api/v1/inbox') { res.end(JSON.stringify({ ...NOTES, peek: u.searchParams.get('peek') === '1' })); return; }
          const body = JSON.parse(b || '{}');
          if (body.class === 'bogus') { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'invalid_class', classes: ['other'] })); return; }
          if (body.tool === 'ratelimited') { res.statusCode = 429; res.end(JSON.stringify({ ok: false, error: 'rate_limited', retry_after_seconds: 42 })); return; }
          res.statusCode = body.note === 'again' ? 200 : 201;
          // the pre-2026-11-16 partner receipt shape (no caller_tier, no finding_id): route + slug mark it
          const partnerBits = key === PARTNER ? { slug: 'slug-test',
            route: body.class === 'leak_past_pro_gate' ? 'squasher_queue' : 'needs_human' } : {};
          res.end(JSON.stringify({ ok: true, id: 31, result: body.note === 'again' ? 'deduped' : 'created',
            issue_label: `external_audit:${body.class}:${body.tool}`, detector: 'external_audit', ...partnerBits,
            recurrence: body.note === 'again' ? 2 : 1,
            quoted_fields_hash: 'abcdef0123456789',
            ...(body.class === 'leak_past_pro_gate' && body.note !== 'again' ? { squasher: { ok: true, id: 5 } } : {}) }));
          return;
        }
        res.end('{}');
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  await new Promise((resolve) => { srv = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = srv.address().port;
}, 60000);
afterEach(() => { hits = []; inboxMode = 'notes'; globalThis.fetch = realFetch; });
afterAll(async () => {
  await new Promise((r) => srv.close(r)); await new Promise((r) => stub.close(r));
  for (const k of ENV) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
});

const names = (s) => Object.keys(s._registeredTools).sort();

describe('registration: one catalog for every caller', () => {
  it('both tools are registered on keyed and keyless servers alike, and the catalog is 97', () => {
    const keyless = names(S.createServer(null, ''));
    const keyed = names(S.createServer(null, '', undefined, { keyed: true }));
    expect(keyless).toEqual(keyed);
    expect(keyless).toContain('read_inbox');
    expect(keyless).toContain('report_finding');
    expect(keyless.length).toBe(97);   // 94 -> 95 on 2026-11-11: get_air_permit_context; 96 on 2026-11-13: dchub_services; 97 on 2026-11-16: request_enhancement
    expect(S.PARTNER_TOOLS).toEqual(['read_inbox']);
  });

  it('access tags: read_inbox key-required (free_key); report_finding open (anonymous) and a write', () => {
    expect(S.KEY_REQUIRED_TOOLS.has('read_inbox')).toBe(true);
    expect(S._tierRequiredFor('read_inbox')).toBe('free_key');
    expect(S.KEY_REQUIRED_TOOLS.has('report_finding')).toBe(false);
    expect(S._tierRequiredFor('report_finding')).toBe('anonymous');
    const t = S.createServer(null, '')._registeredTools;
    expect(t.report_finding.annotations.readOnlyHint).toBe(false);
    expect(t.report_finding.annotations.destructiveHint).toBe(false);
    expect(t.read_inbox.annotations.readOnlyHint).toBe(true);
  });

  it('discover_tools reaches read_inbox through the partner family and report_finding through feedback', () => {
    const fam = S._TOOL_FAMILIES_TABLE.find((f) => f.family === 'partner');
    expect(fam).toBeTruthy();
    expect(fam.tools).toEqual(['read_inbox']);
    expect(fam.when).toMatch(/Partner agents only/);
    expect(S._TOOL_FAMILIES_TABLE.find((f) => f.family === 'feedback').tools).toContain('report_finding');
    expect(S._DISCOVERY_EXEMPT.read_inbox).toBeUndefined();
  });
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
  const raw = await res.text();
  const json = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, msg: json.trim() ? JSON.parse(json) : null };
}
async function open(extra) {
  const init = await post(extra, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'partner-tools-test', version: '1' } } });
  const sid = init.headers.get('mcp-session-id');
  expect(sid).toBeTruthy();
  const h = { 'mcp-session-id': sid, ...extra };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return { h, instructions: init.msg.result.instructions };
}
const call = (h, name, args, id = 9) => post(h, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args || {} } });

describe('over HTTP: schema, instructions, partner vs non-partner', () => {
  it('tools/list carries both for a keyless session, with the class enum on report_finding', async () => {
    const { h } = await open({});
    const list = (await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).msg.result.tools;
    expect(list.length).toBe(97);
    const rf = list.find((t) => t.name === 'report_finding');
    const ri = list.find((t) => t.name === 'read_inbox');
    expect(rf && ri).toBeTruthy();
    expect(rf.inputSchema.properties.class.enum).toEqual([...S.FINDING_CLASSES]);
    expect(rf.inputSchema.required).toEqual(['class']);
    expect(JSON.stringify(rf.inputSchema.properties.class)).toMatch(/leak_past_pro_gate/);
    expect(rf.description).not.toMatch(/PARTNER KEY ONLY/);
    expect(ri.inputSchema.properties.peek.type).toBe('boolean');
    expect(ri.description).toMatch(/PARTNER KEY ONLY/);
  });

  it('keyed instructions name read_inbox; keyless do not; both name report_finding (open to all)', async () => {
    const keyed = await open({ 'x-api-key': PARTNER });
    expect(keyed.instructions).toContain('read_inbox');
    expect(keyed.instructions).toContain('report_finding');
    expect(keyed.instructions).toContain('If you are a partner agent, read dchub://inbox at the start of a session for notes from DC Hub.');
    const keyless = await open({});
    expect(keyless.instructions).not.toContain('read_inbox');
    expect(keyless.instructions).toContain('report_finding');
  });

  it('a keyless read_inbox is a clear "key required" error and never reaches the backend', async () => {
    const { h } = await open({});
    const r = (await call(h, 'read_inbox', {})).msg.result;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/DC Hub key required/);
    expect(r.structuredContent.error).toBe('api_key_required');
    expect(hits.filter((x) => x.path.startsWith('/api/v1/inbox'))).toEqual([]);
  });

  it('a non-partner key: read_inbox is "partner key required" (403, own key, no internal key); report_finding files', async () => {
    const { h } = await open({ 'x-api-key': PLAIN });
    const r = (await call(h, 'read_inbox', {})).msg.result;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Partner key required \(403\)/);
    expect(r.structuredContent.error).toBe('partner_key_required');
    const f = (await call(h, 'report_finding', { class: 'other', tool: 't', summary: 'a plain key files this' }, 10)).msg.result;
    expect(f.isError).toBeFalsy();
    expect(f.structuredContent.finding_id).toBe(31);
    const [ri] = hits.filter((x) => x.path === '/api/v1/inbox');
    expect(ri.key).toBe(PLAIN); expect(ri.internal).toBeNull();
    // report_finding sends the caller's key AND the internal key (server-set tags ride beside it)
    const [rf] = hits.filter((x) => x.path === '/api/v1/inbox/findings');
    expect(rf.key).toBe(PLAIN); expect(rf.internal).toBe('test-internal-key-not-a-real-secret');
  });

  it('a partner key: read_inbox returns the notes as text + structuredContent; peek is forwarded', async () => {
    const { h } = await open({ 'x-api-key': PARTNER });
    const r = (await call(h, 'read_inbox', {})).msg.result;
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain('DC Hub inbox for slug-test: 1 unread note(s) (now marked read)');
    expect(r.content[0].text).toContain('--- #7 | hello | from owner | 2026-10-07T00:00:00+00:00\nnote body');
    expect(r.structuredContent._entity).toBe('inbox');
    expect(r.structuredContent.notes[0].id).toBe(7);
    const p = (await call(h, 'read_inbox', { peek: true }, 11)).msg.result;
    expect(p.structuredContent.peek).toBe(true);
    expect(p.content[0].text).not.toContain('now marked read');
    const [a, b] = hits.filter((x) => x.path === '/api/v1/inbox');
    expect(a.method).toBe('GET'); expect(a.key).toBe(PARTNER); expect(a.query).toBe('');
    expect(b.query).toBe('?peek=1');
  });

  it('read_inbox schema and description: include_read + days, and notes are consumed on first read', async () => {
    const { h } = await open({});
    const ri = (await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).msg.result.tools.find((t) => t.name === 'read_inbox');
    expect(ri.inputSchema.properties.include_read.type).toBe('boolean');
    expect(ri.inputSchema.properties.days).toMatchObject({ type: 'integer', minimum: 1, maximum: 60 });
    expect(ri.inputSchema.required || []).toEqual([]);
    expect(ri.description).toMatch(/first read CONSUMES them/);
    expect(ri.description).toMatch(/include_read=true re-reads read and unread notes/);
  });

  it('include_read is forwarded (with days and peek=1, so an older backend cannot mark), and renders read state per note', async () => {
    const { h } = await open({ 'x-api-key': PARTNER });
    const r = (await call(h, 'read_inbox', { include_read: true })).msg.result;
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain('DC Hub inbox for slug-test: 2 note(s), read and unread, from the last 14 days (re-read; nothing marked read)');
    expect(r.content[0].text).toContain('--- #8 | new | from brain | 2026-10-14T15:00:00+00:00 | unread\nunread body');
    expect(r.content[0].text).toContain('--- #7 | hello | from owner | 2026-10-07T00:00:00+00:00 | read 2026-10-14T15:00:44+00:00\nnote body');
    expect(r.content[0].text).not.toContain('now marked read');
    expect(r.structuredContent).toMatchObject({ _entity: 'inbox', ok: true, include_read: true, days: 14, unread_count: 1, count: 2 });
    expect(r.structuredContent.notes.map((n) => n.read_at)).toEqual([null, '2026-10-14T15:00:44+00:00']);
    const d = (await call(h, 'read_inbox', { include_read: true, days: 30, peek: true }, 12)).msg.result;
    expect(d.structuredContent.days).toBe(30);
    const q = hits.filter((x) => x.path === '/api/v1/inbox').map((x) => x.query);
    expect(q).toEqual(['?include_read=1&peek=1', '?include_read=1&days=30&peek=1']);
    for (const x of hits.filter((y) => y.path === '/api/v1/inbox')) { expect(x.key).toBe(PARTNER); expect(x.internal).toBeNull(); }
  });

  it('an out-of-range days is refused by the schema before any backend call', async () => {
    const { h } = await open({ 'x-api-key': PARTNER });
    for (const days of [0, 61, 2.5]) {
      const m = (await call(h, 'read_inbox', { include_read: true, days })).msg;
      expect(m.error || (m.result && m.result.isError), String(days)).toBeTruthy();
    }
    expect(hits.filter((x) => x.path === '/api/v1/inbox')).toEqual([]);
  });

  it('an empty default read after an earlier session consumed the notes says how to re-read', async () => {
    inboxMode = 'consumed';
    const { h } = await open({ 'x-api-key': PARTNER });
    const r = (await call(h, 'read_inbox', {})).msg.result;
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain('No unread notes.');
    expect(r.content[0].text).toContain('2 note(s) for this key were already read in the last 14 days');
    expect(r.content[0].text).toContain('Call read_inbox with include_read=true to read them again.');
    expect(r.structuredContent).toMatchObject({ count: 0, recent_read_count: 2, recent_read_days: 14 });
    expect(r.structuredContent.hint).toMatch(/include_read=true/);
    expect(hits.filter((x) => x.path === '/api/v1/inbox').map((x) => x.query)).toEqual(['']);
  });

  it('a partner key: report_finding POSTs the body with the session key and returns the receipt', async () => {
    const { h } = await open({ 'x-api-key': PARTNER });
    const args = { class: 'leak_past_pro_gate', tool: 'analyze_site', args: { lat: 1, lon: 2 },
                   quoted_fields: { dcpi_score: 81 }, recurrence: 2, note: 'score served to a free key' };
    const r = (await call(h, 'report_finding', args)).msg.result;
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toMatch(/^Thanks\. The DC Hub team reviews findings daily\. Filed created: external_audit:leak_past_pro_gate:analyze_site \(finding #31, seen 1x, route squasher_queue\)\. Squasher hand-off: queued \(#5\)\./);
    expect(r.structuredContent).toMatchObject({ _entity: 'finding', ok: true, id: 31, result: 'created', route: 'squasher_queue',
      finding_id: 31, status: 'received', recurrence: 1 });
    const hit = hits.find((x) => x.path === '/api/v1/inbox/findings');
    expect(hit.method).toBe('POST'); expect(hit.key).toBe(PARTNER); expect(hit.internal).toBe('test-internal-key-not-a-real-secret');
    expect(JSON.parse(hit.body)).toEqual(args);
    const d = (await call(h, 'report_finding', { class: 'other', tool: 't', note: 'again' }, 12)).msg.result;
    expect(d.content[0].text).toMatch(/^Thanks\. The DC Hub team reviews findings daily\. Filed deduped: external_audit:other:t \(finding #31, seen 2x, route needs_human\)\./);
    expect(d.content[0].text).not.toMatch(/Squasher/);
  });

  it('a schema-invalid class is refused by the server before any backend call', async () => {
    const { h } = await open({ 'x-api-key': PARTNER });
    const r = (await call(h, 'report_finding', { class: 'not_a_class', tool: 't' })).msg;
    expect(r.error || (r.result && r.result.isError)).toBeTruthy();
    expect(hits.filter((x) => x.path === '/api/v1/inbox/findings')).toEqual([]);
  });
});

describe('helpers with a stubbed fetch: every failure is text, never a throw', () => {
  const res = (status, body) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  it('read_inbox: 401 / 403 / 503 / network / empty', async () => {
    expect((await S._readInboxTool(PARTNER, false, res(401, {}))).structuredContent.error).toBe('api_key_rejected');
    expect((await S._readInboxTool(PARTNER, false, res(403, {}))).content[0].text).toMatch(/Partner key required/);
    expect((await S._readInboxTool(PARTNER, false, res(503, ''))).content[0].text).toMatch(/HTTP 503.*nothing was marked read/);
    expect((await S._readInboxTool(PARTNER, false, async () => { throw new Error('boom'); })).content[0].text).toMatch(/\(boom\)/);
    const empty = await S._readInboxTool(PARTNER, false, res(200, { ok: true, inbox_slug: 's', count: 0, peek: false, notes: [] }));
    expect(empty.isError).toBeUndefined();
    expect(empty.content[0].text).toContain('No unread notes.');
    expect(empty.structuredContent.count).toBe(0);
  });
  it('read_inbox options: object or legacy boolean; days clamped 1..60 and sent only with include_read', async () => {
    const urls = [];
    const f = async (url) => { urls.push(new URL(String(url)).search); return new Response(JSON.stringify({ ok: true, inbox_slug: 's', count: 0, peek: true, notes: [] }), { status: 200 }); };
    await S._readInboxTool(PARTNER, true, f);                                   // 2026-10-08 boolean = peek
    await S._readInboxTool(PARTNER, false, f);
    await S._readInboxTool(PARTNER, { include_read: true, days: 500 }, f);
    await S._readInboxTool(PARTNER, { include_read: true, days: -4 }, f);
    await S._readInboxTool(PARTNER, { include_read: true, days: 'soon' }, f);
    await S._readInboxTool(PARTNER, { peek: true, days: 30 }, f);              // days without include_read: not sent
    expect(urls).toEqual(['?peek=1', '', '?include_read=1&days=60&peek=1', '?include_read=1&days=1&peek=1', '?include_read=1&peek=1', '?peek=1']);
    // no hint fields on a plain empty read (nothing was read recently)
    const plain = await S._readInboxTool(PARTNER, false, f);
    expect(plain.structuredContent.recent_read_count).toBeUndefined();
    expect(plain.content[0].text).not.toContain('include_read');
  });
  it('report_finding: 400 names the classes, 413, 429 carries retry, 5xx, network; undefined args are not sent', async () => {
    const r400 = await S._reportFindingTool(PARTNER, { class: 'x', tool: 't' }, res(400, { ok: false, error: 'invalid_class', classes: ['other'] }));
    expect(r400.content[0].text).toMatch(/400 invalid_class.*Classes: other/);
    expect((await S._reportFindingTool(PARTNER, { class: 'other', tool: 't' }, res(413, {}))).structuredContent.error).toBe('body_too_large');
    const r429 = await S._reportFindingTool(PARTNER, { class: 'other', tool: 't' }, res(429, { retry_after_seconds: 42 }));
    expect(r429.structuredContent).toMatchObject({ error: 'rate_limited', retry_after_seconds: 42 });
    expect((await S._reportFindingTool(PARTNER, { class: 'other', tool: 't' }, res(502, ''))).content[0].text).toMatch(/HTTP 502.*nothing was filed/);
    expect((await S._reportFindingTool(PARTNER, { class: 'other', tool: 't' }, async () => { throw new Error('down'); })).content[0].text).toMatch(/\(down\)/);
    const seen = [];
    await S._reportFindingTool(PARTNER, { class: 'other', tool: 't', note: undefined, args: null, extra: 'dropped' },
      async (url, init) => { seen.push({ url: String(url), init }); return new Response('{"ok":true,"id":1,"result":"created","issue_label":"x","recurrence":1,"route":"needs_human"}', { status: 201 }); });
    expect(seen[0].url.endsWith('/api/v1/inbox/findings')).toBe(true);
    expect(JSON.parse(seen[0].init.body)).toEqual({ class: 'other', tool: 't' });
    // with the internal key set: the caller's key, the internal key and the server-set tags
    expect(Object.keys(seen[0].init.headers).sort()).toEqual(['Accept', 'Content-Type', 'X-API-Key', 'X-DCHub-Entry-Tool',
      'X-DCHub-Finding-Client', 'X-Internal-Key'].sort());   // no session here, so no X-MCP-Client / X-DC-Client-IP
  });
  it('no key: read_inbox explains and never fetches; report_finding files keyless (no X-API-Key)', async () => {
    let called = 0; const seen = [];
    const f = async (url, init) => { called++; seen.push(init); return new Response('{"ok":true,"finding_id":3,"status":"received","recurrence":1}', { status: 201 }); };
    expect((await S._readInboxTool('', false, f)).structuredContent.error).toBe('api_key_required');
    expect(called).toBe(0);
    const r = await S._reportFindingTool(null, { class: 'other', tool: 't', summary: 'keyless filing works' }, f, { ctx: null });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.finding_id).toBe(3);
    expect(called).toBe(1);
    expect(seen[0].headers['X-API-Key']).toBeUndefined();
  });
});
