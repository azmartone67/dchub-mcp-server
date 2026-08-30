// ── every argument a handler READS must be an argument the schema DECLARES ──
//
// THE DEFECT (found 2026-08-30, on the flagship grid tool)
// `get_grid_intelligence` read `a.market` on its first line:
//
//     const raw = (a.region_id || a.iso || a.region || a.market || '')…
//
// but `market` was never a declared property. The MCP SDK's zod parse STRIPS
// undeclared arguments before the handler runs, so that clause could never be
// non-empty. Measured live against production the same day:
//
//     {market:"PJM"}       -> "region required"   (NOT the PJM brief)
//     {market:"Karaburun"} -> "region required"   (NOT "region not covered")
//     {}                   -> "region required"   (byte-identical)
//
// A read that can never see a value is indistinguishable from a read that is
// not there — and it reads as coverage. Two handoffs in a row recorded
// "get_grid_intelligence {market:'Ashburn'} needs a DB-backed market->state
// lookup" as the blocker. It was not the blocker: the argument never arrived.
// The lookup was already public and keyless at /api/v1/dcpi/scores/<slug>.
//
// This file guards the CLASS, not that one line. `market` is now declared and
// resolved; the same shape can reappear on any of the 83 tools the moment
// someone adds a read without adding the property.
//
// ★ THIS TEST MUST NOT BE ABLE TO PASS VACUOUSLY. It parses server.mjs, and a
// parser that silently stops matching would report "0 violations" — the exact
// failure mode it exists to prevent. `parses server.mjs the way this guard
// assumes` below pins the parse itself: registration count, uniform arity, and
// a known tool's known properties. Break the parser and that test reds first.
//
// ★ Comments and string bodies are BLANKED before the declared/read scan.
// Without that, three separate false positives appeared while this was being
// written: a block bounded at the next registration swallowed 1,590 lines of
// prompt definitions that also use `(a) => …`; a comment above one schema was
// read as schema keys; and prose inside describe() matched an argument name.
// The structural assertions lower down strip comments but KEEP strings, so a
// hint's wording is checked against the hint and never against the comment
// that explains it — this repo has shipped a denylist that matched its own
// docstring before.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARG_ALIASES } from '../server.mjs';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');
const SRC = fs.readFileSync(SERVER, 'utf8');

// Same-length rewrite of `src`. Comments always blanked. When `strings` is
// true, string/regex bodies are blanked too — template-literal ${…}
// interpolations are always kept, because those hold real code.
function blank(src, { strings }) {
  const out = src.split(''); const n = src.length;
  let i = 0, prev = '';
  const wipe = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < n) {
    const c = src[i]; const two = src.slice(i, i + 2);
    if (two === '//') { let j = src.indexOf('\n', i); if (j < 0) j = n; wipe(i, j); i = j; continue; }
    if (two === '/*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; wipe(i, j); i = j; continue; }
    if (c === '"' || c === "'") {
      const q = c; const s = i; i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        if (src[i] === '\n') break;
        i++;
      }
      if (strings) wipe(s + 1, i - 1);
      prev = 'x'; continue;
    }
    if (c === '`') {
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; break; }
        if (src.slice(i, i + 2) === '${') {           // keep interpolated code
          let d = 1; i += 2;
          while (i < n && d) { if (src[i] === '{') d++; else if (src[i] === '}') d--; i++; }
          continue;
        }
        if (strings && src[i] !== '\n') out[i] = ' ';
        i++;
      }
      prev = 'x'; continue;
    }
    if (c === '/' && prev !== 'x' && prev !== ')' && prev !== ']') {
      const s = i; i++; let incls = false;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') incls = true;
        else if (src[i] === ']') incls = false;
        else if (src[i] === '/' && !incls) { i++; break; }
        else if (src[i] === '\n') break;
        i++;
      }
      while (i < n && 'gimsuyd'.includes(src[i])) i++;
      if (strings) wipe(s + 1, i);
      prev = 'x'; continue;
    }
    if (!/\s/.test(c)) prev = /[A-Za-z0-9_$]/.test(c) ? 'x' : c;
    i++;
  }
  return out.join('');
}

// Top-level argument spans of the call whose '(' is at `open`. Operates on
// already-blanked source, so delimiters inside strings/comments cannot confuse it.
function topArgs(code, open) {
  const out = []; let i = open + 1, depth = 1, start = i;
  while (i < code.length) {
    const c = code[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { depth--; if (depth === 0) { out.push([start, i]); return out; } }
    else if (c === ',' && depth === 1) { out.push([start, i]); start = i + 1; }
    i++;
  }
  return out;
}

const CODE = blank(SRC, { strings: true });     // structure only
const NOCOMMENT = blank(SRC, { strings: false }); // structure + real string text

// Names are read from the comments-only rewrite (tool names live in string
// literals, which the structural rewrite blanks); spans are measured on the
// structural one. Both rewrites preserve length, so the offsets agree.
function registrations(named, structural) {
  const re = /trackedTool\(\s*srv\s*,\s*'([a-z_0-9]+)'/g;
  const found = []; let m;
  while ((m = re.exec(named))) {
    const open = structural.indexOf('(', m.index);
    found.push({ name: m[1], args: topArgs(structural, open) });
  }
  return found;
}

// Declared property names = depth-1 keys of the schema object literal (arg 4).
function declaredProps(code, [a, b]) {
  const s = code.slice(a, b); const props = new Set(); let depth = 0, i = 0;
  while (i < s.length) {
    const c = s[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 1 && (i === 0 || '{,\n \t'.includes(s[i - 1]))) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(s.slice(i));
      if (m) { props.add(m[1]); i += m[0].length; continue; }
    }
    i++;
  }
  return props;
}

// Arguments the handler (arg 5) actually reads off its parameter.
function readArgs(code, [a, b]) {
  const h = code.slice(a, b);
  const pm = /^\s*(?:async\s*)?\(\s*([A-Za-z_$][A-Za-z0-9_$]*)?\s*\)/.exec(h);
  const p = pm && pm[1];
  if (!p) return { param: null, reads: new Set() };
  const re = new RegExp(`\\b${p}\\.([A-Za-z_][A-Za-z0-9_]*)`, 'g');
  const reads = new Set(); let m;
  while ((m = re.exec(h))) reads.add(m[1]);
  return { param: p, reads };
}

const TOOLS = registrations(NOCOMMENT, CODE);

describe('parses server.mjs the way this guard assumes', () => {
  // Without these, a parser that stopped matching would report zero
  // violations and read as a clean bill of health.
  it('finds the tool registrations', () => {
    expect(TOOLS.length).toBeGreaterThan(60);
  });

  it('every registration is trackedTool(srv, name, description, schema, handler)', () => {
    for (const t of TOOLS) {
      expect(t.args.length, `${t.name}: unexpected arity ${t.args.length}`).toBe(5);
    }
  });

  it('actually extracts properties and reads (not empty sets)', () => {
    const gi = TOOLS.find(t => t.name === 'get_grid_intelligence');
    expect(gi, 'get_grid_intelligence registration not found').toBeTruthy();
    const props = declaredProps(CODE, gi.args[3]);
    // region_id is the tool's oldest argument; if the parser cannot see it,
    // it cannot see anything, and every result below is meaningless.
    expect([...props]).toContain('region_id');
    const { param, reads } = readArgs(CODE, gi.args[4]);
    expect(param).toBeTruthy();
    expect(reads.size).toBeGreaterThan(0);
  });
});

describe('no handler reads an argument its schema does not declare', () => {
  it('every read argument is a declared property', () => {
    const offenders = [];
    for (const t of TOOLS) {
      const props = declaredProps(CODE, t.args[3]);
      const { param, reads } = readArgs(CODE, t.args[4]);
      if (!param) continue;                       // handler takes no arguments
      const undeclared = [...reads].filter(r => !props.has(r));
      if (undeclared.length) offenders.push(`${t.name}: reads ${undeclared.join(', ')} — declared: ${[...props].join(', ') || '(none)'}`);
    }
    // Zod strips undeclared arguments before the handler, so each of these is
    // either dead code that reads as coverage, or an argument callers are
    // being invited to send that will be silently discarded.
    expect(offenders, `handlers reading undeclared arguments:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});

describe('get_grid_intelligence: market is declared AND resolved, never aliased', () => {
  const gi = () => TOOLS.find(t => t.name === 'get_grid_intelligence');

  it('declares market as a real property', () => {
    expect([...declaredProps(CODE, gi().args[3])]).toContain('market');
  });

  it('does NOT route market through ARG_ALIASES', () => {
    // A rename would answer "Ashburn" as if it were a grid code. The value has
    // to be RESOLVED. test/arg-aliases.test.mjs owns this rule; this asserts
    // the two halves stayed consistent — declared here, not aliased there.
    expect(ARG_ALIASES).not.toHaveProperty('get_grid_intelligence');
  });

  it('resolves the market value against the DCPI market row', () => {
    const [a, b] = gi().args[4];
    const handler = NOCOMMENT.slice(a, b);
    // Must be a CALL to the market row, not a mention of the path — a
    // hardcoded market->ISO map with the URL left in a string nearby would
    // otherwise read as a real lookup.
    expect(handler, 'market must be resolved by CALLING the published DCPI market row')
      .toMatch(/callAPI\(\s*`\/api\/v1\/dcpi\/scores\//);
  });

  it('never answers a resolved market silently', () => {
    // The caller asked about a market and is handed ISO-level figures. If the
    // payload does not say so, that is a silently different answer.
    //
    // ★ This assertion started as toContain('resolved_from') and a mutation
    // proved it VACUOUS: replacing the attachment with `void resolved_from;`
    // left the name in the declaration and the test stayed green. Presence of
    // a name is not wiring. What matters is that the value is BOUND ONTO the
    // object that is returned, and bound BEFORE that return.
    const [a, b] = gi().args[4];
    const handler = NOCOMMENT.slice(a, b);
    const bind = handler.search(/\bout\.resolved_from\s*=\s*resolved_from\b/);
    expect(bind, 'resolved_from is never attached to the returned object').toBeGreaterThan(-1);
    // The LAST withFreshness return is the success path. The first is the
    // PJM-DOM early return, which legitimately precedes the binding —
    // anchoring on it would fail an entirely correct handler.
    const rets = [...handler.matchAll(/return withFreshness\(/g)].map(m => m.index);
    expect(rets.length, 'success return not found').toBeGreaterThan(0);
    expect(bind, 'resolved_from is attached after the payload is returned')
      .toBeLessThan(rets[rets.length - 1]);
  });
});

describe('both refusal branches offer the same recovery', () => {
  // #248 taught the "region not covered" branch about EIA balancing
  // authorities and left the "region required" branch behind — so the caller
  // who supplied NOTHING was given a narrower list than the one who supplied
  // something wrong. 40+ BAs resolve (AZPS returns live Phoenix fuel mix) and
  // none of them appear in the 7-ISO list.
  const handler = () => {
    const gi = TOOLS.find(t => t.name === 'get_grid_intelligence');
    const [a, b] = gi.args[4];
    return NOCOMMENT.slice(a, b);      // comments stripped, hint text intact
  };

  it('every valid_regions list holds exactly the 7 ISOs its hint promises', () => {
    const lists = [...handler().matchAll(/valid_regions:\s*\[([^\]]*)\]/g)]
      .map(m => m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean));
    expect(lists.length, 'expected both refusal branches to list valid regions').toBe(2);
    for (const l of lists) {
      // PJM-DOM is a PJM sub-zone, not an ISO. Listing it made the array
      // length 8 under a hint that says 7 — a contradiction inside one
      // object — and it is currently source_unavailable, so recommending it
      // sends the caller to an empty payload.
      expect(l).not.toContain('PJM-DOM');
      expect(l).toEqual(['PJM', 'ERCOT', 'CAISO', 'MISO', 'SPP', 'NYISO', 'ISO-NE']);
    }
  });

  it('both hints name balancing authorities, not just the 7 ISOs', () => {
    const hints = [...handler().matchAll(/hint:\s*'([^']*)'/g)].map(m => m[1]);
    expect(hints.length).toBeGreaterThanOrEqual(2);
    const recovery = hints.filter(h => h.includes('7 live US ISOs'));
    expect(recovery.length, 'expected both refusal hints to reference the ISO list').toBe(2);
    for (const h of recovery) {
      expect(h, `hint omits balancing authorities: ${h}`).toMatch(/balancing[- ]authority/i);
    }
  });
});
