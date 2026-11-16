// human-email-reply.test.mjs — the person's line carries the email offer (Grok to Brain 2026-11-16: walls
// offered 765, identities 149, converted 0). lib/human-email-reply.mjs, server.mjs _humanEmailReplyStep.
//
// MEASURED live 2026-11-16 (keyless get_interconnection_queue PJM, default /mcp, UA marked (dc-own-run)): the
// agent paragraph asked for an email ("If your user would like the full answer ... `bind_email`"), while the
// line every client is told to show the person said "DC Hub's paid layer has `projects` for this query — open
// <link> to see it and unlock", and on the session's later walls "free: 50 MCP calls/day with an email. Open
// this link to see what it found and how to unlock it". The person never read that they could type an email
// into the chat.
//
// WHAT THIS PINS
//   * the pure rewrite: each human-line shape buildHumanFirstLine writes and the relay message gain the reply
//     sentence, keep their link, lose "paid layer"; a line naming a plan, an unknown shape, a JSON block and a
//     line already rewritten are left as they are;
//   * the step: fires only where the wall asked the agent for an UNLOCK email and the prose names bind_email;
//     never on key_line, a bound email, the directory / Claude / core profiles, a clean platform, Grok, or with
//     DCHUB_HUMAN_EMAIL_REPLY=0;
//   * the real /mcp handler on a keyless queue wall: every person-facing field carries the reply sentence, the
//     agent paragraph and the machine fields are unchanged, and the switch restores the line byte for byte.
//
// Qualifies for the hard gate: real /mcp handler over loopback HTTP, a 127.0.0.1 stub backend, every
// off-loopback connect refused and recorded.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import * as H from '../lib/human-email-reply.mjs';
import { DIRECTORY_PROFILE } from '../lib/chatgpt-directory.mjs';
import { CLAUDE_PROFILE } from '../lib/claude-directory.mjs';
import { CORE_PROFILE } from '../lib/core-profile.mjs';

const foreign = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    foreign.push(`${host}:${o.port}`);
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

const SECRET = 'test-internal-key-not-a-real-secret';
const MARKER = '→ **For your human:**';
const REPLY = H.HUMAN_EMAIL_REPLY;
const REPLY_CORE = /reply with your email and your assistant can unlock the full answer here, no card needed\./i;
const U = 'https://dchub.cloud/u/qux9j3';

describe('the pure rewrite', () => {
  it('the treatment-arm line: "paid layer" goes, the reply sentence and the same link come in', () => {
    const out = H.rewriteHumanLine("DC Hub's paid layer has `projects` for this query — open " + U + ' to see it and unlock.');
    expect(out).toBe('DC Hub has `projects` for this query. ' + REPLY + ' Or open ' + U + ' to see what your agent found.');
    expect(out).not.toMatch(/paid/i);
    expect(H.lineUrl(out)).toBe(U);
    // the typographic apostrophe the module also writes
    expect(H.rewriteHumanLine('DC Hub’s paid layer has 25 rows — open ' + U + ' to see it and unlock.')).toContain('DC Hub has 25 rows.');
  });

  it('the partial-count line keeps its count', () => {
    const out = H.rewriteHumanLine("your agent got 3 of 47 `sites` rows here — DC Hub's paid layer has the other 44 rows — open " + U + ' to see it and unlock.');
    expect(out).toBe('your agent got 3 of 47 `sites` rows here — DC Hub has the other 44 rows. ' + REPLY + ' Or open ' + U + ' to see what your agent found.');
  });

  it('the generic line and the planless missed clause', () => {
    expect(H.rewriteHumanLine('open ' + U + ' — see what your agent found and how to unlock it.'))
      .toBe(REPLY + ' Or open ' + U + ' to see what your agent found.');
    const pl = 'this answer hid `projects`; those fields are withheld from this answer, and the page shows how to get them — open ' + U + ' to see what your agent found.';
    expect(H.rewriteHumanLine(pl)).toMatch(REPLY_CORE);
  });

  it('leaves alone: a line naming a plan, an unknown shape, a non-string, a line already rewritten', () => {
    expect(H.rewriteHumanLine('this answer hid `x`; the lowest plan that returns them is Developer — open ' + U + ' to see what your agent found.')).toBeNull();
    expect(H.rewriteHumanLine('this answer hid `x`; the plans that return them are on the page behind the link — open ' + U + ' to see what your agent found.')).toBeNull();
    expect(H.rewriteHumanLine('Some other sentence ' + U)).toBeNull();
    expect(H.rewriteHumanLine(null)).toBeNull();
    const once = H.rewriteHumanLine('open ' + U + ' — see what your agent found and how to unlock it.');
    expect(H.rewriteHumanLine(once)).toBeNull();
  });

  it('the relay message, both forms; after a lead that already says "free" the sentence drops its own "Free:"', () => {
    const lead = 'Your AI assistant hit DC Hub’s limit on get_interconnection_queue; free: 50 MCP calls/day with an email';
    const a = H.rewriteRelayMessage(lead + '. Open this link to see what it found and how to unlock it:');
    expect(a).toBe(lead + '. Reply with your email and your assistant can unlock the full answer here, no card needed. Or open this link to see what it found:');
    expect(a.match(/\bfree\b/gi)).toHaveLength(1);
    const b = H.rewriteRelayMessage('Your AI assistant got a preview of rank_markets from DC Hub. Open this link to see what it found and how to unlock it. ' + U);
    expect(b).toBe('Your AI assistant got a preview of rank_markets from DC Hub. ' + REPLY + ' Or open this link to see what it found: ' + U);
    expect(H.rewriteRelayMessage(a)).toBeNull();
    expect(H.rewriteRelayMessage('Something else.')).toBeNull();
  });

  it('applyHumanEmailReply: the marker line in prose and every person field; JSON blocks untouched; no match = same object', () => {
    const line = "DC Hub's paid layer has `projects` for this query — open " + U + ' to see it and unlock.';
    const json = JSON.stringify({ note: MARKER + ' ' + line });
    const res = { content: [{ type: 'text', text: json }, { type: 'text', text: 'Agent text.' }, { type: 'text', text: MARKER + ' ' + line }],
      structuredContent: { user_message: line, human_message: line + ' ' + U, ok: true,
        for_your_human: { text: line, url: U, message: 'Your AI assistant hit X. Open this link to see what it found and how to unlock it:' } } };
    const out = H.applyHumanEmailReply(res);
    expect(out.content[0].text).toBe(json);
    expect(out.content[1].text).toBe('Agent text.');
    expect(out.content[2].text.startsWith(MARKER + ' DC Hub has `projects`')).toBe(true);
    expect(out.content[2].text).toMatch(REPLY_CORE);
    for (const v of [out.structuredContent.user_message, out.structuredContent.for_your_human.text, out.structuredContent.for_your_human.message]) {
      expect(v).toMatch(REPLY_CORE);
    }
    expect(out.structuredContent.for_your_human.url).toBe(U);
    expect(out.structuredContent.ok).toBe(true);
    const none = { content: [{ type: 'text', text: 'no line here' }], structuredContent: { ok: true } };
    expect(H.applyHumanEmailReply(none)).toBe(none);
  });

  it('the switch reads per call', () => {
    expect(H.humanEmailReplyOn({})).toBe(true);
    for (const v of ['0', 'false', 'off', 'no']) expect(H.humanEmailReplyOn({ DCHUB_HUMAN_EMAIL_REPLY: v })).toBe(false);
  });
});

// ── server step + real handler ─────────────────────────────────────────────────────────────────────────────
const QUEUE_BY_ISO = {
  iso: 'PJM', as_of: '2026-10-07', queued_load_total_gw: 135.1, queued_load_total_gw_basis: 'generation_queue',
  queued_generation_gw: 135.1, queued_generation_gw_as_of: '2026-10-07', source_url: 'https://www.pjm.com/planning/service-requests',
  source_name: 'PJM queue', v: 'published', project_count: 972,
  projects: Array.from({ length: 25 }, (_, i) => ({ queue_id: `AG1-${100 + i}`, project_name: `Project ${i}`,
    capacity_mw: 100 + i, fuel_type: 'SOLAR', state: 'VA', queue_status: 'active' })),
};
const QSNAP = { by_iso: [{ iso: 'PJM', queued_load_total_gw: 135.1, queued_load_total_gw_basis: 'generation_queue', queued_generation_gw: 135.1, as_of: '2026-10-07' }] };
const SHORT_ALPHA = '23456789abcdefghjkmnpqrstuvwxyz';
const ENV = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_PREVIEW_ISERROR', 'DCHUB_WALL_ISERROR', 'DCHUB_HUMAN_EMAIL_REPLY'];
const prev = {};
let S, PORT, httpServer, stub, shortN = 0;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const p = new URL(req.url, 'http://_').pathname;
        res.setHeader('content-type', 'application/json');
        const send = (o, code = 200) => { res.statusCode = code; res.end(JSON.stringify(o)); };
        if (p === '/api/v1/relay/short') {
          let n = ++shortN, code = '';
          for (let i = 0; i < 6; i++) { code += SHORT_ALPHA[n % SHORT_ALPHA.length]; n = Math.floor(n / SHORT_ALPHA.length); }
          return send({ ok: true, url: 'https://dchub.cloud/u/' + code });
        }
        if (p === '/api/v1/keys/validate') return send({ valid: false, tier: 'free' });
        if (p === '/api/v1/mcp/trial-check') return send({ trial_used: false, prior_calls: 0 });
        if (p === '/api/v1/mcp/session-key') return send({ error: 'not found' }, 404);
        if (p === '/api/v1/mcp/anon-usage') return send({ ok: true, count: 0 });
        if (p === '/api/v1/interconnection-queue/snapshot') return send(QSNAP);
        if (p === '/api/v1/interconnection-queue/by-iso') return send(QUEUE_BY_ISO);
        return send({ ok: true });
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  process.env.DCHUB_PREVIEW_ISERROR = '0';   // the production transport
  process.env.DCHUB_WALL_ISERROR = '0';
  delete process.env.DCHUB_HUMAN_EMAIL_REPLY;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  for (const k of ENV) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  net.Socket.prototype.connect = realConnect;
});

describe('the step decides who gets it', () => {
  const line = "DC Hub's paid layer has `projects` for this query — open " + U + ' to see it and unlock.';
  const ask = 'If your user would like the full answer, ask whether they want to share their email, then call `bind_email` with it.';
  const mk = (agentText = ask) => ({ content: [{ type: 'text', text: '{}' }, { type: 'text', text: agentText }, { type: 'text', text: MARKER + ' ' + line }],
    structuredContent: { user_message: line, ok: true } });
  const run = (store, res = mk(), name = 'get_interconnection_queue') => S._ctxALS.run({ session_id: 's', client_ip: '198.51.100.9',
    tier: 'free', platform: 'cursor', _emailAsk: 'line', ...store }, async () => S._humanEmailReplyStep(res, name));
  const fired = (r) => REPLY_CORE.test(r.content[2].text) && REPLY_CORE.test(r.structuredContent.user_message);

  it('fires on an unlock ask (every unlock kind) with bind_email in the prose', async () => {
    for (const k of ['line', 'link', 'link_exit', 'bind_field']) expect(fired(await run({ _emailAsk: k })), k).toBe(true);
  });

  it('an unmarked wall counts when its prose carries the unlock ask itself (G8)', async () => {
    expect(fired(await run({ _emailAsk: '' }))).toBe(true);
    expect((await run({ _emailAsk: '' }, mk('Call `bind_email` with an address.'))).content[2].text, 'no ask sentence, no mark').toBe(MARKER + ' ' + line);
  });

  it('never: key_line, a bound email, frozen surfaces, Grok, no bind_email in prose, a key tool, the switch off', async () => {
    const same = async (store, res, name) => { const r0 = res || mk(); const r = await run(store, r0, name); expect(r).toBe(r0); };
    await same({ _emailAsk: 'key_line' });
    await same({ email: 'person@example.com' });
    for (const profile of [DIRECTORY_PROFILE, CLAUDE_PROFILE, CORE_PROFILE]) await same({ profile });
    await same({ platform: 'chatgpt' });
    await same({ platform: 'grok' });
    await same({}, mk('A preview. Open the page.'));
    await same({}, undefined, 'claim_free_key');
    process.env.DCHUB_HUMAN_EMAIL_REPLY = '0';
    try { await same({}); } finally { delete process.env.DCHUB_HUMAN_EMAIL_REPLY; }
  });
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, json: b ? JSON.parse(b) : null };
}
let ipN = 1;
async function keylessQueueWall() {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++ % 200 + 1}`, 'user-agent': 'human-email-reply-test/1.0' };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'human-email-reply-test', version: '1.0' } } });
  const h = { ...h0, 'mcp-session-id': init.headers.get('mcp-session-id') };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const r = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_interconnection_queue', arguments: { iso: 'PJM' } } });
  const result = (r.json && r.json.result) || {};
  const blocks = (result.content || []).map((c) => (typeof c.text === 'string' ? c.text : ''));
  return { result, blocks, sc: result.structuredContent || {} };
}

describe('real /mcp handler: a keyless get_interconnection_queue wall', () => {
  it('every person-facing field carries the reply sentence; the agent ask and the machine fields are unchanged', async () => {
    const w = await keylessQueueWall();
    const agent = w.blocks.find((t) => t.includes('`bind_email`') && !t.startsWith('{'));
    expect(agent, 'the fixture is vacuous unless the wall asked the agent for the email').toBeTruthy();
    const human = w.blocks.find((t) => t.includes(MARKER));
    expect(human, 'the wall carries the person line').toBeTruthy();
    expect(human).toMatch(REPLY_CORE);
    expect(human).not.toMatch(/paid layer/);
    expect(w.sc.human_url).toMatch(/^https:\/\/dchub\.cloud\//);
    for (const k of ['user_message', 'human_message']) {
      if (typeof w.sc[k] === 'string') expect(w.sc[k], k).toMatch(REPLY_CORE);
    }
    expect(w.sc.for_your_human && w.sc.for_your_human.text).toMatch(REPLY_CORE);
    expect(w.sc.next_call && w.sc.next_call.tool).toBe('bind_email');
    expect(w.sc._upgrade && w.sc._upgrade.next_tool).toBe('bind_email');
    // one person line, one link: nothing stacked
    expect(w.blocks.filter((t) => t.includes(MARKER))).toHaveLength(1);
  });

  it('DCHUB_HUMAN_EMAIL_REPLY=0: no reply sentence anywhere (the line as it was)', async () => {
    process.env.DCHUB_HUMAN_EMAIL_REPLY = '0';
    try {
      const w = await keylessQueueWall();
      const all = w.blocks.join('\n') + JSON.stringify(w.sc);
      expect(all).not.toMatch(/reply with your email and your assistant/i);
      expect(w.blocks.some((t) => t.includes(MARKER)), 'control: the person line is still there').toBe(true);
    } finally { delete process.env.DCHUB_HUMAN_EMAIL_REPLY; }
  });

  it('refused no off-loopback connection', () => {
    expect(foreign).toEqual([]);
  });
});
