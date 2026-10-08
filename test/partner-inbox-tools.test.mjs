// read_inbox / report_finding (2026-10-08, owner: "add the two tools") — the
// PARTNER TOOLS. Pins: both are registered for every caller (keyed and keyless
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
          if (!key) { res.statusCode = 401; res.end('{"ok":false,"error":"api_key_required"}'); return; }
          if (key !== PARTNER) { res.statusCode = 403; res.end('{"ok":false,"error":"not_a_partner_key"}'); return; }
          if (u.pathname === '/api/v1/inbox') { res.end(JSON.stringify({ ...NOTES, peek: u.searchParams.get('peek') === '1' })); return; }
          const body = JSON.parse(b || '{}');
          if (body.class === 'bogus') { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'invalid_class', classes: ['other'] })); return; }
          if (body.tool === 'ratelimited') { res.statusCode = 429; res.end(JSON.stringify({ ok: false, error: 'rate_limited', retry_after_seconds: 42 })); return; }
          res.statusCode = body.note === 'again' ? 200 : 201;
          res.end(JSON.stringify({ ok: true, id: 31, result: body.note === 'again' ? 'deduped' : 'created',
            issue_label: `external_audit:${body.class}:${body.tool}`, detector: 'external_audit', slug: 'slug-test',
            recurrence: body.note === 'again' ? 2 : 1, route: body.class === 'leak_past_pro_gate' ? 'squasher_queue' : 'needs_human',
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
afterEach(() => { hits = []; globalThis.fetch = realFetch; });
afterAll(async () => {
  await new Promise((r) => srv.close(r)); await new Promise((r) => stub.close(r));
  for (const k of ENV) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
});

const names = (s) => Object.keys(s._registeredTools).sort();

describe('registration: one catalog for every caller', () => {
  it('both tools are registered on keyed and keyless servers alike, and the catalog is 94', () => {
    const keyless = names(S.createServer(null, ''));
    const keyed = names(S.createServer(null, '', undefined, { keyed: true }));
    expect(keyless).toEqual(keyed);
    expect(keyless).toContain('read_inbox');
    expect(keyless).toContain('report_finding');
    expect(keyless.length).toBe(94);
    expect(S.PARTNER_TOOLS).toEqual(['read_inbox', 'report_finding']);
  });

  it('access tags: key-required, free_key class; report_finding is a write, read_inbox a read', () => {
    for (const n of ['read_inbox', 'report_finding']) {
      expect(S.KEY_REQUIRED_TOOLS.has(n), n).toBe(true);
      expect(S._tierRequiredFor(n), n).toBe('free_key');
    }
    const t = S.createServer(null, '')._registeredTools;
    expect(t.report_finding.annotations.readOnlyHint).toBe(false);
    expect(t.report_finding.annotations.destructiveHint).toBe(false);
    expect(t.read_inbox.annotations.readOnlyHint).toBe(true);
  });

  it('discover_tools reaches both through the partner family', () => {
    const fam = S._TOOL_FAMILIES_TABLE.find((f) => f.family === 'partner');
    expect(fam).toBeTruthy();
    expect(fam.tools).toEqual(['read_inbox', 'report_finding']);
    expect(fam.when).toMatch(/Partner agents only/);
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
    expect(list.length).toBe(94);
    const rf = list.find((t) => t.name === 'report_finding');
    const ri = list.find((t) => t.name === 'read_inbox');
    expect(rf && ri).toBeTruthy();
    expect(rf.inputSchema.properties.class.enum).toEqual([...S.FINDING_CLASSES]);
    expect(rf.inputSchema.required).toEqual(expect.arrayContaining(['class', 'tool']));
    expect(rf.description).toMatch(/leak_past_pro_gate/);
    expect(rf.description).toMatch(/PARTNER KEY ONLY/);
    expect(ri.inputSchema.properties.peek.type).toBe('boolean');
    expect(ri.description).toMatch(/PARTNER KEY ONLY/);
  });

  it('keyed instructions name both tools; keyless instructions do not', async () => {
    const keyed = await open({ 'x-api-key': PARTNER });
    expect(keyed.instructions).toContain('read_inbox');
    expect(keyed.instructions).toContain('report_finding');
    expect(keyed.instructions).toContain('If you are a partner agent, read dchub://inbox at the start of a session for notes from DC Hub.');
    const keyless = await open({});
    expect(keyless.instructions).not.toContain('read_inbox');
    expect(keyless.instructions).not.toContain('report_finding');
  });

  it('a keyless call is a clear "key required" error and never reaches the backend', async () => {
    const { h } = await open({});
    for (const name of ['read_inbox', 'report_finding']) {
      const r = (await call(h, name, name === 'report_finding' ? { class: 'other', tool: 't' } : {})).msg.result;
      expect(r.isError, name).toBe(true);
      expect(r.content[0].text, name).toMatch(/DC Hub key required/);
      expect(r.structuredContent.error, name).toBe('api_key_required');
    }
    expect(hits.filter((x) => x.path.startsWith('/api/v1/inbox'))).toEqual([]);
  });

  it('a non-partner key gets "partner key required" (the backend 403), with its own key sent and no internal key', async () => {
    const { h } = await open({ 'x-api-key': PLAIN });
    const r = (await call(h, 'read_inbox', {})).msg.result;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Partner key required \(403\)/);
    expect(r.structuredContent.error).toBe('partner_key_required');
    const f = (await call(h, 'report_finding', { class: 'other', tool: 't' }, 10)).msg.result;
    expect(f.isError).toBe(true);
    expect(f.structuredContent.error).toBe('partner_key_required');
    const inboxHits = hits.filter((x) => x.path.startsWith('/api/v1/inbox'));
    expect(inboxHits.length).toBe(2);
    for (const x of inboxHits) { expect(x.key).toBe(PLAIN); expect(x.internal).toBeNull(); }
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

  it('a partner key: report_finding POSTs the body with the session key and returns the receipt', async () => {
    const { h } = await open({ 'x-api-key': PARTNER });
    const args = { class: 'leak_past_pro_gate', tool: 'analyze_site', args: { lat: 1, lon: 2 },
                   quoted_fields: { dcpi_score: 81 }, recurrence: 2, note: 'score served to a free key' };
    const r = (await call(h, 'report_finding', args)).msg.result;
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toMatch(/^Filed created: external_audit:leak_past_pro_gate:analyze_site \(finding #31, seen 1x, route squasher_queue\)\. Squasher hand-off: queued \(#5\)\./);
    expect(r.structuredContent).toMatchObject({ _entity: 'finding', ok: true, id: 31, result: 'created', route: 'squasher_queue' });
    const hit = hits.find((x) => x.path === '/api/v1/inbox/findings');
    expect(hit.method).toBe('POST'); expect(hit.key).toBe(PARTNER); expect(hit.internal).toBeNull();
    expect(JSON.parse(hit.body)).toEqual(args);
    const d = (await call(h, 'report_finding', { class: 'other', tool: 't', note: 'again' }, 12)).msg.result;
    expect(d.content[0].text).toMatch(/^Filed deduped: external_audit:other:t \(finding #31, seen 2x, route needs_human\)\./);
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
    expect(Object.keys(seen[0].init.headers).sort()).toEqual(['Accept', 'Content-Type', 'X-API-Key']);
  });
  it('no key: explains and never fetches', async () => {
    let called = 0;
    const f = async () => { called++; return new Response('{}'); };
    expect((await S._readInboxTool('', false, f)).structuredContent.error).toBe('api_key_required');
    expect((await S._reportFindingTool(null, { class: 'other', tool: 't' }, f)).structuredContent.error).toBe('api_key_required');
    expect(called).toBe(0);
  });
});
