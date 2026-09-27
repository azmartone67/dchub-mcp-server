// lib/web-bot-auth.mjs — Web Bot Auth signing of this process's own requests.
//
// The key is the RFC 8032 §7.1 TEST 1 key (a published vector, not ours). Its
// thumbprint is the RFC 8037 A.3 value, and NODE_HEADERS are the exact headers
// dchub-frontend scripts/web-bot-auth.mjs and dchub-backend web_bot_auth.py
// produce for the same key and clock (Ed25519 is deterministic), so all three
// signers are pinned to each other.
//
// Hard gate (test/hard-gate.txt): hermetic. Every fetch goes to a stand-in
// transport, and the server-import case only checks the fetch wrapper.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPublicKey, verify } from 'node:crypto';
import { webBotAuthHeaders, jwkThumbprint, isOwnHost, installFetchSigning } from '../lib/web-bot-auth.mjs';

const JWK = {
  kty: 'OKP', crv: 'Ed25519',
  x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
  d: 'nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A',
};
const NODE_HEADERS = {
  'Signature-Agent': '"https://dchub.cloud"',
  'Signature-Input': 'sig1=("@authority" "signature-agent");created=1800000000;keyid="kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k";alg="ed25519";expires=1800000300;tag="web-bot-auth"',
  'Signature': 'sig1=:Tx4klK0fjagksCfbc/JqjDWotag7U7kbh0HMudcvPZVBU3REKWRIQ+HbggtU/S45X3wlhRFa8gp97Kvt90aKDg==:',
};
const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: JWK.x }, format: 'jwk' });

describe('signer', () => {
  it('thumbprint is the RFC 8037 A.3 value', () => {
    expect(jwkThumbprint(JWK)).toBe('kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k');
  });
  it('matches the frontend and backend signers byte for byte', () => {
    expect(webBotAuthHeaders('https://dchub.cloud/api/health', { jwk: JWK, now: 1800000000 })).toEqual(NODE_HEADERS);
  });
  it('signature verifies and is bound to the host', () => {
    const h = webBotAuthHeaders('https://DCHub.cloud/mcp', { jwk: JWK, now: 1800000000, ttl: 60 });
    const params = h['Signature-Input'].slice('sig1='.length);
    const sig = Buffer.from(h.Signature.slice(6, -1), 'base64');
    const base = `"@authority": dchub.cloud\n"signature-agent": "https://dchub.cloud"\n"@signature-params": ${params}`;
    expect(verify(null, Buffer.from(base), pub, sig)).toBe(true);
    expect(verify(null, Buffer.from(base.replace('dchub.cloud\n', 'evil.test\n')), pub, sig)).toBe(false);
  });
  it('own-host check', () => {
    expect(isOwnHost('dchub.cloud')).toBe(true);
    expect(isOwnHost('api.dchub.cloud')).toBe(true);
    expect(isOwnHost('notdchub.cloud')).toBe(false);
    expect(isOwnHost('dchub.cloud.evil.test')).toBe(false);
  });
});

describe('installFetchSigning', () => {
  let saved, savedEnv, seen;
  beforeEach(() => {
    saved = globalThis.fetch;
    savedEnv = process.env.WEB_BOT_AUTH_PRIVATE_JWK;
    process.env.WEB_BOT_AUTH_PRIVATE_JWK = JSON.stringify(JWK);
    seen = [];
    // A fresh, unwrapped transport standing in for the network.
    globalThis.fetch = async (input, init) => {
      const req = new Request(input, init);
      seen.push(Object.fromEntries(req.headers));
      return new Response('ok');
    };
    expect(installFetchSigning()).toBe(true);
  });
  afterEach(() => {
    globalThis.fetch = saved;
    if (savedEnv === undefined) delete process.env.WEB_BOT_AUTH_PRIVATE_JWK;
    else process.env.WEB_BOT_AUTH_PRIVATE_JWK = savedEnv;
  });
  const sigKeys = (h) => Object.keys(h).filter((k) => k.startsWith('signature')).sort();

  it('signs a string URL to our host and keeps the caller headers', async () => {
    await fetch('https://dchub.cloud/mcp', { method: 'POST', headers: { 'User-Agent': 'dchub-mcp-test', Accept: 'application/json' } });
    expect(sigKeys(seen[0])).toEqual(['signature', 'signature-agent', 'signature-input']);
    expect(seen[0]['user-agent']).toBe('dchub-mcp-test');
    expect(seen[0].accept).toBe('application/json');
  });
  it('signs a Request object and keeps its headers', async () => {
    await fetch(new Request('https://api.dchub.cloud/x', { headers: { 'X-Probe': '1' } }));
    expect(seen[0]['x-probe']).toBe('1');
    expect(seen[0]['signature-agent']).toBe('"https://dchub.cloud"');
  });
  it('signs a URL object', async () => {
    await fetch(new URL('https://dchub.cloud/api/health'));
    expect(seen[0].signature).toMatch(/^sig1=:/);
  });
  it('never signs another host', async () => {
    await fetch('https://dchub-backend-production.up.railway.app/api/v1/x');
    await fetch('https://notdchub.cloud/');
    expect(seen.map(sigKeys)).toEqual([[], []]);
  });
  it('keeps a signature the caller already set', async () => {
    await fetch('https://dchub.cloud/', { headers: { Signature: 'sig1=:mine:' } });
    expect(seen[0].signature).toBe('sig1=:mine:');
    expect(seen[0]['signature-input']).toBeUndefined();
  });
  it('no key → unchanged', async () => {
    delete process.env.WEB_BOT_AUTH_PRIVATE_JWK;
    await fetch('https://dchub.cloud/');
    expect(sigKeys(seen[0])).toEqual([]);
  });
  it('installs once', () => {
    expect(installFetchSigning()).toBe(false);
  });
});

describe('server.mjs installs it', () => {
  it('importing the server leaves globalThis.fetch wrapped', async () => {
    const { vi } = await import('vitest');
    const saved = globalThis.fetch;
    // Unwrapped stand-in, so only the server's own import chain can wrap it.
    globalThis.fetch = async () => new Response('{}');
    try {
      vi.resetModules();
      await import('../server.mjs');
      expect(globalThis.fetch[Symbol.for('dchub.webBotAuth.fetch')]).toBe(true);
    } finally {
      globalThis.fetch = saved;
    }
  });
});
