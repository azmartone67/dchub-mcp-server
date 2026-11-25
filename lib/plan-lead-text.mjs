// plan-lead-text.mjs -- execute_plan's first content block is a plain-language answer (Grok colocation review,
// 2026-11-17: "lead length" warned on 12 of 12 questions).
//
// WHY. Block 0 of an execute_plan answer was the whole plan as JSON, 30-45 KB keyless. The fact header
// (lib/plan-fact-header.mjs) put three lines in its FIRST KEY, but a host that shows the model or the person the
// first text block still opens on `{"fact_header":"SOURCE: ...` and a wall of JSON.
//
// WHAT. A short plain-language block goes in FRONT, at most PLAN_LEAD_MAX characters, never JSON: the answer's
// headline (intent_answer.headline, else the fact header's SUMMARY line), its as_of, the first piece of evidence
// when it fits, and where the rest is. The full JSON is unchanged and moves to block 1; structuredContent is
// unchanged. Every value is read from the plan's own result; nothing is looked up or invented, and the block
// carries no link (the one-link wall rule stays with the blocks that already carry the link).
//
// ★ CONTRACT CHANGE (deliberate). Until this, block 0 of execute_plan was JSON (test/block0-is-json-everywhere,
//   brain decision on mcp#1472: the fact header is a key, never a text prefix). For execute_plan only, block 0 is
//   now this lead and the JSON is block 1; JSON.parse on block 1, or structuredContent, reads the same object as
//   before. Every other tool keeps block 0 as JSON.
//
// Where it applies: the same surfaces as the fact header (not the directory / Claude / core profiles, not a clean
// platform, not a loopback step). `compact: false` on the call or DCHUB_PLAN_LEAD_TEXT=0 returns block 0 as JSON.

import { splitLeadingJson } from './facility-location.mjs';
import { factsFromExecuted } from './plan-step-facts.mjs';
import { priceNowDates } from './plan-fact-header.mjs';
import { spokenDay } from './cite-day.mjs';
import { sourcePointersOn, pointerSentences } from './source-pointers.mjs';

export const PLAN_LEAD_MAX = 600;
const POINTER = 'Full answer: the JSON in the next content block (also structuredContent), with every step, its replay and citations.';

export function planLeadTextOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_PLAN_LEAD_TEXT) || '').trim());
}

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const sentence = (s) => { const t = one(s); return t && !/[.!?]$/.test(t) ? t + '.' : t; };

function factLine(fh, label) {
  if (typeof fh !== 'string') return '';
  const line = fh.split('\n').find((l) => l.startsWith(label + ':'));
  return line ? one(line.slice(label.length + 1)) : '';
}

function asOfOf(plan) {
  const fh = plan.fact_header;
  const m = typeof fh === 'string' ? /AS_OF:\s*([0-9T:.+\-Z ]+?)(?:\s*\||\n|$)/.exec(fh) : null;
  if (m) return one(m[1]);
  const ia = isObj(plan.intent_answer) ? plan.intent_answer : null;
  if (ia && typeof ia.as_of === 'string') return one(ia.as_of);
  return '';
}

// Cut to `max` at a word boundary, ending on an ellipsis.
function fit(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, Math.max(0, max - 1));
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:]+$/, '') + '…';
}

// The facts every step returned, grouped by the place they are about (first two facts per place), one line each.
export function factLines(executed, max = PLAN_LEAD_MAX) {
  const facts = factsFromExecuted(executed, null);
  if (!facts.length) return '';
  const groups = new Map();
  for (const f of facts) {
    const k = String(f.entity || '').toLowerCase() || `#${f.tool}`;
    if (!groups.has(k)) groups.set(k, []);
    const g = groups.get(k);
    if (g.length < 2) g.push(f.text);
  }
  // Whole lines only, in step order; the first line always rides (planLeadText cuts it if it must).
  const lines = [...groups.values()].map((g) => g.join(' '));
  let out = lines[0];
  for (const l of lines.slice(1)) if (out.length + 1 + l.length <= max) out += ' ' + l;
  return out;
}

// The country-scope plan's honest coverage line (lib/country-scope.mjs), short: what is outside coverage and what
// is not held there. Read from geography_scope, else from the GEOGRAPHY sentence answer_guide always carries.
export function geographyScopeLine(plan) {
  const gs = isObj(plan.geography_scope) ? plan.geography_scope : null;
  let name = gs && typeof gs.name === 'string' ? one(gs.name) : '';
  let notCovered = gs && typeof gs.not_covered === 'string' ? one(gs.not_covered) : '';
  if (!name && typeof plan.answer_guide === 'string') {
    const m = /^GEOGRAPHY — (.+?) (?:is|are) outside DC Hub's US grid and queue coverage\b/.exec(plan.answer_guide);
    if (m) { name = one(m[1]); notCovered = notCovered || 'grid headroom, interconnection queues and time-to-power'; }
  }
  if (!name) return '';
  const are = / and /.test(name) ? 'are' : 'is';
  // 5.41 (Grok 2026-11-18 e8): a price question about non-US zones is told in one sentence that the prices are not
  // covered, before anything else.
  if (gs && gs.price_not_covered) {
    return `Day-ahead and wholesale power prices for ${name} are outside DC Hub's coverage: DC Hub serves wholesale prices for some US grids only, so this read holds no price for ${name}.`;
  }
  return `${name} ${are} outside DC Hub's US grid and queue coverage: ${notCovered || 'grid headroom, interconnection queues and time-to-power'} are not covered there.`;
}

// Grok spec item 7 (DCHUB_SOURCE_POINTERS_V1): which dated public source pointers ride in the lead. Named topics come
// first and may shorten the headline (never below 80 characters); a topic only a step put on the plan rides only when
// it fits beside the headline as it is. deadEnd: no headline and no figure, so the pointers ARE the lead.
function pickPointers(ptrs, { deadEnd, base, room }) {
  const chosen = [];
  let used = 0;
  for (const p of ptrs) {
    const add = p.text.length + (chosen.length || !deadEnd ? 1 : 0);
    const limit = p.named ? (deadEnd ? room : room - 80) : room - base;
    if (used + add <= limit || (!chosen.length && p.named)) { chosen.push(p.text); used += add; }
  }
  return chosen.join(' ');
}

/** The plain-language lead for a finished execute_plan object, or null. Pure; never throws. */
// True when the plan's only relay is the Deal Desk Brief (a report link) and no step came back as a preview.
export function reportLinkOnly(plan) {
  try {
    if (!plan || typeof plan !== 'object' || plan.human_message) return false;
    const f = plan.for_your_human;
    const url = f && typeof f === 'object' ? f.url : (typeof f === 'string' ? f : '');
    if (typeof url !== 'string' || !/^https:\/\/dchub\.cloud\/reports\/deal-desk\//.test(url)) return false;
    const ex = Array.isArray(plan.executed) ? plan.executed : [];
    return !ex.some((e) => e && (e.status === 'gated_preview' || e.gated === true));
  } catch (_e) { return false; }
}
export function planLeadText(plan, { env = process.env, pointers } = {}) {
  try {
    if (!isObj(plan) || plan._entity !== 'plan_execution') return null;
    const ia = isObj(plan.intent_answer) ? plan.intent_answer : null;
    const ra = isObj(plan.ranked_answer) ? plan.ranked_answer : null;
    const summary = factLine(plan.fact_header, 'SUMMARY');
    const entity = factLine(plan.fact_header, 'ENTITY');
    let head = sentence(ia && ia.headline) || sentence(ra && ra.headline);
    if (!head && summary) head = sentence(`DC Hub answer${entity ? ` for ${entity}` : ''}: ${summary}`);
    // No headline: the dated facts the steps returned, before the bare "ran N lookups" (Grok re-run 2026-11-17: the
    // Texas and Chicago fiber answers led with a lookup count while the payload held the figures asked for).
    // 5.34 (Grok dominance evals, gap 2): ONE LINE PER ENTITY. "TX vs VA price" led with Texas only, or with the
    // lookup count; every place a step read gets its own line, in step order, as many as fit.
    const scopeLine = geographyScopeLine(plan);
    // Grok midday re-run 2026-11-17, Q-c: the Source line stamped 2026-08-31 (one step's date) on a lead whose
    // figures each carry their own date, DCPI 2026-11-17 among them. A headline with dated facts is cited per figure.
    const dated = /\bas of \d{4}-\d{2}-\d{2}/.test(String((ia && ia.headline) || ''));
    // 5.48 (Grok daily 2026-11-19, item 5): an LMP-led price answer is dated by its interval; the retail month is context.
    const pn = priceNowDates(plan);
    const asOf = pn ? pn.asOf : dated ? '' : asOfOf(plan);
    // Owner 2026-11-18 (Grok 1118 item 3): the date is the OLDEST input's, so the line names that input.
    const om = asOf && !pn && typeof plan.fact_header === 'string' ? /\|\s*OLDEST_INPUT:\s*([^|\n]+)/.exec(plan.fact_header) : null;
    // 5.54: when AS_OF is a newer DCPI verdict's date, the oldest input's own date rides beside its name.
    const od = asOf && !pn && typeof plan.fact_header === 'string' ? /\|\s*OLDEST_INPUT_AS_OF:\s*([0-9T:.+\-Z]+)/.exec(plan.fact_header) : null;
    const oldest = om ? one(om[1]) : '';
    const oldestOn = od ? spokenDay(one(od[1])) || '' : '';
    const ob = od ? /\|\s*AS_OF_BASIS:\s*([^|\n]+)/.exec(plan.fact_header) : null;
    const basis = ob ? `${one(ob[1])}; ` : '';
    const oldestNote = oldest || oldestOn ? ` (${basis}oldest input${oldest ? `: ${oldest}` : ''}${oldestOn ? `, as of ${oldestOn}` : ''})` : '';
    // The lead is a sentence: every date in it prints as its America/Phoenix day (lib/cite-day.mjs), never a time or the
    // UTC date (Grok head-to-head 2026-11-23: a market_ranking lead read "as of 2026-11-23T04:00:00.000Z"). The
    // machine fields (fact_header AS_OF, intent_answer.as_of) keep the full stamp.
    const asOfShown = spokenDay(asOf) || asOf;
    const retailShown = pn && pn.retail ? spokenDay(pn.retail) || pn.retail : '';
    const source = `Source: DC Hub (dchub.cloud)${asOf ? `, as of ${asOfShown}${oldestNote}${retailShown ? ` (retail context as of ${retailShown})` : ''}` : dated ? ', each figure dated in the line' : ''}.`;
    // The Deal Desk Brief link is a report, not a wall: with no step returned as a preview and no other relay, nothing
    // was held back and the sentence is left out (live 2026-11-25, an enterprise plan with every step executed).
    const partial = ((plan.human_message || plan.for_your_human) && !reportLinkOnly(plan))
      ? 'Some steps came back as previews; the JSON names what was held back and the link to relay.' : '';
    const ev0 = ia && Array.isArray(ia.evidence) ? sentence(ia.evidence.find((x) => typeof x === 'string' && x.trim())) : '';
    // An evidence line that is the headline again is not printed twice (live 2026-11-25: a facility search's lead
    // read "50 of 229 matching rows shown ... 50 of 229 matching rows shown ...").
    const sameLine = (x, y) => !!x && !!y && String(x).replace(/\s+/g, ' ').trim() === String(y).replace(/\s+/g, ' ').trim();
    const ev = sameLine(ev0, head) ? '' : ev0;
    const tail = [source, partial, POINTER].filter(Boolean).join(' ');
    // The headline always fits (cut if it must); evidence rides only when the whole lead still fits.
    const room = PLAN_LEAD_MAX - tail.length - 1;
    if (!head) head = factLines(plan.executed, Math.max(80, room - (scopeLine ? scopeLine.length + 1 : 0)));
    // Grok spec item 7: a flood, broadband or water topic with no figure gets its dated public pointer (instead of
    // the dead-end line when nothing else came back); a held figure is followed by "Verify at <url>".
    const ptrs = sourcePointersOn(env)
      ? pointerSentences(plan, (Array.isArray(plan.facts) ? plan.facts : []).concat(factsFromExecuted(plan.executed, null)), { pointers })
      : [];
    let ptrText = '';
    if (ptrs.length) {
      const deadEnd = !head && !scopeLine;
      const base = deadEnd ? 0 : Math.min(room, (head ? head.length : 0) + (scopeLine ? scopeLine.length + 1 : 0));
      ptrText = pickPointers(ptrs, { deadEnd, base, room });
      if (deadEnd) { head = ptrText; ptrText = ''; }
    }
    if (!head && !scopeLine) {
      const n = Array.isArray(plan.executed) ? plan.executed.length : 0;
      const intent = one(plan.intent);
      // 5.39 (Grok cross-domain head-to-head): no lead starts "DC Hub ran N lookups"; it says where the figures are.
      const tools = [...new Set((Array.isArray(plan.executed) ? plan.executed : []).map((e) => e && e.tool).filter(Boolean))].slice(0, 4);
      head = sentence(`${intent ? `For "${fit(intent, 160)}": ` : ''}${n} lookup${n === 1 ? '' : 's'} ran${tools.length ? ` (${tools.join(', ')})` : ''}, and no figure in them could be summarised here; each step's status and figures are in the JSON`);
    }
    // 5.34 (gap 8): a plan outside the US leads with the honest scope line, then whatever the steps did return.
    if (scopeLine) head = head ? `${scopeLine} ${head}` : scopeLine;
    head = ptrText ? `${fit(head, Math.max(80, room - ptrText.length - 1))} ${ptrText}` : fit(head, Math.max(80, room));
    let text = `${head} ${tail}`;
    if (ev && text.length + ev.length + 1 <= PLAN_LEAD_MAX) text = `${head} ${ev} ${tail}`;
    return text.length <= PLAN_LEAD_MAX ? text : fit(text, PLAN_LEAD_MAX);
  } catch (_e) { return null; }
}

/**
 * The finished execute_plan result with the lead as block 0 and the JSON as block 1. Left alone when block 0 is
 * not the plan's JSON (an error, a wall that already leads with prose) or when skipped. Never throws.
 */
export function planLeadStep(result, { skip = false, compact = true, env = process.env } = {}) {
  try {
    if (skip || compact === false || !planLeadTextOn(env)) return result;
    if (!result || typeof result !== 'object' || result.isError || !Array.isArray(result.content)) return result;
    const b0 = result.content[0];
    if (!b0 || b0.type !== 'text' || typeof b0.text !== 'string') return result;
    const sp = splitLeadingJson(b0.text);
    const json = sp && isObj(sp.json) ? sp.json : null;
    const plan = isObj(result.structuredContent) && result.structuredContent._entity === 'plan_execution'
      ? result.structuredContent : json;
    if (!json || !plan) return result;
    const lead = planLeadText(plan, { env });
    if (!lead) return result;
    return { ...result, content: [{ type: 'text', text: lead }, ...result.content] };
  } catch (_e) { return result; }
}
