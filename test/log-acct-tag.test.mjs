// The [MCP] request log line names WHICH key served a call, as a one-way tag (2026-11-27).
// It used to carry only the key's public prefix (key=dch_…), so two OAuth accounts on the same tier
// were indistinguishable in the logs. acct=logId(developer_id) is 'h-' + 8 hex of sha256 of the key row's
// developer_id (not the key: the key is never hashed into a log line). Match in Neon with
// 'h-' || left(encode(sha256(developer_id::bytea), 'hex'), 8) on mcp_dev_keys.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

let H, fence;
beforeAll(async () => { fence = fenceNetwork(); H = await startHarness(); });
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

const tagOf = (k) => 'h-' + createHash('sha256').update(k).digest('hex').slice(0, 8);
const ARGS = { lat: 39.04, lon: -77.48 };
const DEV_ID = 'dev_claude_test';   // what the harness's /keys/validate returns for PRO_KEY

async function linesDuring(fn) {
  const seen = [];
  const orig = console.log;
  console.log = (...a) => { seen.push(a.map(String).join(' ')); };
  try { await fn(); } finally { console.log = orig; }
  return seen.filter((l) => l.startsWith('[MCP] '));
}

describe('[MCP] log line acct tag', () => {
  it('a keyed call logs acct=<tag of its developer_id>, and neither the key nor a hash of it', async () => {
    const lines = await linesDuring(() => H.call('/mcp', 'analyze_site', ARGS, { 'x-api-key': PRO_KEY }));
    const keyed = lines.filter((l) => /key=dch_live_…/.test(l));
    expect(keyed.length).toBeGreaterThan(0);
    for (const l of keyed) expect(l).toContain(` acct=${tagOf(DEV_ID)}`);
    for (const l of lines) { expect(l).not.toContain(PRO_KEY.slice(9)); expect(l).not.toContain(tagOf(PRO_KEY)); }
  });
  it('two different accounts get two different tags', () => {
    expect(tagOf(DEV_ID)).not.toBe(tagOf(DEV_ID + 'x'));
    expect(tagOf(DEV_ID)).toMatch(/^h-[0-9a-f]{8}$/);
  });
  it('an anonymous call logs key=none and no acct tag', async () => {
    const lines = await linesDuring(() => H.call('/mcp', 'analyze_site', ARGS));
    const anon = lines.filter((l) => /key=none/.test(l));
    expect(anon.length).toBeGreaterThan(0);
    for (const l of anon) expect(l).not.toContain('acct=');
  });
});
