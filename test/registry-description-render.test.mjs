// Registry descriptions are RENDERED from one template (Grok A6, 2026-10-09).
// canonical/registry-description-template.json + scripts/registry-description.mjs
// produce the `description` of server.json, smithery.yaml and mcp-server.json;
// sync-tools-manifest.mjs --fix writes it and CHECK fails on any difference.
//
// Qualifies for the HARD gate (test/hard-gate.txt): deterministic, no network
// (liveCompare takes an injected fetch), and every file mutation happens inside
// a createRepoSandbox() copy, never the shared tree.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRepoSandbox } from './helpers/repo-sandbox.mjs';
import { renderAll, renderTemplate, buildSlots, loadContext, liveCompare, SERVER_JSON_MAX } from '../scripts/registry-description.mjs';

const REAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX = createRepoSandbox(REAL_ROOT);
afterAll(() => SANDBOX.cleanup());
const R = (...p) => path.join(SANDBOX.root, ...p);
const SCRIPT = R('scripts', 'sync-tools-manifest.mjs');

function run(args = []) {
  try { return { ok: true, out: execFileSync('node', [SCRIPT, ...args], { cwd: SANDBOX.root, encoding: 'utf8' }) }; }
  catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` }; }
}
function mutate(rel, fn, body) {
  const orig = fs.readFileSync(R(rel), 'utf8');
  const next = fn(orig);
  expect(next, `mutation of ${rel} did not apply — the control would be vacuous`).not.toBe(orig);
  try { SANDBOX.write(R(rel), next); return body(); } finally { SANDBOX.write(R(rel), orig); }
}

const count = Number(execFileSync('node', [path.join(REAL_ROOT, 'scripts', 'sync-tools-manifest.mjs'), '--print-count'], { encoding: 'utf8' }));
const ctx = await loadContext(count);
const committed = () => ({
  server_json: JSON.parse(fs.readFileSync(path.join(REAL_ROOT, 'server.json'), 'utf8')).description,
  smithery_yaml: JSON.parse(fs.readFileSync(path.join(REAL_ROOT, 'smithery.yaml'), 'utf8').match(/^description:[ \t]*(.+)$/m)[1]),
  mcp_server_json: JSON.parse(fs.readFileSync(path.join(REAL_ROOT, 'mcp-server.json'), 'utf8')).description,
});

describe('the committed descriptions ARE the render', () => {
  it('server.json, smithery.yaml and mcp-server.json equal the render byte for byte', () => {
    expect(committed()).toEqual(renderAll(ctx));
  });
  it('server.json fits the registry cap and no render carries a facility number or a stray brace', () => {
    const r = renderAll(ctx);
    expect(r.server_json.length).toBeLessThanOrEqual(SERVER_JSON_MAX);
    for (const t of Object.values(r)) {
      expect(t).not.toMatch(/[{}]/);
      expect(t).not.toMatch(/\d[\d,]*\+?\s+(?:global\s+)?(?:data[- ]center\s+)?facilit/i);
    }
  });
  it('both long descriptions carry the same free-tier, price and tool-count facts', () => {
    const r = renderAll(ctx);
    expect(r.smithery_yaml).toContain(`${count} tools.`);
    for (const t of [r.smithery_yaml, r.mcp_server_json]) {
      expect(t).toContain('$10');
      expect(t).toContain('1,000 API credits');
      expect(t).toContain('(corroborated count pending)');
    }
    expect(r.mcp_server_json).toContain(ctx.tier.freeTierRule);
  });
});

describe('check mode fails when a file differs from the render (must-fail controls)', () => {
  it('baseline: the sandbox tree passes', () => { expect(run().ok).toBe(true); });
  it('mcp-server.json description edited', () => {
    mutate('mcp-server.json', (s) => s.replace('Real-time data-center, power', 'Real-time datacenter, power'), () => {
      const { ok, out } = run();
      expect(ok).toBe(false);
      expect(out).toMatch(/mcp-server\.json description differs from the render/);
    });
  });
  it('smithery.yaml description edited, and --fix converges it back', () => {
    mutate('smithery.yaml', (s) => s.replace('from 7 independent feeds', 'from 8 independent feeds'), () => {
      const { ok, out } = run();
      expect(ok).toBe(false);
      expect(out).toMatch(/smithery\.yaml description differs from the render/);
      expect(run(['--fix']).ok).toBe(true);
      expect(run().ok).toBe(true);
      expect(fs.readFileSync(R('smithery.yaml'), 'utf8')).toContain('from 7 independent feeds');
    });
  });
  it('server.json description edited', () => {
    mutate('server.json', (s) => s.replace('query and cite.', 'query and cite it.'), () => {
      const { ok, out } = run();
      expect(ok).toBe(false);
      expect(out).toMatch(/server\.json description differs from the render/);
    });
  });
  it('a template edit alone is caught (the template is the single owner of the prose)', () => {
    mutate('canonical/registry-description-template.json', (s) => s.replace('{countries} countries, {substations}', '{countries} nations, {substations}'), () => {
      const { ok, out } = run();
      expect(ok).toBe(false);
      expect(out).toMatch(/description differs from the render/);
    });
  });
  it('a canon phrase move beyond the floor tolerance is still caught (substations 134,000+ -> 234,000+)', () => {
    // Figures beside a canon noun stay under the existing floor rules (5% tolerance,
    // notation-neutral), so a small walk is a warning there, not prose drift.
    mutate('canonical/canon_phrases.json', (s) => s.replace('"substations": "134,000+"', '"substations": "234,000+"'), () => {
      const { ok, out } = run();
      expect(ok).toBe(false);
      expect(out).toMatch(/substation/i);
    });
  });
  it('a non-canon figure in the prose (feed count in facts) reaches the render', () => {
    mutate('canonical/mcp_facts.json', (s) => s.replace('"live_feeds": 7', '"live_feeds": 8'), () => {
      const { ok, out } = run();
      expect(ok).toBe(false);
      expect(out).toMatch(/smithery\.yaml description differs from the render/);
    });
  });
  it('REFUSES to render when the facility count stops being withheld', () => {
    mutate('canonical/mcp_facts.json', (s) => s.replace('"status": "corroboration_pending"', '"status": "counted"'), () => {
      const { ok, out } = run();
      expect(ok).toBe(false);
      expect(out).toMatch(/FATAL \(registry description\).*corroboration_pending/s);
    });
  });
});

describe('renderer fails closed', () => {
  it('an unknown slot or filter throws', () => {
    const slots = buildSlots(ctx);
    expect(() => renderTemplate('{nope}', slots)).toThrow(/no value/);
    expect(() => renderTemplate('{deals|zzz}', slots)).toThrow(/unknown filter/);
  });
  it('a server.json render over the registry cap throws', () => {
    expect(() => renderAll(ctx, { server_json: 'x'.repeat(SERVER_JSON_MAX + 1), smithery_yaml: 'a', mcp_server_json: 'b' })).toThrow(/caps it at/);
  });
});

describe('optional live compare warns, never fails', () => {
  const live = (over = {}) => async () => ({ ok: true, json: async () => ({
    tools: { surfaces: { mcp: count } }, headline_phrases: { ...ctx.phrases }, prices: { credit_pack: ctx.tier.pack },
    free_tier: ctx.tier.freeTierRule, facilities: { status: 'corroboration_pending' }, ...over }) });
  it('agrees when canon agrees', async () => {
    expect(await liveCompare(ctx, live())).toEqual({ observed: true, warns: [] });
  });
  it('names each drifted input', async () => {
    const r = await liveCompare(ctx, live({ tools: { surfaces: { mcp: count + 1 } }, headline_phrases: { ...ctx.phrases, deals: '9,999+' } }));
    expect(r.warns.join('\n')).toMatch(/tools\.surfaces\.mcp/);
    expect(r.warns.join('\n')).toMatch(/headline_phrases\.deals/);
  });
  it('an unreachable endpoint is unobserved, not drift', async () => {
    const r = await liveCompare(ctx, async () => { throw new Error('offline'); });
    expect(r.observed).toBe(false);
    expect(r.warns[0]).toMatch(/unreadable/);
  });
  it('--live never changes the exit code of a clean tree', () => { expect(run(['--live']).ok).toBe(true); });
});
