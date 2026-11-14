// answer-shape.mjs -- data rows first, and a size budget per answer (Grok live agent review 2026-11-13, item 5).
//
// WHY. Claude, Grok and Mistral clients running DC Hub tools read the relay and upsell text before the data:
// structuredContent and block 0's JSON opened {"human_url", "agent_instruction", "count", "data", ...}
// (search_facilities, execute_plan; the relay chokepoint and the short-link step each put their keys first),
// and an answer could run to 100 KB (keyless execute_plan "rank markets for a 200 MW AI campus", measured
// 2026-11-13 against a local main build: 105,221 bytes, 48,963 of them the text copy). Claude Code rejects a
// tool result above roughly 25,000 tokens, and /mcp/claude already caps each copy at 40,000 characters
// (lib/claude-directory.mjs capJsonValue). This step does the same job on /mcp, at 30 KB per copy.
//
// WHAT IT DOES, on the finished /mcp result (server.mjs _sourceLineCb, the last step):
//   1. Data first. In structuredContent and in block 0's leading JSON, the relay / upsell keys
//      (RELAY_TAIL_KEYS) move after every other key, in the order listed. human_url keeps the FIRST slot
//      when it already has it: that is the owner's Wall-to-paid P1 (2026-10-23, lib/short-wall-link.mjs),
//      one short link, not prose. No key is added, dropped or edited; only the order moves.
//      Prose is NOT moved by default: the paywall contract's "Tell the user" sentence leads block 0 by owner
//      design (test/paywall-contract), and so does the returning-key nudge (test/retention-email-ask). With
//      DCHUB_DATA_FIRST_PROSE=1 (OWNER DECISION, default off) an ask paragraph (lib/lean-response.mjs ASK_PARA)
//      ahead of the JSON in its block moves after it, and a prose-only ask block ahead of the first JSON block
//      moves after that block.
//   2. Size budget, FREE AND ANONYMOUS CALLERS ONLY (owner 2026-11-14, OWNER DECISION 6: paid answers exempt).
//      A paid caller (Starter and up, Pro, a paid trial, admin / internal) gets every row, and so does a caller
//      whose tier is unknown: losing paid data is worse than a large free answer (server.mjs
//      _answerBudgetAppliesTo). When one copy (structuredContent, or block 0's JSON) is larger than the budget, its
//      biggest row array is cut to a prefix until it fits, and `size_cap` says which field, how many rows
//      are shown and how many there were. Rows are never reordered, edited or sampled. A container array
//      (execute_plan's `executed`, whose bytes are mostly the rows inside each step) is never cut whole:
//      the rows inside it are. Under the budget, or with no array to cut, the result passes untouched.
//      A size cut is not tier gating: it adds no wall marker, no relay link and no _upgrade.
//
// Wording is untouched: no plan, price, quota or gate changes here.
// SKIPPED (the caller decides): the directory / Claude / core profiles (their own scrub and cap; /mcp/chatgpt is
// frozen), a clean platform, execute_plan loopback steps (the plan's final answer is shaped once) and the key /
// account tools (LEAN_SKIP_TOOLS).
// Kill switches: DCHUB_DATA_FIRST=0 (key ordering), DCHUB_ANSWER_BUDGET_BYTES=0 (size; any positive number is
// the budget in bytes per copy, default 30000). Opt-in: DCHUB_DATA_FIRST_PROSE=1 (prose ordering, see above).

import { splitLeadingJson } from './facility-location.mjs';
import { ASK_PARA } from './lean-response.mjs';

export const ANSWER_BUDGET_DEFAULT_BYTES = 30_000;

// The relay / upsell keys, in the order they end the object. Everything else (data, provenance, citation,
// identity, next_call) keeps its own relative order ahead of them.
export const RELAY_TAIL_KEYS = Object.freeze([
  'next_ask', '_upgrade', 'upsell_deduped', 'free_key_unlock', 'email_ask',
  'for_your_human', 'agent_message', 'user_message', 'human_message', 'agent_instruction',
  '_claim_handoff_debug',
]);
const TAIL = new Set(RELAY_TAIL_KEYS);

export function dataFirstOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_DATA_FIRST) || '').trim());
}
export function dataFirstProseOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env.DCHUB_DATA_FIRST_PROSE) || '').trim());
}
export function answerBudgetBytes(env = process.env) {
  const raw = String((env && env.DCHUB_ANSWER_BUDGET_BYTES) || '').trim();
  if (!raw) return ANSWER_BUDGET_DEFAULT_BYTES;
  if (/^(0|false|no|off)$/i.test(raw)) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : ANSWER_BUDGET_DEFAULT_BYTES;
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const bytesOf = (v) => Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v), 'utf8');

// Pure. Returns the same object when the order is already data-first.
export function dataFirstObject(obj) {
  if (!isPlainObject(obj)) return obj;
  const keys = Object.keys(obj);
  if (!keys.some((k) => TAIL.has(k))) return obj;
  // human_url is not a tail key: a link, not prose, so it keeps the slot it has (first, after the short-link step).
  const body = keys.filter((k) => !TAIL.has(k));
  const tail = RELAY_TAIL_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(obj, k));
  const order = [...body, ...tail];
  if (order.every((k, i) => k === keys[i])) return obj;
  const out = {};
  for (const k of order) out[k] = obj[k];
  return out;
}

const isAskPara = (p) => !/^\s*[[{]/.test(p) && ASK_PARA.test(p);
const paras = (t) => String(t).split(/\n{2,}/);

// One text block: its leading JSON data-first, and ask paragraphs before that JSON moved after it.
function dataFirstBlockText(text, prose) {
  // JSON first (block 0's shape after lean): reorder its keys, keep the prose after it byte for byte.
  const sp = splitLeadingJson(text);
  if (sp && isPlainObject(sp.json)) {
    const j = dataFirstObject(sp.json);
    return j === sp.json ? text : sp.head + JSON.stringify(j) + sp.rest;
  }
  // Prose head, then JSON: move the head's ask paragraphs after the JSON (opt-in), the JSON reordered either way.
  const at = text.search(/\n\{/);
  if (at < 0) return text;
  const head = text.slice(0, at);
  const sp2 = splitLeadingJson(text.slice(at + 1));
  if (!sp2 || !isPlainObject(sp2.json)) return text;
  const hp = paras(head).filter((p) => p.trim());
  const asks = prose ? hp.filter(isAskPara) : [];
  const j = dataFirstObject(sp2.json);
  if (!asks.length && j === sp2.json) return text;
  if (!prose) return head + '\n' + JSON.stringify(j) + sp2.rest;
  const keptHead = hp.filter((p) => !isAskPara(p)).join('\n\n');
  const json = j === sp2.json ? text.slice(at + 1, text.length - sp2.rest.length) : JSON.stringify(j);
  const rest = sp2.rest.replace(/^\s+/, '');
  return [keptHead, json, rest, ...asks].filter((s) => s && s.trim()).join('\n\n');
}

const hasJson = (b) => b && b.type === 'text' && typeof b.text === 'string' && /(^|\n)\s*\{/.test(b.text);
const isAskOnlyBlock = (b) => b && b.type === 'text' && typeof b.text === 'string' && !/(^|\n)\s*[[{]/.test(b.text)
  && paras(b.text).filter((p) => p.trim()).every(isAskPara);

export function dataFirstResult(result, { prose = dataFirstProseOn() } = {}) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
  let changed = false;
  const out = { ...result };
  if (isPlainObject(result.structuredContent)) {
    const sc = dataFirstObject(result.structuredContent);
    if (sc !== result.structuredContent) { out.structuredContent = sc; changed = true; }
  }
  let content = result.content.map((b) => {
    if (!b || b.type !== 'text' || typeof b.text !== 'string') return b;
    const t = dataFirstBlockText(b.text, prose);
    if (t === b.text) return b;
    changed = true;
    return { ...b, text: t };
  });
  // A prose-only ask block ahead of the first JSON block moves to just after it.
  const firstJson = prose ? content.findIndex(hasJson) : -1;
  if (firstJson > 0) {
    const before = content.slice(0, firstJson);
    const moved = before.filter(isAskOnlyBlock);
    if (moved.length) {
      content = [...before.filter((b) => !moved.includes(b)), content[firstJson], ...moved, ...content.slice(firstJson + 1)];
      changed = true;
    }
  }
  if (!changed) return result;
  out.content = content;
  return out;
}

// ── size budget ─────────────────────────────────────────────────────────────────────────────────────────────
export const SIZE_CAP_NOTE = 'This answer was shortened to fit a response size budget: the first rows are shown. '
  + 'A narrower request (a market, state, ISO, limit or date range) returns the rest.';

export const SIZE_CAP_RELAY_NOTE = 'This answer was over its size budget, so the repeated unlock copy inside it '
  + 'was dropped; every data row is shown. The one unlock line is at the top level.';
// Nested relay / upsell prose keys dropped from an over-budget answer (never the top-level ones, never human_url).
const NESTED_DROP = new Set(RELAY_TAIL_KEYS.filter((k) => k !== 'upsell_deduped'));

// Every array instance with more than one element, with the bytes it holds and the bytes held by the
// arrays inside its OBJECT elements. A container (an array of objects whose bytes are mostly arrays inside
// them, like execute_plan's `executed`) is not cut whole: the rows inside it are.
const outerArrayBytes = (node) => (Array.isArray(node) ? bytesOf(node)
  : isPlainObject(node) ? Object.entries(node).reduce((a, [k, v]) => a + (k === 'size_cap' ? 0 : outerArrayBytes(v)), 0) : 0);
// A short list of large records (execute_plan's `executed`: one entry per step, each a whole tool answer) is
// not rows either: cutting it drops whole steps. Its rows are inside the records.
const RECORD_MIN_BYTES = 2_000, RECORD_MAX_LEN = 12;
const ROW_LIST_MIN_BYTES = 2_000, ROW_LIST_MIN_SHARE = 0.1;
const isRecordList = (a) => a.length <= RECORD_MAX_LEN && a.every(isPlainObject) && bytesOf(a) / a.length >= RECORD_MIN_BYTES;
function collectArrays(node, path, out) {
  if (Array.isArray(node)) {
    if (node.length > 1 && !isRecordList(node)) {
      out.push({ node, path, bytes: bytesOf(node),
        nested: node.reduce((a, x) => a + (isPlainObject(x) ? outerArrayBytes(x) : 0), 0) });
    }
    node.forEach((x, i) => collectArrays(x, `${path}[${i}]`, out));
  } else if (isPlainObject(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'size_cap') continue;
      collectArrays(v, path ? `${path}.${k}` : k, out);
    }
  }
}
// A path with its element indexes as [] (the field an agent can name in a narrower request).
const fieldOf = (p) => p.replace(/\[\d+\]/g, '[]');

// Returns { value, cut } where cut is null when nothing was cut; value is the input itself when it fits.
export function capToBudget(value, max) {
  if (!isPlainObject(value) || !(max > 0)) return { value, cut: null };
  let size = bytesOf(value);
  if (size <= max) return { value, cut: null };
  const clone = structuredClone(value);
  // Stage 1, no data lost: the relay / upsell prose nested inside the answer (each execute_plan step result
  // carries its own _upgrade, for_your_human, human_message, ...). The top-level copy, the one the relay
  // contract names, stays.
  let relayDropped = 0;
  const stripNested = (node, depth) => {
    if (Array.isArray(node)) { node.forEach((x) => stripNested(x, depth + 1)); return; }
    if (!isPlainObject(node)) return;
    for (const k of Object.keys(node)) {
      if (depth > 0 && NESTED_DROP.has(k)) { delete node[k]; relayDropped++; continue; }
      stripNested(node[k], depth + 1);
    }
  };
  stripNested(clone, 0);
  if (relayDropped) size = bytesOf(clone);
  const cuts = new Map();   // path -> { field, path, shown, of }
  const target = Math.floor(max * 0.9);   // room for the size_cap note itself
  for (let guard = 0; guard < 64 && size > (guard === 0 ? max : target); guard++) {
    const arrays = [];
    collectArrays(clone, '', arrays);
    // Only a list that holds a real share of the answer is cut: trimming a short metadata list (withheld field
    // names, preview reasons, a [lon, lat] pair) saves little and loses meaning. Nothing that big left: the answer stays over budget
    // and size_cap says by how much.
    const floor = Math.max(ROW_LIST_MIN_BYTES, Math.floor(size * ROW_LIST_MIN_SHARE));
    const rows = arrays.filter((a) => a.nested < a.bytes * 0.5 && a.bytes >= floor);
    if (!rows.length) break;
    rows.sort((a, b) => b.bytes - a.bytes);
    const top = rows[0];
    const excess = size - target;
    const want = Math.max(0, top.bytes - excess);
    let keep = Math.floor(top.node.length * (want / top.bytes));
    keep = Math.max(1, Math.min(keep, top.node.length - 1));
    const rec = cuts.get(top.path) || { field: fieldOf(top.path), path: top.path, shown: top.node.length, of: top.node.length };
    top.node.length = keep;
    rec.shown = keep;
    cuts.set(top.path, rec);
    size = bytesOf(clone);
  }
  if (!cuts.size && !relayDropped) return { value, cut: null };
  const cut = [...cuts.values()].map(({ field, path, shown, of }) => (field === path ? { field, shown, of } : { field, path, shown, of }));
  clone.size_cap = { note: cut.length ? SIZE_CAP_NOTE : SIZE_CAP_RELAY_NOTE, budget_bytes: max, cut,
    ...(relayDropped ? { nested_relay_copy_dropped: relayDropped } : {}),
    ...(size > max ? { over_budget_bytes: size } : {}) };
  return { value: clone, cut };
}

export function answerBudgetResult(result, max = answerBudgetBytes()) {
  if (!(max > 0) || !result || typeof result !== 'object' || result.isError === true || !Array.isArray(result.content)) return result;
  let changed = false;
  const out = { ...result };
  if (isPlainObject(result.structuredContent)) {
    const { value, cut } = capToBudget(result.structuredContent, max);
    if (cut) { out.structuredContent = value; changed = true; }
  }
  const b0 = result.content[0];
  if (b0 && b0.type === 'text' && typeof b0.text === 'string' && bytesOf(b0.text) > max) {
    const sp = splitLeadingJson(b0.text);
    if (sp && isPlainObject(sp.json)) {
      const { value, cut } = capToBudget(sp.json, max);
      if (cut) {
        out.content = [{ ...b0, text: sp.head + JSON.stringify(value) + sp.rest }, ...result.content.slice(1)];
        changed = true;
      }
    }
  }
  return changed ? out : result;
}

// The step server.mjs runs last on a /mcp result. Never fails a response.
// budget: false exempts the answer from the size budget (every row kept). server.mjs passes it from
// _answerBudgetAppliesTo: paid answers are exempt (owner 2026-11-14, OWNER DECISION 6), and so is any caller
// whose tier is unknown. The data-first order applies to every tier either way.
export function answerShapeStep(result, { skip = false, budget = true } = {}) {
  if (skip) return result;
  try {
    let r = result;
    if (dataFirstOn()) r = dataFirstResult(r);
    if (budget) r = answerBudgetResult(r);
    return r;
  } catch (_) { return result; }
}
