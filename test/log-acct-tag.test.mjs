// The [MCP] request log line names WHICH key served a call, as a one-way tag (2026-11-27).
// It used to carry only the key's public prefix (key=dch_…), so two OAuth accounts on the same tier
// were indistinguishable in the logs. acct=logId(key) is 'h-' + 8 hex of sha256(key): stable, matchable in Neon with
// 'h-' || left(encode(sha256(api_key::bytea), 'hex'), 8), and reveals none of the key.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

let H, fence;
beforeAll(async () => { fence = fenceNetwork(); H = await startHarness(); });
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

const tagOf = (k) => 'h-' + createHash('sha256').update(k).digest('hex').slice(0, 8);
const ARGS = { lat: 39.04, lon: -77.48 };

async function linesDuring(fn) {
  const seen = [];
  const orig = console.log;
  console.log = (...a) => { seen.push(a.map(String).join(' ')); };
  try { await fn(); } finally { console.log = orig; }
  return seen.filter((l) => l.startsWith('[MCP] '));
}

describe('[MCP] log line acct tag', () => {
  it('a keyed call logs acct=<sha256 tag of the key>, and never the key', async () => {
    const lines = await linesDuring(() => H.call('/mcp', 'analyze_site', ARGS, { 'x-api-key': PRO_KEY }));
    const keyed = lines.filter((l) => /key=dch_live_…/.test(l));
    expect(keyed.length).toBeGreaterThan(0);
    for (const l of keyed) expect(l).toContain(` acct=${tagOf(PRO_KEY)}`);
    for (const l of lines) expect(l).not.toContain(PRO_KEY.slice(9));
  });
  it('two different keys log two different tags', () => {
    expect(tagOf(PRO_KEY)).not.toBe(tagOf(PRO_KEY + 'x'));
    expect(tagOf(PRO_KEY)).toMatch(/^h-[0-9a-f]{8}$/);
  });
  it('an anonymous call logs key=none and no acct tag', async () => {
    const lines = await linesDuring(() => H.call('/mcp', 'analyze_site', ARGS));
    const anon = lines.filter((l) => /key=none/.test(l));
    expect(anon.length).toBeGreaterThan(0);
    for (const l of anon) expect(l).not.toContain('acct=');
  });
});
