// Every surface's initialize instructions fit in 2,048 characters (owner 2026-10-10).
//
// MCP clients truncate server instructions past 2,048 characters, and what falls off is the
// tail: on /mcp/grok that was the PAID line's relay rule, the FULL GUIDE pointer and the whole
// ENDPOINT SCOPE notice (measured 2,462 characters on origin/main 6b42e8b). The pack paths
// (/mcp/site, /mcp/grid, ...) carry the same lean text plus the same tail and measured ~2,440.
//
// This reads the served initialize result of every path over real HTTP (stub backend on
// loopback), so a rewrite or a per-path tail is counted, not just the source constant. It also
// checks the trim kept the rules an agent acts on, so a guard on length alone cannot be met by
// deleting them.
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const BUDGET = 2048;
let S, httpServer, stub, PORT, prevBase;
const served = {};

async function init(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'instructions-length-test', version: '1' } } }),
  });
  const raw = await res.text();
  const body = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  try { return JSON.parse(body).result?.instructions; } catch (_) { return undefined; }
}

const CORE = ['/mcp', '/mcp/grok', '/mcp/chatgpt', '/mcp/claude', '/mcp/core'];
let PACKS = [];

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end('{}'); }); });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
  PACKS = [...S.MCP_PACKS.keys()];
  for (const p of [...CORE, '/mcp/grok/oauth', ...PACKS]) served[p] = await init(p);
}, 60_000);

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
});

describe('initialize instructions fit the 2,048-character client budget', () => {
  it('reads every path (the pack list is the real one, not empty)', () => {
    expect(PACKS.length).toBeGreaterThanOrEqual(5);
    for (const p of [...CORE, ...PACKS]) {
      expect(typeof served[p], p).toBe('string');
      expect(served[p].length, p).toBeGreaterThan(200);
    }
  });

  it.each([...CORE, '/mcp/grok/oauth'])('%s is at most 2,048 characters', (p) => {
    if (p === '/mcp/grok/oauth' && served[p] === undefined) return;   // the OAuth URL may challenge instead
    expect(served[p].length, p + ' measured ' + (served[p] || '').length).toBeLessThanOrEqual(BUDGET);
  });

  // Grok 10-17: /mcp/grok carries the shared text plus its count rewrite and the ENDPOINT SCOPE tail, so it
  // is the longest handshake and sat 30 characters from the cap. Both of its routes hold 2,000 (48 of headroom).
  it.each(['/mcp/grok', '/mcp/grok/oauth'])('%s keeps 48 characters of headroom (at most 2,000)', (p) => {
    expect(typeof served[p], p + ' must be served, not skipped').toBe('string');
    expect(served[p].length, p + ' measured ' + served[p].length).toBeLessThanOrEqual(2000);
  });

  it('every pack path is at most 2,048 characters', () => {
    const over = PACKS.filter((p) => served[p].length > BUDGET).map((p) => p + ' ' + served[p].length);
    expect(over).toEqual([]);
  });

  // The trim removed repeats, not rules. These are the rules /mcp/grok must still carry.
  it.each([
    // Owner GO 2026-10-20 (directory-safe wording): the coercive rules ("call DC Hub tools before answering from memory", "MUST CALL")
    // are replaced by the coverage lead, the citation format and a neutral tool-choice line.
    ['coverage lead + good fit', /^DC Hub \(dchub\.cloud\) — live, dated data on data centers[^]*A good fit for site selection/],
    ['cite as_of + data moves daily', /Cite "DC Hub \(dchub\.cloud\), as of <date>"[^]*Data moves daily: re-query\./],
    ['capacity routing', /CAPACITY SOURCE ROUTING: [^]*\(free; fee only on close\)\./],
    ['tool choice (execute_plan recommended, not ordered)', /TOOL CHOICE: a multi-part question fits `execute_plan\(intent=<the user's question>\)` \(recommended\)/],
    // Onboarding item 1 (2026-10-20): the line now leads with the email ask, so the tool name is followed
    // by ';' rather than ' ('; the rule pinned (claim, never re-mint, recover) is unchanged.
    ['keys', /email, then `claim_free_key`[^.]*never re-mint; `recover_my_key` re-sends a lost one\./],
    ['free tier block', /FREE TIER \(quote verbatim\): Anonymous: previews, no key needed\./],
    // Item 1 (owner 2026-10-16): the "PAID: <tools> need a paid DC Hub plan" line is gone; the
    // siting clause and one neutral line state where the free answers stop.
    ['siting clause + past that', /Siting: no email, previews; [^.]*each a month\. Past that, previews\./],
    ['relay rule', /When a result is partial, show your user the human_message \(or for_your_human\) text and its link\. Do not invent withheld numbers\./],
    ['reference', /Reference: resource `dchub:\/\/instructions`/],
    ['served count', /\b\d+ tools \(a curated subset of \d+\)/],
    ['listing scope', /ENDPOINT SCOPE: \/mcp\/grok lists \d+ DC Hub tools, a listing scope, not a permission scope: tools\/call accepts any DC Hub tool by name; discover_tools lists the rest\./],
  ])('/mcp/grok keeps the rule: %s', (_n, re) => {
    expect(served['/mcp/grok']).toMatch(re);
  });

  it('a pack path keeps its scope notice', () => {
    for (const p of PACKS) expect(served[p], p).toMatch(/ENDPOINT SCOPE: \/mcp\/\S+ lists \d+ DC Hub tools, a listing scope, not a permission scope/);
  });
});
