// scripts/web_bot_auth.py — the Python twin of lib/web-bot-auth.mjs, used by the
// scheduled Python probes (registry_monitor.py, verify_smithery_converged.py).
//
// Pins it to the SAME RFC 8032 vector as test/web-bot-auth.test.mjs: identical
// bytes from both signers, or Cloudflare verifies one and rejects the other.
// Also checks install_urllib_signing(): our hosts signed, third parties not,
// an existing Signature kept. Needs python3 with `cryptography`; it FAILS
// (never skips) without it, since a skipped parity check proves nothing.
//
// HARD gate: deterministic and no network. The Python child only ever calls a
// fake urlopen; nothing leaves the process. Mutation-checked red on a wrong
// tag, an any-host signer, an overwritten Signature, and a no-op installer.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const JWK = {
  kty: 'OKP', crv: 'Ed25519',
  x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
  d: 'nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A',
};
// Same expected headers as test/web-bot-auth.test.mjs NODE_HEADERS.
const EXPECTED = {
  'Signature-Agent': '"https://dchub.cloud"',
  'Signature-Input': 'sig1=("@authority" "signature-agent");created=1800000000;keyid="kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k";alg="ed25519";expires=1800000300;tag="web-bot-auth"',
  'Signature': 'sig1=:Tx4klK0fjagksCfbc/JqjDWotag7U7kbh0HMudcvPZVBU3REKWRIQ+HbggtU/S45X3wlhRFa8gp97Kvt90aKDg==:',
};

function py(code, env = {}) {
  const out = execFileSync('python3', ['-c', code], {
    cwd: SCRIPTS,
    env: { ...process.env, WEB_BOT_AUTH_PRIVATE_JWK: '', ...env },
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

describe('scripts/web_bot_auth.py', () => {
  it('has cryptography available (else every Python probe goes out unsigned)', () => {
    expect(py('import json, cryptography; print(json.dumps(True))')).toBe(true);
  });

  it('signs byte-for-byte like lib/web-bot-auth.mjs on the shared vector', () => {
    const got = py(
      'import json, web_bot_auth as w\n' +
      `print(json.dumps(w.probe_signature_headers("https://dchub.cloud/mcp", jwk=${JSON.stringify(JWK)}, now=1800000000)))`,
    );
    expect(got).toEqual(EXPECTED);
  });

  it('returns no headers without a key', () => {
    expect(py('import json, web_bot_auth as w; print(json.dumps(w.sign_if_own_host("https://dchub.cloud/")))')).toEqual({});
  });

  it('install_urllib_signing signs our hosts only and keeps an existing Signature', () => {
    const got = py(`
import json, urllib.request, web_bot_auth as w
seen = []
def fake(req, *a, **k):
    r = req if isinstance(req, urllib.request.Request) else urllib.request.Request(req)
    seen.append({"url": r.full_url, "h": {k.lower(): v for k, v in r.header_items()}})
urllib.request.urlopen = fake
assert w.install_urllib_signing() is True
assert w.install_urllib_signing() is False
urllib.request.urlopen("https://dchub.cloud/mcp")
urllib.request.urlopen(urllib.request.Request("https://mcp.dchub.cloud/x", headers={"User-Agent": "t"}))
urllib.request.urlopen(urllib.request.Request("https://registry.smithery.ai/x"))
urllib.request.urlopen(urllib.request.Request("https://dchub.cloud/y", headers={"Signature": "keep"}))
print(json.dumps(seen))
`, { WEB_BOT_AUTH_PRIVATE_JWK: JSON.stringify(JWK) });
    const keys = (s) => Object.keys(s.h).filter((k) => k.startsWith('signature')).sort();
    expect(got).toHaveLength(4);
    expect(keys(got[0])).toEqual(['signature', 'signature-agent', 'signature-input']);
    expect(keys(got[1])).toEqual(['signature', 'signature-agent', 'signature-input']);
    expect(got[1].h['user-agent']).toBe('t');
    expect(keys(got[2])).toEqual([]);
    expect(got[3].h.signature).toBe('keep');
    expect(keys(got[3])).toEqual(['signature']);
  });
});
