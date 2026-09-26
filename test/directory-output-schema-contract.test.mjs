// directory-output-schema-contract.test.mjs — r-directory-output-schema (2026-09-26)
//
// The directory profiles (/mcp/chatgpt, /mcp/claude) serve outputSchema only
// behind their flags (CHATGPT_DIRECTORY_OUTPUT_SCHEMA / CLAUDE_DIRECTORY_OUTPUT_SCHEMA,
// both off by default). With a flag on, every listed tool carries a schema
// projected from the canonical one through the same drops and renames the
// result scrub applies, and a strict 2020-12 client must accept every scrubbed
// result against it. This file is that contract, across every result class:
//   data     — an answer from the stub backend (free preview)
//   gated    — a preview carrying _withheld / withheld_fields + the plans notice
//   no-data  — the backend has nothing (404 / empty)
//   walled   — past the per-IP anonymous hard wall (anon_hard_wall)
// Validation runs on isError results too: a spec client skips them, a strict
// one may not, and a refusal that fails its own schema is still a bad schema.
//
// Canonical schemas are loose (additionalProperties {} on all 92, measured
// 2026-09-26), so Ajv alone cannot see a key the scrub removed or renamed but
// the schema still declares. The static block below pins that: a served schema
// never declares a key the result scrub would drop or rename, and its prose
// passes the same probe the results pass.
//
// Flag OFF is pinned too: the listing OpenAI reviewed has no outputSchema.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { DIRECTORY_TOOLS, DIRECTORY_REMOVED, CHATGPT_PROFILE } from '../lib/chatgpt-directory.mjs';
import { CLAUDE_DIRECTORY, CLAUDE_REMOVED } from '../lib/claude-directory.mjs';
import { probeHits, GUESS_ARGS } from '../scripts/probe-chatgpt-directory.mjs';
import { claudeProbePatterns, hitsOf } from './helpers/claude-directory-harness.mjs';

const foreign = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    foreign.push(`${host}:${o.port}`);
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

const FLAGS = ['CHATGPT_DIRECTORY_OUTPUT_SCHEMA', 'CLAUDE_DIRECTORY_OUTPUT_SCHEMA'];
const PROFILES = [
  { path: '/mcp/chatgpt', flag: 'CHATGPT_DIRECTORY_OUTPUT_SCHEMA', profile: CHATGPT_PROFILE, hits: probeHits },
  // Each profile is held to its own probe: /mcp/claude lists tools ChatGPT removed.
  { path: '/mcp/claude', flag: 'CLAUDE_DIRECTORY_OUTPUT_SCHEMA', profile: CLAUDE_DIRECTORY,
    hits: (t) => hitsOf(claudeProbePatterns(CLAUDE_REMOVED), t) },
];

// What the stub backend answers with. 'data' plants the markers the free-tier
// trimmers write and the commerce the real backend sends, so the scrub's drops
// and renames all fire on the way through.
let mode = 'data';
let anonCount = 0;
const DATA_BODY = {
  success: true, count: 3, total: 12,
  data: [
    { id: 1, name: 'Ashburn Campus A', market: 'northern-virginia', capacity_mw: 120,
      headline: 'Operator raises $5B for Virginia campus', value_usd: 5000000000 },
    { id: 2, name: 'Dallas Campus B', market: 'dallas', capacity_mw: 80, locked_fields: ['tenants'] },
    { id: 3, name: 'Phoenix Campus C', market: 'phoenix', capacity_mw: 60,
      source_note: 'Full list: https://dchub.cloud/upgrade/h/PLANTEDnote.99aa' },
  ],
  demand_mw: 18000, generation_mix: { NG: { mw: 9000 } },
  score: null, _score_in_pro: true, rows_total_in_pro: 12, preview_is_partial: true,
  note: 'Rows 4-12 come with the $10 pack or Pro at $99/mo. Upgrade to Pro now.',
  session_id: 'oai-' + 'a1b2c3d4'.repeat(8),
  _upgrade: { message: 'Call the claim_free_key tool.', upgrade_url: 'https://dchub.cloud/go/c/PLANTED.abc' },
  for_your_human: { url: 'https://dchub.cloud/upgrade/h/PLANTEDrelay.0123abcd' },
  site_evaluation_handoff: { analyze_site: { lat: 39.04, lon: -77.48 }, get_water_risk: { lat: 39.04, lon: -77.48 } },
  // Under a key no canonical schema types (get_energy_prices types data.grid_status).
  feed_outage: { region: 'PJM-DOM', source_unavailable: true, temporary: true, budget_exhausted: true,
                 detail: 'set EIA_API_KEY (owner directive)' },
};

let S, PORT, httpServer, stub, Ajv2020, addFormats;
const prev = {};

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
      if (p === '/api/v1/mcp/anon-usage') return send(200, { ok: true, count: anonCount });
      if (p === '/api/v1/mcp/trial-check') return send(200, { trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/session-key') return send(404, { error: 'not found' });
      if (p === '/api/v1/keys/auto-mint') return send(503, { ok: false });
      if (p === '/api/v1/keys/validate') return send(200, { valid: false, tier: 'free' });
      if (mode === 'nodata') return req.method === 'GET' ? send(404, { error: 'not_found' }) : send(200, { ok: true });
      if (mode === 'empty') return send(200, { success: true, count: 0, total: 0, data: [] });
      return send(200, DATA_BODY);
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ['DCHUB_API_BASE', 'DCHUB_ANON_DAILY_CAP', 'DCHUB_ANON_HARD_WALL_MULT', 'DCHUB_INTERNAL_KEY', ...FLAGS]) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_ANON_DAILY_CAP = '30';
  process.env.DCHUB_ANON_HARD_WALL_MULT = '10';
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  for (const f of FLAGS) delete process.env[f];
  S = await import('../server.mjs');
  if (S._readDeadline) S._readDeadline.signal = () => AbortSignal.timeout(120_000);
  Ajv2020 = (await import('ajv/dist/2020.js')).default;
  addFormats = (await import('ajv-formats')).default;
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  net.Socket.prototype.connect = realConnect;
});

let rpcId = 1;
async function post(path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { raw, msg: JSON.parse(b) };
}
const listTools = (path) => post(path, { jsonrpc: '2.0', id: rpcId++, method: 'tools/list' });
const callTool = (path, name, args) => post(path, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call',
                                                    params: { name, arguments: { ...args } } });

// Every property name a schema declares, at any depth.
function declaredKeys(schema, out = new Set()) {
  if (!schema || typeof schema !== 'object') return out;
  if (Array.isArray(schema)) { for (const s of schema) declaredKeys(s, out); return out; }
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'properties' && v && typeof v === 'object') {
      for (const [pk, pv] of Object.entries(v)) { out.add(pk); declaredKeys(pv, out); }
    } else declaredKeys(v, out);
  }
  return out;
}
function descriptions(schema, out = []) {
  if (!schema || typeof schema !== 'object') return out;
  if (Array.isArray(schema)) { for (const s of schema) descriptions(s, out); return out; }
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'description' && typeof v === 'string') out.push(v);
    else if (k === 'properties' && v && typeof v === 'object') for (const pv of Object.values(v)) descriptions(pv, out);
    else descriptions(v, out);
  }
  return out;
}
// What scrubValue keeps a key as: null = dropped. A {k: 1} probe object runs
// the real scrub, so this can never drift from it.
function scrubbedKeyName(profile, k) {
  const out = profile.scrubStructured({ [k]: 1 });
  const ks = Object.keys(out || {});
  return ks.length ? ks[0] : null;
}

describe('flag off: the reviewed listing is unchanged', () => {
  for (const { path } of PROFILES) {
    it(`${path} tools/list carries no outputSchema`, async () => {
      const { msg } = await listTools(path);
      expect(msg.result.tools.length).toBeGreaterThan(40);
      expect(msg.result.tools.filter((t) => t.outputSchema).map((t) => t.name)).toEqual([]);
    });
  }
});

describe.each(PROFILES)('flag on: $path', ({ path, flag, profile, hits }) => {
  let tools, byName, ajv, validators;

  beforeAll(async () => {
    process.env[flag] = '1';
    const { raw, msg } = await listTools(path);
    tools = msg.result.tools;
    byName = new Map(tools.map((t) => [t.name, t]));
    expect(hits(raw)).toEqual([]);
    ajv = new Ajv2020({ strict: true });
    addFormats(ajv);
    validators = new Map();
    for (const t of tools) validators.set(t.name, ajv.compile(t.outputSchema));
  });
  afterAll(() => { delete process.env[flag]; });

  it('every listed tool carries an outputSchema that compiles under strict 2020-12 with no dialect', () => {
    expect(tools.length).toBeGreaterThan(40);
    for (const t of tools) {
      expect(t.outputSchema, t.name).toBeTruthy();
      expect(t.outputSchema.$schema, t.name).toBeUndefined();
      expect(t.outputSchema.type, t.name).toBe('object');
      expect(t.outputSchema.properties.notice.type, t.name).toBe('string');
      expect(validators.get(t.name), t.name).toBeTypeOf('function');
    }
  });

  it('no served schema declares a key the result scrub drops or renames', () => {
    const bad = [];
    const removed = new Set(profile.removed);
    for (const t of tools) {
      for (const k of declaredKeys(t.outputSchema)) {
        if (removed.has(k)) { bad.push(`${t.name}.${k}: removed tool`); continue; }
        const kept = scrubbedKeyName(profile, k);
        if (kept !== k) bad.push(`${t.name}.${k} -> ${kept === null ? '(dropped)' : kept}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('schema prose is plain: no commerce, no removed tool, no steering', () => {
    const bad = [];
    const removedRe = new RegExp(`\\b(${profile.removed.join('|')})\\b`);
    const steer = /\b(when citing|how to attribute|cite (dc hub|this)|quote the|call this|prefer)\b/i;
    for (const t of tools) {
      for (const d of descriptions(t.outputSchema)) {
        if (hits(d).length) bad.push(`${t.name}: probe ${hits(d)}`);
        if (removedRe.test(d)) bad.push(`${t.name}: names removed tool: ${d.slice(0, 80)}`);
        if (steer.test(d)) bad.push(`${t.name}: steers: ${d.slice(0, 80)}`);
        if (profile.scrubText(d) !== d) bad.push(`${t.name}: scrub would change: ${d.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  // The contract. One sweep per result class; every structuredContent that
  // comes back is validated against the SERVED schema for its tool.
  async function sweep(m, count) {
    mode = m;
    anonCount = count;
    S._anonUsageCounts?.clear?.();
    const failures = [];
    const tally = { results: 0, validated: 0, gated: 0, withheld: 0, isError: 0, walled: 0 };
    for (const t of tools) {
      for (const args of [{}, GUESS_ARGS]) {
        const { msg } = await callTool(path, t.name, args);
        if (!msg.result) continue;
        tally.results += 1;
        const r = msg.result;
        if (r.isError) tally.isError += 1;
        const sc = r.structuredContent;
        if (!sc) {
          // A success result MUST carry structuredContent once a schema is declared.
          if (!r.isError) failures.push(`${t.name}: success result without structuredContent`);
          continue;
        }
        if (sc.error === 'anon_hard_wall') tally.walled += 1;
        if (typeof sc.notice === 'string') tally.gated += 1;
        if (/_withheld"|"withheld_fields"|_total_available"/.test(JSON.stringify(sc))) tally.withheld += 1;
        const v = validators.get(t.name);
        if (!v(sc)) failures.push(`${t.name}${args === GUESS_ARGS ? ' (args)' : ''}: ${ajv.errorsText(v.errors)}`);
        else tally.validated += 1;
      }
    }
    return { failures, tally };
  }

  it('data + gated: every scrubbed result validates against its served schema', async () => {
    const { failures, tally } = await sweep('data', 0);
    expect(failures).toEqual([]);
    // Floors: the sweep reached answers, gated previews, and renamed keys.
    expect(tally.validated).toBeGreaterThan(tools.length);
    expect(tally.gated).toBeGreaterThan(10);
    expect(tally.withheld).toBeGreaterThan(5);
  }, 300_000);

  it('no-data: 404 and empty backends validate (or error without structuredContent)', async () => {
    for (const m of ['nodata', 'empty']) {
      const { failures, tally } = await sweep(m, 0);
      expect(failures, m).toEqual([]);
      expect(tally.results, m).toBeGreaterThan(tools.length);
      expect(tally.isError + tally.validated, m).toBeGreaterThan(tools.length);
    }
  }, 600_000);

  it('walled: anon_hard_wall refusals validate', async () => {
    const { failures, tally } = await sweep('data', 999);
    expect(failures).toEqual([]);
    expect(tally.walled).toBeGreaterThan(tools.length);
  }, 300_000);
});

describe('projection unit: keys the canonical /mcp does not declare today', () => {
  // No canonical schema declares an _in_pro or locked key (2026-09-26), so the
  // renames are pinned on a synthetic schema.
  it('renames, drops and removed-tool keys follow the result scrub', () => {
    const canonical = {
      type: 'object', additionalProperties: {},
      properties: {
        score_in_pro: { type: 'boolean' }, rows_total_in_pro: { type: 'number' },
        locked_fields: { type: 'array', items: { type: 'string' } },
        quota: { type: 'object' }, _front_door: { type: 'object' }, for_your_human: { type: 'object' },
        [DIRECTORY_REMOVED[0]]: { type: 'object' },
        nested: { type: 'object', properties: { tier_required: { type: 'string' }, value: { type: 'number' } } },
        citation: { type: 'string', description: 'How to attribute DC Hub for this payload. Normally an object.' },
      },
      required: ['score_in_pro', 'quota'],
    };
    const s = CHATGPT_PROFILE.directoryOutputSchema(canonical);
    expect(Object.keys(s.properties).sort()).toEqual(
      ['citation', 'nested', 'notice', 'rows_total_available', 'score_withheld', 'withheld_fields'].sort());
    expect(Object.keys(s.properties.nested.properties)).toEqual(['value']);
    expect(s.required).toEqual(['score_withheld']);
    expect(s.properties.citation.description).toBe('Normally an object.');
    for (const k of Object.keys(canonical.properties)) {
      const kept = scrubbedKeyName(CHATGPT_PROFILE, k);
      if (kept !== null) expect(s.properties[kept], k).toBeTruthy();
      else expect(s.properties[k], k).toBeUndefined();
    }
  });

  it('a canonical `notice` of another type is widened, not replaced', () => {
    const s = CHATGPT_PROFILE.directoryOutputSchema({ type: 'object', properties: { notice: { type: 'object' } } });
    expect(s.properties.notice.anyOf).toEqual([{ type: 'object' }, expect.objectContaining({ type: 'string' })]);
  });

  it('no foreign network', () => { expect(foreign).toEqual([]); });
});
