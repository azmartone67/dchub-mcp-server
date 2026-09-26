// claude-directory-catalog.test.mjs — r-claude-directory (2026-09-26)
//
// What a Claude Connectors Directory reviewer sees first on /mcp/claude: the
// initialize instructions and tools/list. Measured against the review criteria
// (claude.com/docs/connectors/building/review-criteria):
//   - instructions under 1,500 characters and free of steering;
//   - tools/list about the size of /mcp/chatgpt, not /mcp;
//   - annotations with ONLY title / readOnlyHint / destructiveHint /
//     idempotentHint / openWorldHint, every tool read-only;
//   - no withdrawn, commerce, key or write tool; plain descriptions with no
//     injection phrasing (INJECTION_PHRASES, built from the owner's examples).
// And what must NOT move: /mcp and /mcp/anthropic answer exactly what they did
// on origin/main (frz-claude-relay-wording), and /mcp/chatgpt too
// (frz-chatgpt-toolset; its own frozen test pins the catalog as well).
//
// Hard-gate qualified: real server on 127.0.0.1 against a local stub, no
// egress, and its only disk write is the git-ref sandbox under
// node_modules/.cache (test/helpers/repo-sandbox.mjs, the one allowed writer).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import {
  CLAUDE_TOOLS, CLAUDE_REMOVED, CLAUDE_WITHDRAWN, CLAUDE_INSTRUCTIONS, EXECUTE_PLAN_DESCRIPTION,
} from '../lib/claude-directory.mjs';
import { STANDARD_ANNOTATION_KEYS } from '../lib/chatgpt-directory.mjs';
import { startHarness, fenceNetwork, injectionHits, claudeProbePatterns, hitsOf } from './helpers/claude-directory-harness.mjs';
import { createGitRefSandbox } from './helpers/repo-sandbox.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = '/mcp/claude';
const PATTERNS = claudeProbePatterns(CLAUDE_REMOVED);
let H, fence, LIST, LIST_RAW, CANON;

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness();
  const r = await H.list(DIR);
  LIST_RAW = r.body;
  LIST = r.msg.result;
  CANON = (await H.list('/mcp')).msg.result.tools;
});
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
});

describe('initialize', () => {
  it('is stateless and advertises tools only, with the plain instructions', async () => {
    const r = await H.init(DIR);
    expect(r.status).toBe(200);
    expect(r.headers.get('mcp-session-id')).toBeNull();
    const res = r.msg.result;
    expect(res.instructions).toBe(CLAUDE_INSTRUCTIONS);
    expect(Object.keys(res.capabilities)).toEqual(['tools']);
    expect(res._meta).toBeUndefined();
    expect(hitsOf(PATTERNS, r.raw)).toEqual([]);
  });

  it('instructions: under 1,500 characters, no injection phrasing, say what DC Hub is and how to cite', () => {
    expect(CLAUDE_INSTRUCTIONS.length).toBeLessThan(1500);
    expect(injectionHits(CLAUDE_INSTRUCTIONS)).toEqual([]);
    expect(CLAUDE_INSTRUCTIONS).toMatch(/DC Hub/);
    expect(CLAUDE_INSTRUCTIONS).toMatch(/as_of/);
    expect(CLAUDE_INSTRUCTIONS).toMatch(/cit|attribut/i);
    // The /mcp instructions are the opposite case and stay as they are.
    expect(injectionHits(CLAUDE_INSTRUCTIONS)).toHaveLength(0);
  });

  it('CONTROL: /mcp still serves its own instructions (unchanged), which the phrase list does catch', async () => {
    const r = await H.init('/mcp');
    const instr = r.msg.result.instructions;
    expect(instr).not.toBe(CLAUDE_INSTRUCTIONS);
    expect(injectionHits(instr).length).toBeGreaterThan(0);
  });
});

describe('tools/list', () => {
  it('exactly the allowlist, in a ChatGPT-sized payload', () => {
    const names = LIST.tools.map((t) => t.name);
    expect(names).toEqual(Object.keys(CLAUDE_TOOLS));
    expect(names).toHaveLength(67);
    // /mcp/chatgpt measured 72,831 chars live and /mcp 473,081 (2026-09-26).
    expect(LIST_RAW.length).toBeLessThan(90_000);
    expect(LIST_RAW.length).toBeGreaterThan(40_000);
    expect(LIST._meta).toBeUndefined();
    expect(LIST.nextCursor).toBeUndefined();
  });

  it('every canonical /mcp tool is either listed or removed, and none is both', () => {
    const listed = new Set(Object.keys(CLAUDE_TOOLS));
    const removed = new Set(CLAUDE_REMOVED);
    for (const t of CANON) expect(listed.has(t.name) || removed.has(t.name), `${t.name} is neither listed nor removed`).toBe(true);
    for (const n of listed) expect(removed.has(n), n).toBe(false);
    expect(CANON.length).toBe(92);   // /mcp keeps all of its tools
  });

  it('only the five standard annotation keys; read-only and non-destructive; no _meta or outputSchema', () => {
    for (const t of LIST.tools) {
      expect(Object.keys(t.annotations).sort(), t.name).toEqual([...STANDARD_ANNOTATION_KEYS].sort());
      expect(t.annotations.readOnlyHint, t.name).toBe(true);
      expect(t.annotations.destructiveHint, t.name).toBe(false);
      expect(typeof t.annotations.title, t.name).toBe('string');
      expect(t._meta, t.name).toBeUndefined();
      expect(t.outputSchema, t.name).toBeUndefined();
      expect(t.name.length, t.name).toBeLessThanOrEqual(64);
    }
    // The canonical keys this profile must not carry are present on /mcp, so
    // the check above is not vacuous.
    const canonKeys = new Set(CANON.flatMap((t) => Object.keys(t.annotations || {})));
    for (const k of ['maturity', 'access']) expect(canonKeys.has(k), k).toBe(true);
  });

  it('no withdrawn tool: neither the named two nor any /mcp marks withdrawn', () => {
    const names = new Set(LIST.tools.map((t) => t.name));
    for (const n of CLAUDE_WITHDRAWN) expect(names.has(n), n).toBe(false);
    const withdrawn = CANON.filter((t) => t.annotations && t.annotations.withdrawn).map((t) => t.name);
    expect(withdrawn.length).toBeGreaterThan(0);   // non-vacuous: /mcp does mark some
    for (const n of withdrawn) expect(names.has(n), n).toBe(false);
  });

  it('no commerce, identity, key, alert or write tool is listed', () => {
    const names = new Set(LIST.tools.map((t) => t.name));
    for (const n of ['unlock_more_data', 'claim_free_key', 'bind_email', 'recover_my_key', 'why_dchub',
      'save_site', 'set_market_alert', 'set_site_alert', 'set_shortlist_alert', 'subscribe_digest',
      'register_standing_intent', 'delete_standing_intent', 'source_capacity', 'request_capacity_intro',
      'accept_capacity_terms', 'export_dataset']) expect(names.has(n), n).toBe(false);
    // Every tool /mcp itself marks non-read-only is off the profile.
    for (const t of CANON) {
      if (t.annotations && t.annotations.readOnlyHint === false) expect(names.has(t.name), t.name).toBe(false);
    }
  });

  it('descriptions, titles and every schema text: no injection phrasing, no commerce', () => {
    const offenders = [];
    const walk = (o, where) => {
      if (typeof o === 'string') {
        const h = injectionHits(o);
        if (h.length) offenders.push(`${where}: ${h.join(' ')} :: ${o.slice(0, 120)}`);
      } else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${where}.${k}`);
    };
    for (const t of LIST.tools) walk({ title: t.title, description: t.description, inputSchema: t.inputSchema }, t.name);
    expect(offenders).toEqual([]);
    expect(hitsOf(PATTERNS, LIST_RAW)).toEqual([]);
    // No payment, key or experiment parameters.
    for (const t of LIST.tools) {
      const props = Object.keys((t.inputSchema && t.inputSchema.properties) || {});
      expect(props.filter((k) => /^(mpp_|x402|payment|credential|api_?key|key$|cohort$)/i.test(k)), t.name).toEqual([]);
    }
  });

  it('CONTROL: the phrase list fires on the /mcp descriptions it exists for', () => {
    const ep = CANON.find((t) => t.name === 'execute_plan');
    expect(injectionHits(ep.description).length).toBeGreaterThan(0);
    const unlock = CANON.find((t) => t.name === 'unlock_more_data');
    expect(injectionHits(unlock.description).length).toBeGreaterThan(0);
  });

  it('execute_plan says what is done with intent and what is logged', () => {
    const ep = LIST.tools.find((t) => t.name === 'execute_plan');
    expect(ep.description).toBe(EXECUTE_PLAN_DESCRIPTION);
    expect(ep.description).toMatch(/rule-based planner \(no AI model\)/);
    expect(ep.description).toMatch(/Logging: the intent text is stored in DC Hub's usage log/);
    expect(ep.description).toMatch(/IP address and API key if one is used/);
    expect(ep.description).toMatch(/4,000 characters/);
    expect(ep.description).toMatch(/first 500\s+characters/);
    expect(ep.description).toMatch(/no automatic deletion/);
    expect(ep.inputSchema.properties.intent).toBeTruthy();
    expect(ep.inputSchema.properties.cohort).toBeUndefined();
  });
});

describe('prompts and resources', () => {
  it('list empty; other prompt/resource methods are not found', async () => {
    expect((await H.post(DIR, { jsonrpc: '2.0', id: 3, method: 'prompts/list' })).msg.result).toEqual({ prompts: [] });
    expect((await H.post(DIR, { jsonrpc: '2.0', id: 4, method: 'resources/list' })).msg.result).toEqual({ resources: [] });
    expect((await H.post(DIR, { jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'dchub://x' } })).msg.error.code).toBe(-32601);
  });
  it('GET and HEAD answer like the other registered paths (no 404)', async () => {
    const g = await H.get(DIR);
    const m = await H.get('/mcp/chatgpt');
    expect(g.status).toBe(m.status);
    const h = await fetch(`http://127.0.0.1:${H.PORT}${DIR}`, { method: 'HEAD' });
    const hm = await fetch(`http://127.0.0.1:${H.PORT}/mcp/chatgpt`, { method: 'HEAD' });
    expect(h.status).toBe(hm.status);
    expect(g.status).not.toBe(404);
  });
});

// ── /mcp, /mcp/anthropic and /mcp/chatgpt did not move ─────────────────────
// frz-claude-relay-wording: until the 2026-10-01 readout, everything /mcp
// serves stays byte-identical. This compares against origin/main's own server
// (a git-ref sandbox, same stub backend). After the readout /mcp may change on
// purpose, so the comparison retires itself on 2026-10-02.
const FREEZE_ENDS = Date.parse('2026-10-02T00:00:00Z');
describe('the frozen surfaces are unchanged against origin/main', () => {
  let SB = null, O = null, why = '';
  beforeAll(async () => {
    if (Date.now() >= FREEZE_ENDS) { why = 'freeze ended 2026-10-01'; return; }
    SB = createGitRefSandbox(REPO, 'origin/main', 'claude-origin-main');
    if (!SB) { why = 'origin/main is not available in this clone'; return; }
    O = await startHarness({ serverUrl: pathToFileURL(path.join(SB.root, 'server.mjs')).href });
  }, 120_000);
  afterAll(async () => {
    if (O) await O.stop();
    if (SB) SB.cleanup();
  });

  it('tools/list on /mcp, /mcp/anthropic and /mcp/chatgpt is byte-identical to origin/main', async () => {
    if (!O) { console.warn(`[claude-directory-catalog] origin/main comparison not run: ${why}`); return; }
    const req = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    for (const p of ['/mcp', '/mcp/anthropic', '/mcp/chatgpt']) {
      const mine = (await H.post(p, req)).body;
      const theirs = (await O.post(p, req)).body;
      expect(mine.length, p).toBe(theirs.length);
      expect(mine === theirs, `${p} tools/list differs from origin/main ${SB.sha.slice(0, 8)}`).toBe(true);
    }
  }, 120_000);

  it('initialize instructions on /mcp and /mcp/chatgpt are identical to origin/main', async () => {
    if (!O) return;
    for (const p of ['/mcp', '/mcp/chatgpt', '/mcp/anthropic']) {
      const a = (await H.init(p)).msg.result;
      const b = (await O.init(p)).msg.result;
      expect(a.instructions, p).toBe(b.instructions);
      expect(a.capabilities, p).toEqual(b.capabilities);
    }
  }, 60_000);
});

// ── The listing copy the owner pastes (scripts/claude_directory_listing.txt) ──
describe('listing copy', () => {
  const RAW = readFileSync(path.join(REPO, 'scripts', 'claude_directory_listing.txt'), 'utf8');
  const PASTED = RAW.split('\n').filter((l) => !l.startsWith('#')).join('\n');
  const section = (name) => {
    const m = new RegExp(`== ${name} ==\\n([\\s\\S]*?)(?=\\n== |$)`).exec(PASTED);
    return m ? m[1].trim() : '';
  };
  it('names the profile URL, the support contact, privacy policy and documentation', () => {
    expect(section('Server URL')).toBe('https://dchub.cloud/mcp/claude');
    expect(section('Support contact')).toBe('jonathan@dchub.cloud');
    expect(section('Privacy policy')).toMatch(/^https:\/\/dchub\.cloud\//);
    expect(section('Documentation')).toMatch(/^https:\/\/dchub\.cloud\//);
    expect(section('Name')).toBe('DC Hub');
  });
  it('lists exactly the profile tools and states the profile count', () => {
    const tools = section('Tools \\(67, all read-only\\)').split(/,\s*/).map((s) => s.trim()).filter(Boolean);
    expect(tools).toEqual(Object.keys(CLAUDE_TOOLS));
    expect(section('Long description')).toMatch(new RegExp(`\\b${Object.keys(CLAUDE_TOOLS).length} read-only tools\\b`));
  });
  it('at least three example prompts, canon quantities, no prices, no superlatives, no steering', () => {
    const prompts = section('Example prompts').split('\n').filter((l) => /^\d+\. /.test(l));
    expect(prompts.length).toBeGreaterThanOrEqual(3);
    const canon = JSON.parse(readFileSync(path.join(REPO, 'canonical', 'canon_phrases.json'), 'utf8'));
    expect(PASTED).toContain(`${canon.facilities} data-center facilities`);
    expect(PASTED).toContain(`${canon.markets} markets`);
    expect(PASTED).not.toMatch(/\$\s?\d|\bUSD\s?\d|per month|\/mo\b|\bpricing\b|\bprice\b|\bcheckout\b|\bpro\b|\btrial\b|\bfree\b/i);
    expect(PASTED).not.toMatch(/\b(best|leading|most comprehensive|world'?s|#1|unmatched|unrivall?ed|premier|ultimate|the only)\b/i);
    expect(injectionHits(PASTED.replace(/== Example prompts ==[\s\S]*?(?=\n== )/, ''))).toEqual([]);
    expect(PASTED).not.toMatch(/api_key=/);   // the URL-key channel stays out of the public copy
  });
});
