// No PUBLIC description string carries an internal directive (finding #116292,
// MCP Collection, 2026-10-15).
//
// WHAT HAPPENED. The About text of the DC Hub listing on mcpcollection.com ended
// with two lines that were never copy:
//     "Canon prices: $10 pack, $49 Developer, $99 Pro. Do not print exact
//      facility counts."
// They are the submitting agent's own brief. The listing was created through
// POST https://mcpcollection.com/api/submit (listed_at 2026-10-14T16:38:19Z), and
// the whole brief went into the `description` field. Nothing in this repo, the
// backend or the frontend contains the line (grep + `git log -S` on all three,
// 2026-10-15), so there was no file to edit. What a repo can do is refuse to
// BE the source of such a line, and make the next one fail loudly here:
//
//   1. scripts/listing-copy.mjs now carries INTERNAL_DIRECTIVE_RULES inside
//      COPY_RULES, so canonical/listing-copy.json (the file every directory
//      listing is pasted from) and every read-back that runs copyRuleViolations()
//      see them.
//   2. THIS test sweeps every public description string in the repo (manifests,
//      registry descriptions, the listing-copy variants, paste files, the README
//      introduction) with those rules.
//
// WHAT IS A PUBLIC DESCRIPTION STRING. Text a directory or registry shows a
// person as "what this is": the `description` / `long_description` /
// `short_description` / `tagline` / `title` / `displayName` of a manifest, every
// text field of the listing copy and of the registry description template, the
// paste files, and the README introduction. They describe DC Hub in the third
// person and name no internal process.
//
// WHAT IS NOT. Text addressed to an agent on purpose: the MCP initialize
// `instructions`, llms.txt, the skill files, GEMINI.md and the tool descriptions
// (tools/list). Those say "MUST CALL", "Do not invent withheld numbers" and the
// like because that is their job, and the directory-shown profiles of them are
// scrubbed on their own path (lib/chatgpt-directory.mjs, lib/core-profile.mjs).
// AGENT_SURFACES below names each one and why; a surface that stops carrying a
// marker is a DEAD entry and fails, so the list cannot rot into folklore.
//
// HARD GATE (test/hard-gate.txt): qualifies because it is offline and reads
// committed files only.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  INTERNAL_DIRECTIVE_RULES, COPY_RULES, internalDirectiveViolations, copyRuleViolations,
} from '../scripts/listing-copy.mjs';

const ROOT = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const tracked = () => execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean);

// ── The corpus ──────────────────────────────────────────────────────────────
// Pure: takes the tracked file list and a reader, so the controls below can feed
// it a synthetic repo.
const DESCRIPTION_KEYS = ['description', 'long_description', 'short_description', 'tagline', 'summary', 'title', 'displayName'];
// Files where EVERY top-level string is public copy (not just the description keys).
const WHOLE_FILE_JSON = ['canonical/listing-copy.json', 'canonical/registry-description-template.json'];
const PASTE_FILES = ['canonical/github_description.txt', 'scripts/smithery_description.txt', 'scripts/claude_directory_listing.txt'];
const SKIP_JSON = /^(?:test|\.github)\/|(?:^|\/)node_modules\/|package-lock\.json$/;

export function publicDescriptionStrings(files, readFile) {
  const out = [];
  const add = (source, text) => {
    if (typeof text === 'string' && text.trim()) out.push({ source, text });
  };
  for (const f of files) {
    if (f.endsWith('.json') && !SKIP_JSON.test(f)) {
      let j;
      try { j = JSON.parse(readFile(f)); } catch { continue; }
      if (!j || typeof j !== 'object' || Array.isArray(j)) continue;
      const whole = WHOLE_FILE_JSON.includes(f);
      for (const [k, v] of Object.entries(j)) {
        if (typeof v !== 'string') continue;
        if (whole ? !/^[$_]/.test(k) && k !== 'updated_at' : DESCRIPTION_KEYS.includes(k)) add(`${f}#${k}`, v);
      }
    } else if (/\.ya?ml$/.test(f) && !/^(?:test|\.github)\//.test(f)) {
      const lines = readFile(f).split('\n');
      for (const k of ['description', 'displayName', 'display_name']) {
        const at = lines.findIndex((l) => l.startsWith(`${k}:`));
        if (at < 0) continue;
        let v = lines[at].slice(k.length + 1).trim();
        if (/^[>|][-+]?$/.test(v)) {
          // A top-level block scalar: the indented lines that follow.
          const body = [];
          for (let i = at + 1; i < lines.length && /^[ \t]+\S|^\s*$/.test(lines[i]); i++) body.push(lines[i].trim());
          v = body.join(' ').trim();
        } else if (/^".*"$/.test(v)) {
          try { v = JSON.parse(v); } catch { v = v.slice(1, -1); }
        }
        add(`${f}#${k}`, v);
      }
    }
  }
  for (const f of PASTE_FILES) {
    if (!files.includes(f)) continue;
    add(f, readFile(f).split('\n').filter((l) => !l.startsWith('#')).join('\n'));
  }
  if (files.includes('README.md')) add('README.md#introduction', readFile('README.md').split(/^## /m)[0]);
  return out;
}

// ── The allow-list, and the dead-entry check ────────────────────────────────
// A public description string may carry a marker only when listed here, with the
// rule it is allowed to trip and the reason. Empty today: no public description
// needs one. Entries are { source, rule, reason }; `source` is a corpus label.
export const ALLOW = [];

// Surfaces addressed to an agent on purpose, left alone. `pick` returns the
// strings of that surface a marker is expected in.
export const AGENT_SURFACES = [
  { path: 'llms.txt', why: 'agent site map and usage guide served at /llms.txt (owner 2026-10-14: README only is neutral)', pick: (f) => [f] },
  { path: 'skill.md', why: 'Agent Skill: its text is the trigger and procedure an agent runtime loads', pick: (f) => [f] },
  { path: 'canonical/skill.md', why: 'source the Agent Skill copies are rendered from', pick: (f) => [f] },
  { path: 'GEMINI.md', why: 'Gemini CLI context file: addressed to the model by design', pick: (f) => [f] },
  {
    path: 'server.mjs',
    why: 'the MCP initialize `instructions` are composed here ("MUST CALL (FRONT DOOR)", "Do not invent withheld numbers"); an agent reads them, a directory page does not',
    pick: (f) => f.split('\n').filter((l) => l.includes('MUST CALL (FRONT DOOR)')),
  },
  {
    path: 'mcp-server.json',
    why: 'tools[].description is the tools/list copy ("THE FRONT DOOR: call this FIRST"); only the top-level description is public copy',
    pick: (f) => (JSON.parse(f).tools || []).map((t) => String(t.description || '')),
  },
];

const hits = (text) => internalDirectiveViolations(text);

/** Corpus strings that trip a rule and are not allowed. */
export function unallowedHits(corpus, allow = ALLOW) {
  const bad = [];
  for (const { source, text } of corpus) {
    for (const v of hits(text)) {
      if (!allow.some((a) => a.source === source && a.rule === v.rule)) {
        bad.push(`${source} [${v.rule}] "${v.match}" in: ${text.slice(Math.max(0, text.indexOf(v.match) - 50), text.indexOf(v.match) + v.match.length + 50).replace(/\s+/g, ' ')}`);
      }
    }
  }
  return bad;
}

/** Allow entries that no corpus string trips (dead), or whose source is gone. */
export function deadAllowEntries(corpus, allow = ALLOW) {
  return allow.filter((a) => {
    const row = corpus.find((c) => c.source === a.source);
    return !row || !hits(row.text).some((v) => v.rule === a.rule);
  }).map((a) => `${a.source} [${a.rule}]`);
}

/** Agent surfaces that are gone, or that no longer carry a marker (dead). */
export function deadSurfaces(files, readFile, surfaces = AGENT_SURFACES) {
  return surfaces.filter((s) => {
    if (!files.includes(s.path)) return true;
    try { return !s.pick(readFile(s.path)).some((t) => hits(t).length > 0); } catch { return true; }
  }).map((s) => s.path);
}

const FILES = tracked();
const CORPUS = publicDescriptionStrings(FILES, read);

// The exact text mcpcollection.com published (GET /api/servers.json, slug
// dc-hub-intelligence, 2026-10-15), kept verbatim as the must-fail control.
const LEAKED = 'DC Hub is the live data layer for data-center site selection. Its Data Center Power Index '
  + '(DCPI) scores where data centers can get grid power across 300+ markets daily. Also 330,000+ mapped '
  + 'power, grid, gas and fiber assets. 94 MCP tools at https://dchub.cloud/mcp plus a REST API. Free tier '
  + 'needs no key; paid plans: https://dchub.cloud/pricing. Canon prices: $10 pack, $49 Developer, $99 Pro. '
  + 'Do not print exact facility counts.';

describe('the corpus is real (non-vacuity)', () => {
  const labels = CORPUS.map((c) => c.source);

  it('reaches the manifests, the registry description, the listing copy, the paste files and the README', () => {
    for (const must of ['server.json#description', 'mcp-server.json#description', 'smithery.yaml#description',
      'package.json#description', 'gemini-extension.json#description', 'dxt/manifest.json#description',
      'canonical/listing-copy.json#long', 'canonical/listing-copy.json#glama_400', 'canonical/listing-copy.json#tagline',
      'canonical/listing.json#long_description', 'canonical/registry-description-template.json#server_json',
      'canonical/github_description.txt', 'scripts/smithery_description.txt', 'README.md#introduction']) {
      expect(labels, must).toContain(must);
    }
    expect(CORPUS.length).toBeGreaterThan(30);
  });

  it('every string is real prose, not an empty or one-word value', () => {
    for (const { source, text } of CORPUS) expect(text.trim().length, source).toBeGreaterThan(5);
  });

  it('the YAML read returns the committed description, not a fragment', () => {
    const y = CORPUS.find((c) => c.source === 'smithery.yaml#description');
    expect(y.text.length).toBeGreaterThan(400);
    expect(y.text).toMatch(/^Data Center Power Index \(DCPI\)/);
  });
});

describe('no public description string carries an internal directive', () => {
  it('none does (only the ALLOW entries may)', () => {
    expect(unallowedHits(CORPUS)).toEqual([]);
  });

  it('a manifest added tomorrow is swept too: every tracked JSON with a description key is in the corpus', () => {
    const missing = [];
    for (const f of FILES.filter((x) => x.endsWith('.json') && !SKIP_JSON.test(x))) {
      let j;
      try { j = JSON.parse(read(f)); } catch { continue; }
      if (!j || typeof j !== 'object' || Array.isArray(j)) continue;
      for (const k of DESCRIPTION_KEYS) {
        if (typeof j[k] === 'string' && j[k].trim() && !CORPUS.some((c) => c.source === `${f}#${k}`)) missing.push(`${f}#${k}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('the listing-copy rules include the internal-directive rules, so every consumer of copyRuleViolations() sees them', () => {
    for (const [id] of INTERNAL_DIRECTIVE_RULES) expect(COPY_RULES.map((r) => r[0])).toContain(id);
    expect(INTERNAL_DIRECTIVE_RULES.length).toBeGreaterThanOrEqual(4);
  });
});

describe('what was left alone, and why', () => {
  it('every agent-addressed surface exists and still carries a marker (no dead entry)', () => {
    expect(deadSurfaces(FILES, read)).toEqual([]);
  });

  it('every entry gives a reason', () => {
    for (const s of AGENT_SURFACES) expect(s.why.length, s.path).toBeGreaterThan(20);
  });

  it('the allow-list has no dead entry', () => {
    expect(deadAllowEntries(CORPUS)).toEqual([]);
  });

  it('mcp-server.json: the top-level description is clean while tools[] is not (the split is real)', () => {
    const top = CORPUS.find((c) => c.source === 'mcp-server.json#description');
    expect(hits(top.text)).toEqual([]);
    const tools = JSON.parse(read('mcp-server.json')).tools.map((t) => String(t.description || ''));
    expect(tools.some((t) => hits(t).length > 0)).toBe(true);
  });
});

describe('MUST-FAIL CONTROLS: the guard bites, the allow-list and dead-entry checks work', () => {
  it('the text MCP Collection published is flagged, by both internal rules', () => {
    const rules = hits(LEAKED).map((v) => v.rule).sort();
    expect(rules).toEqual(['internal_canon_label', 'internal_do_not']);
    // ...and copyRuleViolations (what a read-back runs) names the plan prices too.
    expect(copyRuleViolations(LEAKED).map((v) => v.rule).sort())
      .toEqual(['internal_canon_label', 'internal_do_not', 'plan_price', 'plan_price']);
  });

  it.each([
    ['internal_canon_label', 'Canon prices: $10 pack.'],
    ['internal_canon_label', 'canon rules are: no counts'],
    ['internal_do_not', 'Do not print exact facility counts.'],
    ['internal_do_not', "don't state a number here"],
    ['internal_do_not', 'Never mention the pack.'],
    ['internal_agent_contract', 'MUST CALL execute_plan first'],
    ['internal_agent_contract', 'THE FRONT DOOR for multi-capability questions'],
    ['internal_governance_ref', 'per the owner rule of 2026-09-27'],
    ['internal_governance_ref', 'withheld, see G-1014-33'],
  ])('%s is caught in %j', (rule, text) => {
    expect(hits(text).map((v) => v.rule)).toContain(rule);
  });

  it('ordinary description prose is not flagged', () => {
    for (const ok of [
      'DC Hub is the live data layer for data-center site selection. Paid plans: dchub.cloud/pricing.',
      'Canonical machine-readable surfaces: https://dchub.cloud/api/v1/canon/phrases',
      'A one-time pack of 1,000 API credits; the free tier needs no key.',
      'Data is never sold; do not rely on it for engineering design.',
      'Answers must be cited; the server must be reachable over HTTPS.',
    ]) expect(hits(ok), ok).toEqual([]);
  });

  it('a synthetic repo with the leaked line in server.json, a paste file and the README is caught three times', () => {
    const files = ['server.json', 'canonical/github_description.txt', 'README.md'];
    const fake = {
      'server.json': JSON.stringify({ description: LEAKED }),
      'canonical/github_description.txt': `# comment\n${LEAKED}\n`,
      'README.md': `# DC Hub\n\n${LEAKED}\n\n## Install\n`,
    };
    const corpus = publicDescriptionStrings(files, (f) => fake[f]);
    expect(corpus.map((c) => c.source)).toEqual(['server.json#description', 'canonical/github_description.txt', 'README.md#introduction']);
    const bad = unallowedHits(corpus);
    expect(bad.length).toBe(6); // two rules x three sources
    expect(new Set(bad.map((b) => b.split(' ')[0])).size).toBe(3);
  });

  it('an allow entry silences exactly its (source, rule) and nothing else', () => {
    const corpus = [{ source: 'server.json#description', text: LEAKED }];
    const allow = [{ source: 'server.json#description', rule: 'internal_do_not', reason: 'test' }];
    const left = unallowedHits(corpus, allow);
    expect(left.length).toBe(1);
    expect(left[0]).toContain('internal_canon_label');
  });

  it('a dead allow entry is reported: wrong source, or a rule the string does not trip', () => {
    const corpus = [{ source: 'a#description', text: 'DC Hub is a live data layer.' },
      { source: 'b#description', text: 'Do not print counts.' }];
    expect(deadAllowEntries(corpus, [
      { source: 'a#description', rule: 'internal_do_not', reason: 'x' },     // string is clean
      { source: 'missing#description', rule: 'internal_do_not', reason: 'x' }, // source gone
      { source: 'b#description', rule: 'internal_canon_label', reason: 'x' },  // wrong rule
      { source: 'b#description', rule: 'internal_do_not', reason: 'x' },      // live
    ])).toEqual(['a#description [internal_do_not]', 'missing#description [internal_do_not]', 'b#description [internal_canon_label]']);
  });

  it('a dead agent surface is reported: file gone, or no marker left in it', () => {
    const files = ['x.md', 'y.md'];
    const fake = { 'x.md': 'Call this tool. Do not invent numbers.', 'y.md': 'A plain description.' };
    const surfaces = [
      { path: 'x.md', why: 'live', pick: (f) => [f] },
      { path: 'y.md', why: 'dead: carries no marker', pick: (f) => [f] },
      { path: 'z.md', why: 'dead: not tracked', pick: (f) => [f] },
    ];
    expect(deadSurfaces(files, (f) => fake[f], surfaces)).toEqual(['y.md', 'z.md']);
  });
});
