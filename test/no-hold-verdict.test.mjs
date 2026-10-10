// No HOLD verdict in MCP tool text.
//
// Owner decision (2026-10-10): DC Hub verdict wording is BUILD / CAUTION /
// AVOID everywhere. HOLD is not a band the DCPI scorer produces
// (dchub-backend util/dcpi_method.VERDICT_BANDS + VERDICT_FALLBACK); on the
// site it was a null-verdict display default, now "No verdict yet". The
// backend and frontend carry the same guard.
//
// Two scans:
//  1. The SERVED tools/list of every surface — names, titles, descriptions
//     and input schemas — must not contain the upper-case word. Lower-case
//     "On Hold" (a project status) and "hold a key" are prose, not verdicts,
//     so the match is case-sensitive.
//  2. Shipped source (server.mjs, root *.json manifests, lib/, canonical/,
//     tools/, integrations/) must not use the
//     word as a verdict: next to BUILD/CAUTION/AVOID, after "verdict", or as
//     a quoted literal. ("YOU ALREADY HOLD A DC HUB KEY" is a sentence.)
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 'HO' + 'LD'; // built from parts: this file must not trip a repo scan
const WORD = new RegExp(`\\b${W}\\b`);
const V = '(?:BUILD|CAUTION|AVOID)';
const AS_VERDICT = new RegExp(
  `${V}[^\\n]{0,40}\\b${W}\\b|\\b${W}\\b[^\\n]{0,40}${V}` +
  `|verdict[^\\n]{0,30}\\b${W}\\b|['"\`]${W}['"\`]`, 'i');

const SURFACES = ['/mcp', '/mcp/chatgpt', '/mcp/grok'];
let httpServer, stub, PORT, prevBase;
const LISTS = {};

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}'); });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  const S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
  for (const path of SURFACES) {
    const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const raw = await res.text();
    const body = raw.includes('data: ')
      ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
    LISTS[path] = JSON.parse(body).result.tools;
  }
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
});

describe('the patterns can fail (must-fail controls)', () => {
  it('flags the word and its verdict uses', () => {
    for (const t of [`verdict ${W}`, `BUILD / ${W} / AVOID`, `|| '${W}'`, `"${W}"`])
      expect(WORD.test(t) && AS_VERDICT.test(t), t).toBe(true);
  });
  it('does not flag prose', () => {
    for (const t of ['On Hold', 'if you do not hold a key', 'THRESHOLD', 'HOLDING'])
      expect(WORD.test(t), t).toBe(false);
    expect(AS_VERDICT.test(`YOU ALREADY ${W} A DC HUB KEY`)).toBe(false);
  });
});

describe.each(SURFACES)('tools/list on %s', (path) => {
  it('lists tools (a scan over an empty list proves nothing)', () => {
    expect(LISTS[path].length).toBeGreaterThan(5);
  });
  it(`no tool text says ${W}`, () => {
    const bad = LISTS[path]
      .filter((t) => WORD.test(JSON.stringify(t)))
      .map((t) => `${t.name}: ${JSON.stringify(t).match(new RegExp(`.{0,60}\\b${W}\\b.{0,40}`))[0]}`);
    expect(bad, `${W} is not a DC Hub verdict (BUILD / CAUTION / AVOID only)`).toEqual([]);
  });
});

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (['.mjs', '.js', '.json'].includes(extname(n))) out.push(p);
  }
  return out;
}

describe('shipped source', () => {
  it(`never uses ${W} as a verdict`, () => {
    const files = [join(ROOT, 'server.mjs'),
      // static manifests that carry tool descriptions (toolspec.json, mcp-server.json, ...)
      ...readdirSync(ROOT).filter((n) => extname(n) === '.json' && n !== 'package-lock.json')
        .map((n) => join(ROOT, n)),
      ...['lib', 'canonical', 'tools', 'integrations'].flatMap((d) => {
        try { return walk(join(ROOT, d)); } catch { return []; }
      })];
    expect(files.length).toBeGreaterThan(20);
    const hits = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      if (!text.includes(W)) continue;
      text.split('\n').forEach((line, i) => {
        if (WORD.test(line) && AS_VERDICT.test(line))
          hits.push(`${f.slice(ROOT.length + 1)}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
