// r-snapshot-drop (2026-08-31) — the sync must not write a snapshot that LIES
// about being current.
//
// WHAT HAPPENED: refresh-problem-taxonomy.mjs copies an EXPLICIT key list.
// When the owner added fields_not_collected (taxonomy v6), the sync wrote a
// snapshot carrying v6's version AND v6's contract_hash while silently
// dropping v6's actual new content. Then, because the hash now matched, the
// short-circuit refused to rewrite it — ever. A consumer checking
// contract_hash would have believed the snapshot was current indefinitely.
//
// Two things are pinned here: the new keys are copied, and the staleness gate
// is CONTENT-AWARE so any future field added to the owner repairs itself
// rather than needing a human to notice.
import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot } from '../scripts/refresh-problem-taxonomy.mjs';

// ★HARD GATE, NO NETWORK. Importing the script also runs its main(), which fetches
// the live canon taxonomy and, when a valid answer differs from the committed
// snapshot, rewrites canonical/problem_taxonomy.json. That starts while the imports
// above evaluate, before any module-body code runs, so this setup is in vi.hoisted,
// which runs before every import:
//   - that one endpoint answers 503 until afterAll, which takes main()'s "keeping
//     the committed snapshot" exit: no network, no write;
//   - every socket connect to a host other than loopback is refused and recorded,
//     and the last test fails if one was attempted.
const { foreign, realConnect, realFetch } = await vi.hoisted(async () => {
  const { default: netMod } = await import('node:net');
  const TAXONOMY_URL = 'https://dchub.cloud/api/v1/canon/taxonomy';
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => (String(input?.url ?? input) === TAXONOMY_URL
    ? new Response('stubbed by test', { status: 503 })
    : origFetch(input, init));
  const refused = [];
  const origConnect = netMod.Socket.prototype.connect;
  netMod.Socket.prototype.connect = function connect(...args) {
    let o = args[0];
    if (Array.isArray(o)) o = o[0];                        // net.connect's normalized form
    if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
    const host = String(o.host || 'localhost');
    if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
      refused.push(`${host}:${o.port}`);
      process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
      return this;
    }
    return origConnect.apply(this, args);
  };
  return { foreign: refused, realConnect: origConnect, realFetch: origFetch };
});
afterAll(() => {
  globalThis.fetch = realFetch;
  net.Socket.prototype.connect = realConnect;
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'canonical', 'problem_taxonomy.json'), 'utf8'));

const OWNER_V6 = {
  ok: true, version: 6, contract_hash: 'a4f6fc226ffb14c8',
  source: 'x', note: 'y',
  in_scope: ['a'], out_of_scope: ['b'], not_for_note: 'n'.repeat(50),
  why_live_reasons: { requires_x: 'x'.repeat(30) },
  fields_not_collected: [{
    field: 'PUE / Power Usage Effectiveness', aliases: ['pue'],
    why: 'not collected, and not modelled either',
    instead: 'get_facility returns cooling_type',
  }],
  fields_not_collected_note: 'z'.repeat(50),
};

describe('buildSnapshot carries the v6 keys', () => {
  it('copies fields_not_collected and its note', () => {
    const s = buildSnapshot(OWNER_V6);
    expect(s.fields_not_collected).toEqual(OWNER_V6.fields_not_collected);
    expect(s.fields_not_collected_note).toBe(OWNER_V6.fields_not_collected_note);
  });

  it('omits them entirely when the owner is still v5', () => {
    const { fields_not_collected, fields_not_collected_note, ...v5 } = OWNER_V6;
    const s = buildSnapshot({ ...v5, version: 5 });
    expect('fields_not_collected' in s).toBe(false);
    expect('fields_not_collected_note' in s).toBe(false);
  });
});

describe('the committed snapshot is not silently behind its own hash', () => {
  it('carries every key the current builder would write', () => {
    const expected = Object.keys(buildSnapshot(OWNER_V6))
      .filter(k => k !== 'retrieved_at');
    const missing = expected.filter(k => !(k in SNAP));
    expect(missing, `committed snapshot is missing ${missing.join(', ')} — ` +
      'it claims a contract_hash it does not fully carry').toEqual([]);
  });

  it('actually carries the absence list, with PUE searchable', () => {
    expect(Array.isArray(SNAP.fields_not_collected)).toBe(true);
    expect(SNAP.fields_not_collected.length).toBeGreaterThan(0);
    const aliases = SNAP.fields_not_collected.flatMap(f => f.aliases);
    expect(aliases).toContain('pue');
  });

  it('every instead still points elsewhere, in the SNAPSHOT too', () => {
    // The owner enforces this; a publishing surface re-checks rather than
    // trusting what it was handed.
    for (const f of SNAP.fields_not_collected) {
      for (const a of f.aliases) {
        expect(f.instead.toLowerCase(),
          `snapshot: instead for ${f.field} offers a substitute`).not.toContain(a);
      }
    }
  });
});

describe('hard gate: no network', () => {
  it('no connection left 127.0.0.1', () => {
    expect(foreign).toEqual([]);
  });
});
