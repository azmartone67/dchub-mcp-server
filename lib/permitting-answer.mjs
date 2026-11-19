// permitting-answer.mjs -- planner 5.42: the permitting class (moratoriums, land-use / zoning restrictions,
// data-center bills) and its answer.
//
// WHY. Grok's LAND head-to-head (2026-11-18, L3 11/30 vs 24): "Which US states, counties or cities have data center
// moratoriums or restrictive land-use rules right now?" matched no class and ran discover_tools alone, while
// get_permitting_intel class=moratorium held 54 published records. get_permitting_intel was reached only as a tail
// step of site_analysis.
//
// WHAT.
//   * permittingAsk(text): 'strong' for a moratorium or a ban on data centers, 'weak' for zoning / land-use /
//     ordinance / bill wording that also names data centers, else null. An air-permit ask is never this class.
//   * permittingSequence(state): get_permitting_intel class=moratorium, class=legislation and class=zoning, one wave,
//     each held to the state when the question named one.
//   * buildPermittingAnswer: "N moratorium records on record (DC Hub permitting intel)" with up to five jurisdictions,
//     each with its stage and its date said as what it is (effective date, source date, or the date DC Hub last
//     updated the record), then the zoning count and the bill-status line. A bill feed that is not loaded is said as
//     not loaded, never as zero bills.
// Pure; nothing here throws.

import { publicFact } from './plan-step-facts.mjs';

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim()) ? v.trim().slice(0, 10) : null);
const fmt = (n) => n.toLocaleString('en-US');

const STRONG_RE = /\bmoratori(?:um|ums|a)\b|\bbans?\s+on\s+(?:new\s+)?data[\s-]*cent/i;
const WEAK_RE = /\bland[\s-]?use\b|\bzoning\b|\bordinances?\b|\bbills?\b|\blegislation\b|\bstatutes?\b/i;
const DC_RE = /\bdata[\s-]*cent(?:er|re)s?\b/i;
const AIR_RE = /\bair[\s-]?(?:quality\s+)?permit|\bnon-?attainment\b/i;

/** 'strong' | 'weak' | null for a permitting ask. */
export function permittingAsk(text) {
  const t = String(text || '').slice(0, 1000);
  if (AIR_RE.test(t)) return null;
  if (STRONG_RE.test(t)) return 'strong';
  if (WEAK_RE.test(t) && DC_RE.test(t)) return 'weak';
  return null;
}

export function permittingSequence(state) {
  const st = typeof state === 'string' && /^[A-Z]{2}$/.test(state) ? state : null;
  const where = st ? ` in ${st}` : ' across the US';
  const args = (cls) => (st ? { class: cls, state: st } : { class: cls });
  return [
    { step: 1, tool: 'get_permitting_intel', depends_on: [], estimated_calls: 1,
      why: `Published data-center moratorium records${where}: jurisdiction, stage (enacted, proposed, speculative), scope and source.`,
      args_hint: args('moratorium') },
    { step: 2, tool: 'get_permitting_intel', depends_on: [], estimated_calls: 1,
      why: `Data-center bill status${where}: stage, last and next action, effective date. Says plainly when the bill feed is not loaded.`,
      args_hint: args('legislation') },
    { step: 3, tool: 'get_permitting_intel', depends_on: [], estimated_calls: 1,
      why: `Published zoning restrictions on data centers${where}.`,
      args_hint: args('zoning') },
  ];
}

function parsed(v) {
  if (isObj(v)) return v;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return null;
}

// The date a record carries, said as what it is.
function recordDate(r) {
  const eff = day(r.effective_date);
  if (eff) return { d: eff, text: `effective ${eff}` };
  const src = day(r.as_of);
  if (src) return { d: src, text: `as of ${src}` };
  const up = day(r.updated_at);
  if (up) return { d: up, text: `record updated ${up}` };
  return { d: null, text: 'undated' };
}

function rowText(r) {
  const j = one(r.jurisdiction) || one(r.title) || 'an unnamed jurisdiction';
  const st = one(r.state);
  const stage = one(r.stage);
  return `${j}${st && !j.endsWith(`, ${st}`) ? `, ${st}` : ''} (${[stage, recordDate(r).text].filter(Boolean).join(', ')})`;
}

export const BILLS_NOT_LOADED = 'Data-center bill status is not loaded in DC Hub yet, so no bill is reported here; that is not a finding of zero bills.';

export function buildPermittingAnswer(ctx, executed, fullByEntry) {
  try {
    if (!ctx || ctx.intent_class !== 'permitting') return null;
    const by = {};
    for (const e of Array.isArray(executed) ? executed : []) {
      if (!e || e.tool !== 'get_permitting_intel' || !(e.status === 'executed' || e.status === 'gated_preview')) continue;
      const p = parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
      const cls = one((e.args && e.args.class) || (p && p.class) || '');
      if (p && cls && !by[cls]) by[cls] = { e, p };
    }
    const m = by.moratorium;
    if (!m) return null;
    const st = one((m.e.args && m.e.args.state) || '');
    const where = st ? ` in ${st}` : '';
    const facts = [];
    const ne = [];
    const rows = (Array.isArray(m.p.records) ? m.p.records : []).filter(isObj);
    const count = num(m.p.count) ?? rows.length;
    const ranked = rows.map((r, i) => ({ r, i, d: recordDate(r).d }))
      .sort((a, b) => (b.d || '').localeCompare(a.d || '') || a.i - b.i)
      .slice(0, 5).map((x) => x.r);
    const dates = rows.map((r) => recordDate(r).d).filter(Boolean).sort();
    const newest = dates.length ? dates[dates.length - 1] : null;
    let head;
    if (!count) {
      head = `No data-center moratorium is published in DC Hub's permitting records${where || ' for the US'}.`;
    } else {
      const shown = rows.length && rows.length < count ? ` (${rows.length} shown)` : '';
      const tally = {};
      for (const r of rows) { const s = one(r.stage) || 'unstaged'; tally[s] = (tally[s] || 0) + 1; }
      const stages = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${n} ${s}`).join(', ');
      head = `${fmt(count)} data-center moratorium record${count === 1 ? '' : 's'} on record${where}${shown}`
        + (stages ? `, ${rows.length < count ? 'of those shown ' : ''}${stages}` : '')
        + ` (DC Hub permitting intel)${ranked.length ? `. Most recent: ${ranked.map(rowText).join('; ')}` : ''}.`;
    }
    facts.push({ tool: 'get_permitting_intel', step: m.e.step, entity: st || 'US', as_of: newest, text: head });
    if (rows.length && rows.every((r) => !day(r.effective_date) && !day(r.as_of))) {
      ne.push('These moratorium records carry no effective date or source date; each is dated by when DC Hub last updated it.');
    }
    const z = by.zoning;
    if (z) {
      const zc = num(z.p.count) ?? (Array.isArray(z.p.records) ? z.p.records.length : null);
      if (zc != null) {
        facts.push({ tool: 'get_permitting_intel', step: z.e.step, entity: st || 'US', as_of: null,
          text: zc ? `${fmt(zc)} zoning-restriction record${zc === 1 ? '' : 's'} on record${where} (DC Hub permitting intel).`
            : `No zoning-restriction record is published${where || ' for the US'} in DC Hub's permitting intel.` });
      }
    }
    const l = by.legislation;
    let billLine = '';
    if (l) {
      if (l.p.loaded === false) { billLine = BILLS_NOT_LOADED; ne.push(BILLS_NOT_LOADED); }
      else {
        const bc = num(l.p.count) ?? (Array.isArray(l.p.bills) ? l.p.bills.length : null);
        const ld = day(l.p.as_of);
        if (bc != null) {
          billLine = `${fmt(bc)} data-center bill${bc === 1 ? '' : 's'} tracked${where} (Open States${ld ? `, as of ${ld}` : ''}).`;
          facts.push({ tool: 'get_permitting_intel', step: l.e.step, entity: st || 'US', as_of: ld, text: billLine });
        }
      }
    }
    const zLine = facts.length > 1 && facts[1].tool === 'get_permitting_intel' && z && facts[1].step === z.e.step ? facts[1].text : '';
    const headline = [head, zLine, billLine].filter(Boolean).join(' ');
    return { kind: 'permitting', requested_mw: null, geography: st || 'US', headline, verdict: null,
      evidence: facts.map((f) => f.text), not_established: ne, as_of: newest, relay: null,
      source: 'Source: DC Hub (dchub.cloud) permitting intel, each record dated in its own line.',
      facts: facts.map(publicFact) };
  } catch (_e) { return null; }
}
