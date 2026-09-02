// r-origin-edge-key (2026-09-02) — the origin must only answer the edge.
//
// THE DEFECT THIS PINS, measured live on 2026-09-02 before the fix:
//   POST https://dchub-mcp-server-production-4d2e.up.railway.app/mcp
//        {"jsonrpc":"2.0","id":1,"method":"tools/list"}
//   → 200, full tools/list, no credential. The sibling host
//     dchub-mcp-server-production.up.railway.app answered identically, and that
//     hostname was PUBLISHED, keyless, in the /mcp-selftest payload.
//
// The consequence is not just "the origin is reachable". agent_id is
// md5(first public X-Forwarded-For token) and mcp_calls_deloop.py's
// is_real_external treats CF POP ranges as non-agents — both assume arrival
// through Cloudflare, which overwrites XFF with cf-connecting-ip. At the origin
// the caller supplies its own XFF, so it can mint agent_ids or dodge counting.
//
// ★ WHAT MAKES THIS SUITE NON-VACUOUS. The gate has THREE states and the
//   dangerous one is the default: with DCHUB_EDGE_KEY unset it must be a
//   complete no-op, or this change is itself the outage. Every state is
//   exercised over a REAL HTTP request against the REAL express app — not
//   against a re-implementation of the predicate — because the property under
//   test is "is the middleware mounted on the MCP paths and nowhere else",
//   which a unit test of the predicate cannot see. The False branches (gate off;
//   /health exempt; correct key passes through to the real 404) are asserted as
//   carefully as the True one.
//
// DELETE /mcp is the probe verb on purpose: an unknown session id returns 404
// from the real handler with zero backend work, so "reached the handler" and
// "was refused by the gate" are distinguishable without a network round trip.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { app, _edgeKeyVerdict } from '../server.mjs';

const KEY = 'edge-key-under-test-0123456789';

let server, base;

beforeAll(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((r) => server.close(r)));

afterEach(() => {
  delete process.env.DCHUB_EDGE_KEY;
  delete process.env.DCHUB_EDGE_KEY_ENFORCE;
});

// DELETE, not POST: reaches the real handler for ~free (404 "Session not found").
const del = (path, headers = {}) =>
  fetch(`${base}${path}`, { method: 'DELETE', headers });

describe('_edgeKeyVerdict', () => {
  it('is off when no secret is configured — the shipped default', () => {
    expect(_edgeKeyVerdict(undefined, '')).toBe('off');
    expect(_edgeKeyVerdict('anything', '')).toBe('off');
  });

  it('separates missing from wrong', () => {
    expect(_edgeKeyVerdict(undefined, KEY)).toBe('missing');
    expect(_edgeKeyVerdict('', KEY)).toBe('missing');
    expect(_edgeKeyVerdict('nope', KEY)).toBe('bad');
    // Same length, one byte off — the case a naive prefix compare would pass.
    expect(_edgeKeyVerdict(KEY.slice(0, -1) + 'X', KEY)).toBe('bad');
  });

  it('accepts the exact key', () => {
    expect(_edgeKeyVerdict(KEY, KEY)).toBe('ok');
  });
});

describe('DCHUB_EDGE_KEY unset — the gate is inert', () => {
  it('serves /mcp exactly as before and stamps nothing', async () => {
    // THE SAFETY PROPERTY. If this ever 403s, merging this change is the outage.
    const r = await del('/mcp');
    expect(r.status).toBe(404);
    expect(r.headers.get('x-dc-edge-key')).toBeNull();
  });
});

describe('observe mode — key set, enforcement off', () => {
  it('still serves an unkeyed request, but stamps it missing', async () => {
    process.env.DCHUB_EDGE_KEY = KEY;
    const r = await del('/mcp');
    expect(r.status).toBe(404);                            // reached the handler
    expect(r.headers.get('x-dc-edge-key')).toBe('missing'); // and was counted
  });

  it('stamps a wrong key bad without refusing it', async () => {
    process.env.DCHUB_EDGE_KEY = KEY;
    const r = await del('/mcp', { 'x-dc-edge-key': 'wrong' });
    expect(r.status).toBe(404);
    expect(r.headers.get('x-dc-edge-key')).toBe('bad');
  });
});

describe('enforcement — key set, DCHUB_EDGE_KEY_ENFORCE=1', () => {
  it('THE REGRESSION: an unkeyed origin request is refused', async () => {
    process.env.DCHUB_EDGE_KEY = KEY;
    process.env.DCHUB_EDGE_KEY_ENFORCE = '1';
    const r = await del('/mcp');
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe('edge_key_required');
  });

  it('refuses a wrong key', async () => {
    process.env.DCHUB_EDGE_KEY = KEY;
    process.env.DCHUB_EDGE_KEY_ENFORCE = '1';
    expect((await del('/mcp', { 'x-dc-edge-key': 'wrong' })).status).toBe(403);
  });

  it('403, never 401 — a 401 would start an OAuth flow instead of refusing', async () => {
    process.env.DCHUB_EDGE_KEY = KEY;
    process.env.DCHUB_EDGE_KEY_ENFORCE = '1';
    const r = await del('/mcp');
    expect(r.status).not.toBe(401);
    expect(r.headers.get('www-authenticate')).toBeNull();
  });

  it('THE FALSE BRANCH: the edge, carrying the key, still gets through', async () => {
    process.env.DCHUB_EDGE_KEY = KEY;
    process.env.DCHUB_EDGE_KEY_ENFORCE = '1';
    const r = await del('/mcp', { 'x-dc-edge-key': KEY });
    expect(r.status).toBe(404);            // the real handler, not the gate
    expect(r.headers.get('x-dc-edge-key')).toBe('ok');
  });

  it('covers /mcp/analyst too — every MCP path, not just the canonical one', async () => {
    process.env.DCHUB_EDGE_KEY = KEY;
    process.env.DCHUB_EDGE_KEY_ENFORCE = '1';
    expect((await del('/mcp/analyst')).status).toBe(403);
  });
});

describe('the open surfaces stay open', () => {
  it('/health answers unkeyed even under enforcement', async () => {
    // Registries and uptime monitors read this. Closing it would trade a real
    // exposure for a self-inflicted health flag — and it carries no data.
    process.env.DCHUB_EDGE_KEY = KEY;
    process.env.DCHUB_EDGE_KEY_ENFORCE = '1';
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe('healthy');
  });

  it('/server.json answers unkeyed even under enforcement', async () => {
    process.env.DCHUB_EDGE_KEY = KEY;
    process.env.DCHUB_EDGE_KEY_ENFORCE = '1';
    expect((await fetch(`${base}/server.json`)).status).toBe(200);
  });
});

describe('/internal/edge-key — the evidence for the flip', () => {
  it('needs the internal key', async () => {
    expect((await fetch(`${base}/internal/edge-key`)).status).toBe(403);
  });

  it('is NOT itself behind the edge gate — the mount is scoped to MCP_PATHS', async () => {
    // Kills the mutation `app.use(MCP_PATHS, …)` → `app.use(…)`. Under a global
    // mount every route registered BELOW the gate is silently gated, and this is
    // the only one there today — so it is the whole detector for that class.
    // Status alone cannot tell the two 403s apart (both refuse); the absence of
    // the gate's own stamp can.
    process.env.DCHUB_EDGE_KEY = KEY;
    process.env.DCHUB_EDGE_KEY_ENFORCE = '1';
    const r = await fetch(`${base}/internal/edge-key`);
    expect(r.headers.get('x-dc-edge-key')).toBeNull();
  });
});
