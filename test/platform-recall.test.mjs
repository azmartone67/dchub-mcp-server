import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _resolvePlatform, _rememberPlatform } from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const init = (name) => ({ method: 'initialize', params: { clientInfo: { name } } });
const call = () => ({ method: 'tools/call', params: { name: 'get_grid_intelligence' } });

describe('platform recall — the 90%-generic bucket', () => {
  it('a tools/call with no clientInfo and a generic UA is unattributable today', () => {
    // This is the measured failure: 2,967 of 3,301 real calls landed in `mcp`.
    expect(_resolvePlatform(call(), 'node', '', 'unknown-sid')).toBe('mcp');
  });

  it('recalls the platform learned at initialize for the same session', () => {
    const sid = `s-${Math.random()}`;
    // Production writes in onsessioninitialized once the server mints the id —
    // this mirrors that, rather than inventing a write path inside resolve().
    const atInit = _resolvePlatform(init('cursor'), 'node', '', sid);
    expect(atInit).toBe('cursor');
    _rememberPlatform(sid, atInit);
    // A later tools/call on that session carries no clientInfo at all.
    expect(_resolvePlatform(call(), 'node', '', sid)).toBe('cursor');
  });
});

describe('recall can only UPGRADE the generic bucket — never mis-attribute', () => {
  it('a positive UA detection always beats a remembered value', () => {
    const sid = `s-${Math.random()}`;
    _rememberPlatform(sid, 'cursor');
    // Same session, but this request's UA clearly identifies Claude.
    expect(_resolvePlatform(call(), 'claude-desktop/1.0', '', sid)).toBe('claude');
  });

  it('an explicit platform header always beats a remembered value', () => {
    const sid = `s-${Math.random()}`;
    _rememberPlatform(sid, 'cursor');
    expect(_resolvePlatform(call(), 'node', 'gemini', sid)).toBe('gemini');
  });

  it('never caches the generic value, so `mcp` cannot be recalled as an answer', () => {
    const sid = `s-${Math.random()}`;
    expect(_resolvePlatform(init('some-unknown-host'), 'node', '', sid)).not.toBe('mcp');
    const sid2 = `s-${Math.random()}`;
    // A session whose init was itself unattributable must stay unattributable.
    _rememberPlatform(sid2, _resolvePlatform({ method: 'initialize', params: {} }, 'node', '', sid2));
    expect(_resolvePlatform(call(), 'node', '', sid2)).toBe('mcp');
  });

  it('does not leak one session\'s platform to another', () => {
    const a = `s-${Math.random()}`, b = `s-${Math.random()}`;
    _rememberPlatform(a, 'mistral');
    expect(_resolvePlatform(call(), 'node', '', b)).toBe('mcp');
  });

  it('honours the kill switch', () => {
    const sid = `s-${Math.random()}`;
    _rememberPlatform(sid, 'perplexity');
    const prev = process.env.DCHUB_PLATFORM_RECALL;
    process.env.DCHUB_PLATFORM_RECALL = '0';
    try {
      expect(_resolvePlatform(call(), 'node', '', sid)).toBe('mcp');
    } finally {
      if (prev === undefined) delete process.env.DCHUB_PLATFORM_RECALL;
      else process.env.DCHUB_PLATFORM_RECALL = prev;
    }
  });

  it('is fail-soft on junk input', () => {
    expect(() => _resolvePlatform(null, null, null, null)).not.toThrow();
    expect(() => _resolvePlatform(call(), 'node', '', undefined)).not.toThrow();
  });
});

describe('WIRING — the write must sit where the session id actually exists', () => {
  it('remembers inside onsessioninitialized, not at the top of the initialize branch', () => {
    // At the top of that branch the client has no session id yet, and `sid` is
    // the callback parameter declared further down — referencing it there is a
    // ReferenceError that `node --check` cannot see.
    const m = SRC.match(/onsessioninitialized:\s*\(sid\)\s*=>\s*\{[\s\S]{0,600}?_rememberPlatform\(sid, platform\)/);
    expect(m, '_rememberPlatform must be called inside onsessioninitialized').toBeTruthy();
  });

  it('both stateless paths resolve through _resolvePlatform, not raw detection', () => {
    // The stateless tools/call path is where 90% of the loss happens.
    const statelessCall = SRC.match(/tools\/call'[\s\S]{0,900}?const platform\s*=\s*(\w+)\(/);
    expect(statelessCall[1]).toBe('_resolvePlatform');
    const statelessList = SRC.match(/tools\/list' \|\| body\?\.method === 'ping'[\s\S]{0,300}?const platform\s*=\s*(\w+)\(/);
    expect(statelessList[1]).toBe('_resolvePlatform');
  });
});
