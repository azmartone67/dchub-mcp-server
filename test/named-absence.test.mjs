// r-named-absence (2026-08-31) — discover_tools must publish taxonomy v6
// `fields_not_collected` as `not_collected`.
//
// WHY: a user made 2,563 calls on 2026-08-01 hunting per-facility PUE, then
// left saying the values "did not appear to be accurate or reliable". PUE is
// not a field DC Hub carries at all. `out_of_scope` already listed PUE — but
// only as a DEFINITIONS question ("what is PUE"); asking for PUE VALUES is
// in_scope by topic, so it was never refused and nothing ever told him.
//
// `not_for`        = wrong question.
// `not_collected`  = RIGHT question, field we do not carry.
//
// OWNER is dchub-backend routes/problem_taxonomy.py; this repo only DERIVES
// from canonical/problem_taxonomy.json. The presence test below tracks the
// snapshot in BOTH directions on purpose: while the snapshot is still v5 it
// pins graceful degradation (no key, no crash), and the moment the daily sync
// lands v6 the same assertion starts pinning that the field is published.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ★HARD GATE, NO NETWORK. Installed at module evaluation, before beforeAll imports
// server.mjs, so nothing it starts slips past: every socket connect to a host other
// than loopback is refused and recorded, and the last test fails if one was attempted.
const foreign = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];                        // net.connect's normalized form
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    foreign.push(`${host}:${o.port}`);
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
const SNAP = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'canonical', 'problem_taxonomy.json'), 'utf8'));

let envelope, prevBase;
beforeAll(async () => {
  // server.mjs is imported here, after DCHUB_API_BASE points at an unroutable
  // address, because API_BASE is captured at module evaluation and the handler
  // call below fires tool-call tracking at it. A static import is hoisted and
  // evaluated server.mjs with the production default. Set until afterAll.
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';   // unroutable: no upstream
  const { createServer } = await import('../server.mjs');
  const tools = createServer()._registeredTools;
  const res = await tools.discover_tools.handler({}, { signal: new AbortController().signal });
  envelope = res.structuredContent;
}, 60000);

afterAll(() => {
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

describe('discover_tools envelope', () => {
  it('still answers normally', () => {
    expect(envelope._entity).toBe('tool_families');
    expect(Array.isArray(envelope.families)).toBe(true);
  });

  // The load-bearing one. Flips meaning when the snapshot syncs; never vacuous.
  it('publishes not_collected exactly when the snapshot carries it', () => {
    const inSnapshot = Array.isArray(SNAP.fields_not_collected)
      && SNAP.fields_not_collected.length > 0;
    expect(Object.hasOwn(envelope, 'not_collected')).toBe(inSnapshot);

    if (!inSnapshot) return;   // snapshot still v5 — degradation is the contract

    expect(envelope.not_collected.note).toBe(SNAP.fields_not_collected_note);
    expect(envelope.not_collected.fields).toEqual(SNAP.fields_not_collected);

    const aliases = envelope.not_collected.fields.flatMap(f => f.aliases);
    expect(aliases, 'the word that cost 2,563 calls must be searchable')
      .toContain('pue');

    for (const f of envelope.not_collected.fields) {
      expect(f.field, 'every absence names itself').toBeTruthy();
      expect(f.why, 'every absence explains itself').toBeTruthy();
      expect(f.instead, 'every absence points somewhere real').toBeTruthy();
      for (const a of f.aliases) {
        expect(f.instead.toLowerCase(),
          `instead for ${f.field} offers a substitute for the missing field`)
          .not.toContain(a);
      }
    }
  });
});

// Source-level pin: the emit must stay GUARDED. An unguarded read of a key an
// older snapshot lacks turns a stale canonical file into a broken navigator —
// the same emit-only-when-real discipline `not_for` already follows.
describe('the guard itself', () => {
  it('emits only when the snapshot really carries the field', () => {
    const at = SRC.indexOf('fields_not_collected');
    expect(at, 'not_collected emit not found in source').toBeGreaterThan(-1);
    const guard = SRC.slice(at - 260, at + 260);
    expect(guard).toContain('Array.isArray');
    expect(guard).toContain('.length');
  });

  it('does not claim the absent vocabulary anywhere in a tool description', () => {
    // The 2026-07-30 leaf-catchment decision is UNCHANGED by this work:
    // publishing an absence must never become licence to advertise the word.
    for (const term of ['pue', 'power usage effectiveness']) {
      const descs = [...SRC.matchAll(/trackedTool\(srv, '([a-z_]+)',\s*\n?\s*'((?:[^'\\]|\\.)*)'/g)];
      for (const [, name, desc] of descs) {
        expect(desc.toLowerCase(), `${name} claims '${term}'`).not.toContain(term);
      }
    }
  });
});

describe('hard gate: no network', () => {
  it('no connection left 127.0.0.1', () => {
    expect(foreign).toEqual([]);
  });
});
