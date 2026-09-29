// registry-remotes.test.mjs — server.json `remotes` is generated from
// lib/registry-remotes.mjs, and every URL it advertises actually serves MCP.
//
// A remote in the official registry is handed to every client that installs
// from it (and mirrored by PulseMCP / Glama), so a listed path that does not
// answer `initialize` is a connector that silently never loads. GET on an
// unregistered /mcp/<x> answers 200 from the worker health blob, which is why
// this test POSTs `initialize` to the real server rather than trusting a GET.
//
// Hard-gate qualified: real server on 127.0.0.1 against a local stub, network
// fenced, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  REGISTRY_REMOTE_PATHS, REGISTRY_REMOTE_EXCLUDED, registryRemotes,
} from '../lib/registry-remotes.mjs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const SJ = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
let H, fence;

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness();
});
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
});

describe('server.json remotes', () => {
  it('equal the allowlist exactly (sync-tools-manifest generates them)', () => {
    expect(SJ.remotes).toEqual(registryRemotes());
  });

  it('the allowlist is registry + claude + grok, cascade path first', () => {
    expect(REGISTRY_REMOTE_PATHS).toEqual(['/mcp/registry', '/mcp/claude', '/mcp/grok']);
    expect(SJ.remotes[0].url).toBe('https://dchub.cloud/mcp/registry');
  });

  it('never advertises /mcp/chatgpt (OpenAI review) or bare /mcp', () => {
    const urls = SJ.remotes.map((r) => r.url);
    for (const p of Object.keys(REGISTRY_REMOTE_EXCLUDED)) {
      expect(urls, p).not.toContain(`https://dchub.cloud${p}`);
    }
  });

  it('every remote matches the 2025-12-11 StreamableHttpTransport shape, no duplicates', () => {
    const urls = SJ.remotes.map((r) => r.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const r of SJ.remotes) {
      expect(Object.keys(r).sort()).toEqual(['type', 'url']);
      expect(r.type).toBe('streamable-http');
      expect(r.url).toMatch(/^https:\/\/dchub\.cloud\/mcp\/[a-z]+$/);
    }
  });

  it('every listed path is a route the server mounts', () => {
    for (const p of REGISTRY_REMOTE_PATHS) expect(H.S.MCP_PATHS, p).toContain(p);
  });

  it.each(REGISTRY_REMOTE_PATHS)('%s answers initialize with DC Hub serverInfo', async (p) => {
    const r = await H.init(p, 'registry-remote-check');
    expect(r.status, `${p} status`).toBe(200);
    expect(r.msg?.error, `${p} error`).toBeUndefined();
    expect(r.msg?.result?.serverInfo?.version).toBe(SJ.version);
    expect(r.msg?.result?.capabilities?.tools).toBeTruthy();
  });

  it('CONTROL: an unmounted path does NOT answer initialize (the check can fail)', async () => {
    const r = await H.init('/mcp/not-a-profile', 'registry-remote-check');
    expect(r.msg?.result?.serverInfo).toBeUndefined();
  });
});
