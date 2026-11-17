// plan-capacity-teaser.mjs -- execute_plan's Capacity Source copy is the teaser only (owner option A, 2026-11-16).
//
// WHY. mcp#1504 took the plan-level register offer out of execute_plan (answer_guide sentence and the
// capacity_register field), but the plan still promoted request_capacity_intro through its STEPS: every siting,
// grid or queue step carries a capacity_source block with `register_call` ("Registers this requirement (no slug)
// ..."), the envelope-once merge (lib/plan-provenance-once.mjs) lifts that block to the plan's top level, and a
// source_capacity step brings the backend's `register_interest` and "Register a requirement ..." note with it.
// Grok's colocation eval (2026-11-17) found register_call, request_capacity_intro and "registers this
// requirement" in 12 of 12 execute_plan answers, in block 0's JSON and in structuredContent.
//
// WHAT. On the finished plan object (before block 0 is stringified, so both copies match):
//   * keys register_call, register_interest and capacity_register go, wherever they sit (also a size-budget
//     total keyed "register_call.<path>");
//   * an object naming request_capacity_intro as its tool goes; so does that tool name in a list of names;
//   * a string loses each sentence that names request_capacity_intro or registering a requirement, and a string
//     that was nothing but such sentences becomes CAPACITY_TEASER_LINE;
//   * every capacity_source block carries `teaser: CAPACITY_TEASER_LINE` in place of its register call.
// The request_capacity_intro TOOL is untouched: only its promotion inside execute_plan goes. A one-link wall
// later swaps the teaser for its link-free form (server.mjs _oneLinkProse), as it does for answer_guide.
// DCHUB_CAPACITY_REGISTER_OFFER=1 (mcp#1504) restores the register offer, and this step stands aside with it.

import { CAPACITY_TEASER_LINE } from './capacity-source-summary.mjs';

const REGISTER_TOOLS = new Set(['request_capacity_intro', 'request_listing_intro']);
// Register language: the tool's name (and its 2026-09-11 alias), or registering a requirement in words.
export const PLAN_REGISTER_RE = /request_capacity_intro|request_listing_intro|\bregist(?:er|ers|ering|ered|ration)\b[^.;:]{0,40}\brequirements?\b|\bregister_(?:call|interest)\b/i;
const DROP_KEY_RE = /^(?:register_call|register_interest|capacity_register)$|(?:^|\.)register_call(?:\.|\[|$)/;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function scrubString(s) {
  if (!PLAN_REGISTER_RE.test(s)) return s;
  const parts = s.split(/(?<=[.!?])\s+/);
  const kept = parts.filter((p) => !PLAN_REGISTER_RE.test(p));
  // Nothing left (or a match that spans a sentence break, so no single sentence carries it): the teaser alone.
  if (!kept.length || kept.length === parts.length) return CAPACITY_TEASER_LINE;
  // The register sentences give way to the teaser, once.
  const rest = kept.join(' ');
  return rest.includes(CAPACITY_TEASER_LINE) ? rest : `${rest} ${CAPACITY_TEASER_LINE}`;
}

function namesRegisterTool(v) {
  return isObj(v) && ['tool', 'mcp_tool', 'name'].some((k) => typeof v[k] === 'string' && REGISTER_TOOLS.has(v[k]));
}

function scrub(v, key, depth) {
  if (depth > 24) return v;
  if (typeof v === 'string') return scrubString(v);
  if (Array.isArray(v)) {
    const out = [];
    for (const x of v) {
      if (typeof x === 'string' && REGISTER_TOOLS.has(x.trim())) continue;
      if (namesRegisterTool(x)) continue;
      out.push(scrub(x, key, depth + 1));
    }
    return out;
  }
  if (!isObj(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (DROP_KEY_RE.test(k)) continue;
    if (namesRegisterTool(x)) continue;
    out[k] = scrub(x, k, depth + 1);
  }
  if (key === 'capacity_source') out.teaser = CAPACITY_TEASER_LINE;
  return out;
}

export function planCapacityTeaserOn(env = process.env) {
  return !/^(1|on|true|yes)$/i.test(String((env && env.DCHUB_CAPACITY_REGISTER_OFFER) || '').trim());
}

/** The plan object with every register call and register sentence replaced by the teaser. Pure; never throws. */
export function planCapacityTeaserOnly(plan, env = process.env) {
  try {
    if (!isObj(plan) || !planCapacityTeaserOn(env)) return plan;
    return scrub(plan, '', 0);
  } catch (_e) { return plan; }
}

/** Every place an execute_plan result still carries register language (test and QA helper). */
export function planRegisterLanguage(result) {
  const hits = [];
  const walk = (v, p, depth) => {
    if (depth > 30) return;
    if (typeof v === 'string') { const m = PLAN_REGISTER_RE.exec(v); if (m) hits.push(`${p}: ${m[0]}`); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`, depth + 1)); return; }
    if (!isObj(v)) return;
    for (const [k, x] of Object.entries(v)) {
      if (PLAN_REGISTER_RE.test(k)) hits.push(`${p}.${k}: (key)`);
      walk(x, `${p}.${k}`, depth + 1);
    }
  };
  walk(result, '', 0);
  return hits;
}
