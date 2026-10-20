// integrations/arcade (owner 2026-10-20): DC Hub registered in Arcade as a
// Remote MCP server. These checks keep the registration config and the gateway
// allowlists in step with the real catalog, offline.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CLAUDE_REMOVED } from '../lib/claude-directory.mjs';
import { CORE_PATH } from '../lib/core-profile.mjs';
import { VIA_HEADER, SUGGESTED_TOOLS, normalizeVia } from '../lib/builders-page.mjs';
import {
  CONFIG, PROBE_CALL, parseRpcBody, checkToolList, hasCitation, requestHeaders,
} from '../integrations/arcade/check-arcade-compat.mjs';

const TOOLSPEC = JSON.parse(readFileSync(new URL('../toolspec.json', import.meta.url), 'utf8'));
const NAMES = new Set(TOOLSPEC.map((t) => t.name));
const REMOVED = new Set(CLAUDE_REMOVED);
const README = readFileSync(new URL('../integrations/arcade/README.md', import.meta.url), 'utf8');
const RAW = readFileSync(new URL('../integrations/arcade/arcade-remote-server.json', import.meta.url), 'utf8');
const PRICE = /\$\s?\d|\/mo\b|per month|\b(pro|developer|starter|enterprise) (plan|tier)\b/i;
const EMOJI = /[\p{Extended_Pictographic}]/u;
const P = CONFIG.gateway_profiles;

describe('arcade registration config', () => {
  it('points at the Streamable HTTP endpoint with an Arcade-safe id', () => {
    expect(CONFIG.uri).toBe('https://dchub.cloud/mcp');
    expect(CONFIG.transport).toBe('streamable-http');
    expect(CONFIG.id).toMatch(/^[a-z0-9-]+$/);
  });

  it('tags traffic with the via header the server reads, as a value it accepts', () => {
    expect(Object.keys(CONFIG.headers)).toEqual([VIA_HEADER]);
    expect(normalizeVia(CONFIG.headers[VIA_HEADER])).toBe('arcade');
  });

  it('sends the key as X-API-Key from an Arcade secret, never a literal', () => {
    const h = CONFIG.auth.api_key.headers;
    expect(h['X-API-Key']).toBe('${secret:DCHUB_API_KEY}');
    expect(RAW).not.toMatch(/dchub_[A-Za-z0-9]{8,}/);
  });

  it('names no plan or price and carries no emoji', () => {
    expect(RAW).not.toMatch(PRICE);
    expect(RAW).not.toMatch(EMOJI);
    expect(README).not.toMatch(PRICE);
    expect(README).not.toMatch(EMOJI);
  });
});

describe('gateway profiles', () => {
  it('every /mcp profile tool is a real tool and none is a write or key tool', () => {
    for (const k of ['lean', 'read_only']) {
      const unknown = P[k].tools.filter((n) => !NAMES.has(n));
      const writes = P[k].tools.filter((n) => REMOVED.has(n));
      expect(unknown, k).toEqual([]);
      expect(writes, k).toEqual([]);
      expect(new Set(P[k].tools).size, k).toBe(P[k].tools.length);
    }
  });

  it('read_only is exactly the catalog minus the removed set, so a new tool cannot drift out', () => {
    const want = TOOLSPEC.map((t) => t.name).filter((n) => !REMOVED.has(n)).sort();
    expect([...P.read_only.tools].sort()).toEqual(want);
  });

  it('lean covers every tool the builders page suggests to gateways', () => {
    for (const [name] of SUGGESTED_TOOLS) expect(P.lean.tools, name).toContain(name);
  });

  it('the core alternative uses the real /mcp/core path', () => {
    expect(P.core_endpoint.uri).toBe('https://dchub.cloud' + CORE_PATH);
    expect(P.core_endpoint.tools).toHaveLength(10);
  });

  it('every profile has a probe call to a tool it lists', () => {
    for (const [k, [name]] of Object.entries(PROBE_CALL)) expect(P[k].tools, k).toContain(name);
  });

  it('README lists every lean tool', () => {
    for (const n of P.lean.tools) expect(README, n).toContain('`' + n + '`');
  });
});

describe('compat checker helpers', () => {
  it('parses a JSON body and an SSE body, and rejects junk', () => {
    const m = { jsonrpc: '2.0', id: 1, result: { ok: 1 } };
    expect(parseRpcBody(JSON.stringify(m))).toEqual(m);
    expect(parseRpcBody('event: message\ndata: ' + JSON.stringify(m) + '\n\n')).toEqual(m);
    expect(parseRpcBody('event: message\ndata: not json\n')).toBeNull();
    expect(parseRpcBody('')).toBeNull();
  });

  it('flags a missing tool and a tool without readOnlyHint', () => {
    const tools = [
      { name: 'a', annotations: { readOnlyHint: true } },
      { name: 'b', annotations: { readOnlyHint: false } },
      { name: 'c' },
    ];
    expect(checkToolList(tools, ['a']).ok).toBe(true);
    const r = checkToolList(tools, ['a', 'b', 'c', 'z']);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['z']);
    expect(r.notReadOnly).toEqual(['b', 'c']);
  });

  it('finds cite_as and as_of in text or structuredContent, and reports their absence', () => {
    expect(hasCitation({ content: [{ type: 'text', text: '{"cite_as":"DC Hub","as_of":"2026-10-20"}' }] }))
      .toEqual({ cite_as: true, as_of: true });
    expect(hasCitation({ structuredContent: { cite_as: 'x', as_of: null } }))
      .toEqual({ cite_as: true, as_of: true });
    expect(hasCitation({ content: [{ type: 'text', text: 'no attribution here' }] }))
      .toEqual({ cite_as: false, as_of: false });
    expect(hasCitation(undefined)).toEqual({ cite_as: false, as_of: false });
  });

  it('marks its own probes as QA and sends a key only when one is set', () => {
    const h = requestHeaders({});
    expect(h['X-DCHub-QA']).toBe('1');
    expect(h['user-agent']).toMatch(/dchub-qa-readonly/);
    expect(h[VIA_HEADER]).toBe('arcade');
    expect(h['X-API-Key']).toBeUndefined();
    expect(requestHeaders({ DCHUB_API_KEY: 'k' })['X-API-Key']).toBe('k');
  });
});
