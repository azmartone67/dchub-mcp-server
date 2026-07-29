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
    const m = SRC.match(/onsessioninitialized:\s*\(sid\)\s*=>\s*\{[\s\S]{0,900}?_rememberPlatform\(sid,/);
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

describe('client_name recall — the 88% generic bucket', () => {
  // The identity VIEW classifies on `client_name` FIRST (PLATFORM_CASE takes it
  // verbatim when present and non-UUID), and telemetry sends
  //   client_name: c.client_name_raw || c.platform
  // The SESSION path spreads ...sessionMeta, so it carries client_name_raw.
  // The STATELESS path built an explicit ctx object that never had it — so every
  // stateless call fell back to the platform, which was the generic 'mcp'.
  // Measured: 65 agents / 3,179 calls sitting in that one bucket.
  it('remembers the RAW clientInfo.name, not just the normalized platform', async () => {
    const { _rememberPlatform, _recallClientName, _recallPlatform } = await import('../server.mjs');
    const sid = `s-${Math.random()}`;
    _rememberPlatform(sid, 'claude', 'claude-ai');
    expect(_recallPlatform(sid)).toBe('claude');      // normalized, for routing
    expect(_recallClientName(sid)).toBe('claude-ai'); // raw, for the view
  });

  it('keeps the raw name even when the platform is the generic value', async () => {
    // A client whose name we cannot normalize still has a usable RAW name —
    // dropping it is exactly how distinct clients collapsed into one bucket.
    const { _rememberPlatform, _recallClientName, _recallPlatform } = await import('../server.mjs');
    const sid = `s-${Math.random()}`;
    _rememberPlatform(sid, 'mcp', 'some-host-we-have-no-rule-for');
    expect(_recallPlatform(sid)).toBeNull();                       // never cache generic
    expect(_recallClientName(sid)).toBe('some-host-we-have-no-rule-for');
  });

  it('returns null rather than guessing for an unknown session', async () => {
    const { _recallClientName } = await import('../server.mjs');
    expect(_recallClientName(`s-${Math.random()}`)).toBeNull();
    expect(_recallClientName(null)).toBeNull();
  });

  it('honours the kill switch', async () => {
    const { _rememberPlatform, _recallClientName } = await import('../server.mjs');
    const sid = `s-${Math.random()}`;
    _rememberPlatform(sid, 'cursor', 'cursor-vscode');
    const prev = process.env.DCHUB_PLATFORM_RECALL;
    process.env.DCHUB_PLATFORM_RECALL = '0';
    try { expect(_recallClientName(sid)).toBeNull(); }
    finally {
      if (prev === undefined) delete process.env.DCHUB_PLATFORM_RECALL;
      else process.env.DCHUB_PLATFORM_RECALL = prev;
    }
  });

  it('WIRING: the stateless tools/call ctx carries client_name_raw', () => {
    // Without this the fix is inert — telemetry would still send the platform.
    const m = SRC.match(/session_id: sessionId \|\| null,[\s\S]{0,400}?client_name_raw: _recallClientName\(sessionId\)/);
    expect(m, 'stateless ctx must thread client_name_raw').toBeTruthy();
  });

  it('WIRING: initialize records both the platform and the raw name', () => {
    const m = SRC.match(/_rememberPlatform\(sid, platform,[\s\S]{0,120}?clientInfo\?\.name/);
    expect(m, 'initialize must record clientInfo.name alongside platform').toBeTruthy();
  });
});
