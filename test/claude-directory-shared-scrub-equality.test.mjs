// claude-directory-shared-scrub-equality.test.mjs — r-claude-directory (2026-09-26)
//
// /mcp/claude reuses the /mcp/chatgpt scrub by turning lib/chatgpt-directory.mjs
// into a factory (createDirectoryProfile). The ChatGPT profile is in OpenAI
// review (frz-chatgpt-toolset), so the refactor must not change a byte it
// serves. This runs the same inputs through the pre-refactor module (a frozen
// copy, test/fixtures/chatgpt-directory.pre-claude.mjs) and the live one:
//   - every /mcp tools/list and tools/call body the real server produces
//     against a planted backend, through transformDirectoryBody;
//   - hand-made edge cases (SSE, batch, errors, outage, connectors, gating);
//   - the full response filter on a real HTTP response.
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import * as OLD from './fixtures/chatgpt-directory.pre-claude.mjs';
import * as NEW from '../lib/chatgpt-directory.mjs';
import { startHarness, fenceNetwork, GUESS_ARGS, SPONSOR_TEXT_BLOCK } from './helpers/claude-directory-harness.mjs';

let H, fence;
beforeAll(async () => { fence = fenceNetwork(); H = await startHarness(); });
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

describe('the exported surface is unchanged', () => {
  it('same export names (new ones only added) and the same constants', () => {
    for (const k of Object.keys(OLD)) expect(Object.keys(NEW), k).toContain(k);
    for (const k of ['DIRECTORY_PROFILE', 'DIRECTORY_PATH', 'PLANS_URL', 'PLANS_NOTICE', 'DIRECTORY_INSTRUCTIONS']) expect(NEW[k], k).toBe(OLD[k]);
    for (const k of ['DIRECTORY_TOOLS', 'DIRECTORY_REMOVED', 'STANDARD_ANNOTATION_KEYS', 'DIRECTORY_ARG_DEFAULTS']) expect(NEW[k], k).toEqual(OLD[k]);
    expect([...NEW.EMAIL_OR_WEBHOOK_TOOLS]).toEqual([...OLD.EMAIL_OR_WEBHOOK_TOOLS]);
    expect([...NEW.DESTRUCTIVE_TOOLS]).toEqual([...OLD.DESTRUCTIVE_TOOLS]);
  });
});

describe('real server output through both modules', () => {
  it('tools/list and initialize from /mcp', async () => {
    const list = await H.list('/mcp');
    expect(NEW.transformDirectoryBody(list.raw, 'tools/list', null)).toBe(OLD.transformDirectoryBody(list.raw, 'tools/list', null));
    expect(NEW.directoryToolsList(list.msg.result)).toEqual(OLD.directoryToolsList(list.msg.result));
    const init = await H.init('/mcp');
    expect(NEW.transformDirectoryBody(init.raw, 'initialize', null)).toBe(OLD.transformDirectoryBody(init.raw, 'initialize', null));
  });

  it('every /mcp tool, no arguments and plausible ones', async () => {
    const tools = (await H.list('/mcp')).msg.result.tools.map((t) => t.name);
    let n = 0;
    for (const name of tools) {
      for (const args of [{}, GUESS_ARGS]) {
        const r = await H.call('/mcp', name, args);
        const a = NEW.transformDirectoryBody(r.raw, 'tools/call', name);
        const b = OLD.transformDirectoryBody(r.raw, 'tools/call', name);
        expect(a, `${name} ${args === GUESS_ARGS ? 'args' : 'no args'}`).toBe(b);
        if (r.msg && r.msg.result) {
          expect(NEW.scrubToolResult(r.msg.result, name)).toEqual(OLD.scrubToolResult(r.msg.result, name));
          expect(NEW.scrubStructured(r.msg.result)).toEqual(OLD.scrubStructured(r.msg.result));
        }
        n += 1;
      }
    }
    expect(n).toBeGreaterThan(150);   // 92 tools x 2
  }, 300_000);
});

describe('edge cases', () => {
  const texts = [
    'Plain sentence. Upgrade to Pro now for $99/mo. Next one.',
    '→ **For your human:** open https://dchub.cloud/upgrade/h/abc.def — see it',
    'Grid needs network upgrades. PJM queue is 290 GW.',
    'Deal paid $16B in cash.',
    'https://dchub.cloud/markets/ashburn?sid=abc&key=dch_live_x',
    'https://dchub.cloud/go/c/abc.def',
    'Call claim_free_key then analyze_site.',
    'Market note.' + SPONSOR_TEXT_BLOCK + 'After.',
    '---\nA\n\n\n\nB\n---',
    '', 'oai-0123456789abcdef', 'dch_trial_ABC123 is yours',
  ];
  it('scrubText', () => { for (const t of texts) expect(NEW.scrubText(t), t).toBe(OLD.scrubText(t)); });

  const bodies = [
    { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Unknown tool: claim_free_key' } },
    { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'Call claim_free_key for a key.' } },
    { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 1, message: 'Unlock more with Pro' } },
    { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{"a":1,"_score_in_pro":true}\n🧭 Next: execute_plan' }, { type: 'text', text: 'Upgrade to Pro.' }, { type: 'resource_link', uri: 'https://dchub.cloud/go/c/x' }, { type: 'image', data: 'x' }], structuredContent: { a: 1, _score_in_pro: true, session_id: 's', 'agent_payment.pay_now.steps': 3 }, isError: true } },
    { jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: '{"results":[]}' }, { type: 'text', text: 'The full result needs a plan.' }] } },
    { jsonrpc: '2.0', id: 4, result: { structuredContent: { source_unavailable: true, region: 'PJM-DOM', temporary: true, citation: { url: 'https://dchub.cloud/go/c/x', source: 'DC Hub' } } } },
    { jsonrpc: '2.0', id: 5, result: { structuredContent: { site_evaluation_handoff: { analyze_site: { lat: 1 } } }, rejected: [{ tool: 'analyze_site' }] } },
  ];
  it('transformDirectoryBody: JSON, batch and SSE', () => {
    for (const [i, b] of bodies.entries()) {
      for (const [m, t] of [['tools/call', 'get_news'], ['tools/call', 'search'], ['tools/call', 'fetch'], ['initialize', null], ['tools/list', null], ['resources/read', null]]) {
        const json = JSON.stringify(b);
        expect(NEW.transformDirectoryBody(json, m, t), `${i} ${m} ${t}`).toBe(OLD.transformDirectoryBody(json, m, t));
        const sse = `event: message\nid: 7\ndata: ${json}\n\n`;
        expect(NEW.transformDirectoryBody(sse, m, t), `sse ${i} ${m}`).toBe(OLD.transformDirectoryBody(sse, m, t));
      }
    }
    const batch = JSON.stringify(bodies);
    expect(NEW.transformDirectoryBody(batch, 'tools/call', 'get_news')).toBe(OLD.transformDirectoryBody(batch, 'tools/call', 'get_news'));
    expect(NEW.transformDirectoryBody('not json at all. Upgrade to Pro.', 'tools/call', 'x')).toBe(OLD.transformDirectoryBody('not json at all. Upgrade to Pro.', 'tools/call', 'x'));
  });

  it('isGated, directoryAnnotations, arg defaults, allowlist membership', () => {
    for (const b of bodies) if (b.result) expect(NEW.isGated(b.result)).toBe(OLD.isGated(b.result));
    for (const n of ['subscribe_digest', 'delete_standing_intent', 'get_news']) {
      expect(NEW.directoryAnnotations(n, { title: 'T', readOnlyHint: true, maturity: 'x' })).toEqual(OLD.directoryAnnotations(n, { title: 'T', readOnlyHint: true, maturity: 'x' }));
    }
    for (const a of [{}, { verdict: 'BUILD' }, { verdict: '' }]) {
      expect(NEW.applyDirectoryArgDefaults('site_selection_canvas', { ...a })).toEqual(OLD.applyDirectoryArgDefaults('site_selection_canvas', { ...a }));
    }
    for (const n of ['search', 'analyze_site', 'claim_free_key', 'toString', '__proto__']) expect(NEW.isDirectoryTool(n), n).toBe(OLD.isDirectoryTool(n));
  });
});

describe('the response filter on a real HTTP response', () => {
  it('identical status, headers and body', async () => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 9, result: { content: [{ type: 'text', text: '{"x":1,"for_your_human":{"url":"https://dchub.cloud/upgrade/h/a.b"}}' }] } });
    const serve = (mod) => new Promise((resolve) => {
      const s = createServer((req, res) => {
        req.body = { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_news', arguments: {} } };
        mod.installDirectoryResponseFilter(req, res);
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'abc', 'content-length': String(payload.length) });
        res.write(payload.slice(0, 20));
        res.end(payload.slice(20));
      });
      s.listen(0, '127.0.0.1', () => resolve(s));
    });
    const out = [];
    for (const mod of [OLD, NEW]) {
      const s = await serve(mod);
      const r = await fetch(`http://127.0.0.1:${s.address().port}/`);
      out.push({ status: r.status, session: r.headers.get('mcp-session-id'), type: r.headers.get('content-type'), body: await r.text() });
      await new Promise((resolve) => s.close(resolve));
    }
    expect(out[1]).toEqual(out[0]);
    expect(out[0].session).toBeNull();
  });
});
