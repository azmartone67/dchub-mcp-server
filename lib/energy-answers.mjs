// energy-answers.mjs -- planner 5.40: the intent_answer for price_now, gas_price and queue_withdrawals plans.
//
// WHY. Grok's energy head-to-head (2026-11-17 night, keyless, 132/240): the ERCOT "price right now" question led with
// "Generation queue 461.4 GW"; the Texas gas question led with "TX data-center pipeline: 1 project"; a PJM
// withdrawals question led with the active queue. Each lead named a figure, just not the one asked.
//
// WHAT. One answer per class, its lead the figure the question asked (or the plain statement that it is withheld or
// not served), every figure a dated fact in intent_answer.facts (the compact answer lists them first):
//   * buildPriceNowAnswer: the wholesale LMP when get_energy_prices carries one (wholesale_lmp.real_time), else the
//     EIA retail rate with its basis and "DC Hub serves EIA retail averages and the Henry Hub spot, not real-time
//     LMP", then the grid's live demand.
//   * buildGasPriceAnswer: the state gas price (or "withheld at this access level") and the DCGI verdict; never a
//     pipeline count first.
//   * buildQueueWithdrawalsAnswer: the withdrawn-request count by ISO (and state), or that DC Hub's queue tables hold
//     no withdrawn requests (its loaders keep the active queue), then the active queue it left.
// Pure; nothing here throws.

import { factsFromStep, stepAsOf, publicFact } from './plan-step-facts.mjs';
import { spokenTime } from './cite-day.mjs';

export const NOT_LMP_NOTE = 'DC Hub serves EIA retail averages and the Henry Hub spot, not real-time LMP.';
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(Math.round(n * 100) / 100));

function parsed(v) {
  if (isObj(v)) return v;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return null;
}
function readSteps(executed, fullByEntry) {
  const out = [];
  for (const e of Array.isArray(executed) ? executed : []) {
    if (!e || !(e.status === 'executed' || e.status === 'gated_preview')) continue;
    const p = parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
    if (p) out.push({ step: e.step, tool: e.tool, args: e.args || {}, p });
  }
  return out;
}
const tag = (f, s) => (f ? { ...f, step: s.step } : null);
function answer(kind, geography, headline, facts, notEstablished, evidence) {
  const dates = facts.map((f) => f.as_of).filter((x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
  return { kind, requested_mw: null, geography, headline, verdict: null, evidence: evidence || facts.map((f) => f.text),
    not_established: notEstablished, as_of: dates[0] || null, relay: null,
    source: 'Source: DC Hub (dchub.cloud), each figure dated in its own fact.', facts: facts.map(publicFact) };
}

// ---- price_now ----
const LOAD_RE = /\b(?:load|demand|consumption|usage)\b/i;
// wholesale_lmp (served per ISO by licence): real_time first, then day_ahead. Absent or null: no LMP figure.
export function lmpFact(s) {
  const w = isObj(s.p.wholesale_lmp) ? s.p.wholesale_lmp : null;
  if (!w) return null;
  const iso = one(w.iso || s.args.iso || '').toUpperCase();
  const hub = one(w.hub || '');
  const rt = isObj(w.real_time) ? w.real_time : null;
  const da = isObj(w.day_ahead) ? w.day_ahead : null;
  const src = one(w.source || '') || iso;
  if (rt && num(rt.lmp_usd_mwh) != null) {
    // The line says the Phoenix clock (lib/cite-day.mjs spokenTime); as_of keeps the machine day.
    const atRaw = one(rt.interval_ending || rt.as_of || '');
    const at = spokenTime(atRaw) || atRaw;
    return { tool: s.tool, step: s.step, entity: [iso, hub].filter(Boolean).join(' '), as_of: day(rt.as_of || rt.interval_ending),
      text: `${iso}${hub ? ` ${hub}` : ''} real-time LMP: $${fmt(num(rt.lmp_usd_mwh))}/MWh${at ? ` (interval ending ${at}` : ' ('}${at ? '; ' : ''}${src}${rt.stale ? '; stale' : ''}).` };
  }
  if (da && num(da.lmp_usd_mwh) != null) {
    return { tool: s.tool, step: s.step, entity: [iso, hub].filter(Boolean).join(' '), as_of: day(da.as_of || da.delivery_date),
      text: `${iso}${hub ? ` ${hub}` : ''} day-ahead LMP: $${fmt(num(da.lmp_usd_mwh))}/MWh (delivery ${one(String(da.delivery_date || ''))}${da.hour_ending != null ? ` hour ending ${da.hour_ending}` : ''}; ${src}).` };
  }
  return null;
}

// wholesale_context (be#8996, PJM): published price figures, not live, each with its period and report, plus the
// publisher's live-price link. One fact per figure; the link is said in the lead (it is not a figure).
export function wholesaleContextFacts(s) {
  const c = isObj(s.p.wholesale_context) ? s.p.wholesale_context : null;
  if (!c || !Array.isArray(c.figures)) return [];
  const iso = one(c.iso || s.args.iso || '').toUpperCase();
  const out = [];
  for (const g of c.figures) {
    if (!isObj(g) || num(g.value) == null || !one(g.name)) continue;
    const unit = one(g.unit);
    const val = /^\$/.test(unit) ? `$${fmt(num(g.value))}${unit.slice(1)}` : `${fmt(num(g.value))}${unit ? ` ${unit}` : ''}`;
    const tail = [one(g.period), one(g.area), one(g.source), day(g.published) ? `published ${day(g.published)}` : '', one(g.basis)].filter(Boolean).join('; ');
    out.push({ tool: s.tool, step: s.step, entity: iso || null, as_of: day(g.published) || day(g.retrieved), _energy: /\/\s*MWh\b/i.test(unit),
      text: `${iso ? `${iso} ` : ''}${one(g.name)}: ${val}${tail ? ` (${tail})` : ''}.`,
      _short: `${one(g.name)} ${val}${one(g.period) ? ` (${one(g.period)})` : ''}` });
  }
  // An energy price ($/MWh) answers "what does power cost" before a capacity price ($/MW-day); otherwise the
  // publisher's own order (newest first).
  return [...out.filter((f) => f._energy), ...out.filter((f) => !f._energy)];
}
export function liveLink(s) {
  const c = isObj(s.p.wholesale_context) ? s.p.wholesale_context : null;
  const l = c && isObj(c.live_prices) ? c.live_prices : null;
  const url = l && typeof l.url === 'string' && /^https:\/\//.test(l.url) ? l.url : null;
  return url ? `${one(l.label) || 'Live prices'}: ${url}` : null;
}
// What to say when no LMP came back: the ISO's own withheld reason when the response gives one, else the response
// carried no wholesale field at all (a backend before be#8996), and the old scope line is true of it.
export function noLmpNote(s, iso) {
  const w = s && isObj(s.p.wholesale_lmp_withheld) ? s.p.wholesale_lmp_withheld : null;
  return w && one(w.reason) ? `${one(w.iso || iso) || iso} wholesale LMP is not served: ${one(w.reason).replace(/\.$/, '')}.` : NOT_LMP_NOTE;
}

export function buildPriceNowAnswer(ctx, executed, fullByEntry) {
  try {
    if (!ctx || ctx.intent_class !== 'price_now') return null;
    const steps = readSteps(executed, fullByEntry);
    const ep = steps.find((s) => s.tool === 'get_energy_prices');
    const gd = steps.find((s) => s.tool === 'get_grid_data');
    const iso = one((ep && (ep.args.iso || (isObj(ep.p.filter) && ep.p.filter.iso))) || (gd && gd.args.iso) || ctx.iso || '').toUpperCase();
    const facts = [];
    const ne = [];
    const lmp = ep ? lmpFact(ep) : null;
    if (lmp) facts.push(lmp);
    const retail = ep ? tag(factsFromStep('get_energy_prices', ep.p, ep.args)[0], ep) : null;
    if (retail) {
      const h = isObj(ep.p.taste) && isObj(ep.p.taste.headline) ? ep.p.taste.headline : null;
      const basis = h && one(h.basis) ? one(h.basis) : '';
      facts.push({ ...retail, text: retail.text.replace(/\.$/, '') + (basis ? `; ${basis.charAt(0).toLowerCase()}${basis.slice(1)}` : '') + '.' });
    }
    const ctxF = !lmp && ep ? wholesaleContextFacts(ep) : [];
    for (const f of ctxF) facts.push(f);
    const demand = gd ? tag(factsFromStep('get_grid_data', gd.p, gd.args)[0], gd) : null;
    if (demand) facts.push(demand);
    // A demand read held back at this access level is said, with its hour, never dropped (Grok 2026-11-18 e1).
    const period = gd && typeof gd.p.demand_period === 'string' ? gd.p.demand_period : '';
    const loadHeld = gd && !demand ? `${iso || 'The grid'} system load (EIA-930 hourly demand${period ? `, hour ${period} UTC` : ''}) is withheld at this access level.` : '';
    if (loadHeld) ne.push(loadHeld);
    const note = lmp ? '' : noLmpNote(ep, iso);
    if (note) ne.push(note);
    const daNote = lmp && isObj(ep.p.wholesale_lmp) && one(ep.p.wholesale_lmp.day_ahead_note);
    if (daNote) ne.push(daNote.replace(/\.?$/, '.'));
    if (!facts.length) return null;
    const link = ep ? liveLink(ep) : null;
    // No LMP: a publisher's own published figures (PJM) lead, with their periods and the live-price link; else the
    // retail rate with the reason no LMP is served for this grid.
    const lead = lmp ? lmp.text
      : ctxF.length ? `${iso ? `${iso} published figures (not live): ` : 'Published figures (not live): '}${ctxF.slice(0, 2).map((f) => f._short).join('; ')}; each dated and cited in facts[].${link ? ` ${link}.` : ''} ${note}`
      : retail ? `${iso ? `${iso}: ` : ''}${retail.text} ${note}`
      : `${iso ? `${iso}: ` : ''}no price figure came back for this caller. ${note}`;
    const headline = `${lead}${demand ? ` Right now: ${demand.text}` : loadHeld && LOAD_RE.test(String(ctx.intent || '')) ? ` ${loadHeld}` : ''}`;
    const a = answer('price_now', iso || 'the grid asked', headline, facts, ne);
    // Dated by the live interval it leads with, not the oldest fact (the retail month).
    if (a && lmp && lmp.as_of) a.as_of = lmp.as_of;
    return a;
  } catch (_e) { return null; }
}

// ---- gas_price ----
const HENRY_HUB_RE = /\bhenry[\s-]*hub\b/i;
// "dallas" / "dallas-fort-worth" -> "Dallas" / "Dallas Fort Worth"; a label already cased ("ERCOT North") is kept.
function titleMarket(s) {
  const t = one(s);
  if (!t || /[A-Z]/.test(t)) return t;
  return t.replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
export function buildGasPriceAnswer(ctx, executed, fullByEntry) {
  try {
    if (!ctx || ctx.intent_class !== 'gas_price') return null;
    const steps = readSteps(executed, fullByEntry);
    const facts = [];
    const ne = [];
    const gi = steps.filter((s) => s.tool === 'get_gas_index');
    for (const s of gi) for (const f of factsFromStep(s.tool, s.p, s.args)) facts.push(tag(f, s));
    const ge = steps.find((s) => s.tool === 'get_gas_economics');
    let hhF = null;
    if (ge) {
      const p = ge.p;
      const bt = isObj(p.burner_tip) ? num(p.burner_tip.usd_mmbtu) : null;
      const di = num(p.delivered_industrial_usd_mmbtu);
      const de = num(p.delivered_electric_usd_mmbtu);
      const hh = num(p.henry_hub_spot_usd_mmbtu) ?? num(p.natural_gas_usd_mmbtu);
      // 5.48 (Grok daily 2026-11-19, item 6): the market label is a name ("Dallas"), not the slug the step read ("dallas").
      const mk = titleMarket(one((isObj(p.market) && p.market.name) || p.market || ge.args.market || ''));
      const d = stepAsOf(p);
      const parts = [];
      if (de != null) parts.push(`delivered electric-power gas $${fmt(de)}/MMBtu`);
      if (di != null) parts.push(`delivered industrial gas $${fmt(di)}/MMBtu`);
      if (bt != null && de == null) parts.push(`burner-tip gas $${fmt(bt)}/MMBtu`);
      if (hh != null) parts.push(`Henry Hub spot $${fmt(hh)}/MMBtu`);
      if (parts.length) facts.push({ tool: ge.tool, step: ge.step, entity: mk || null, as_of: d, _gas_price: true,
        text: `${mk ? `${mk} ` : ''}gas economics: ${parts.join(', ')} (DC Hub gas economics${d ? `, as of ${d}` : ''}).` });
      if (hh == null) ne.push('The Henry Hub spot is not shown at this access level.');
      if (hh != null) hhF = { tool: ge.tool, step: ge.step, entity: 'Henry Hub', as_of: d, _gas_price: true,
        text: `Henry Hub spot: $${fmt(hh)}/MMBtu (DC Hub gas economics${d ? `, as of ${d}` : ''}).` };
    }
    // 5.52: the Henry Hub spot from get_energy_prices (EIA RNGWHHD, keyless), dated by its own trading day. It leads
    // over the economics step's copy, whose date is the market read's, not the spot's.
    const ep = steps.find((s) => s.tool === 'get_energy_prices');
    if (ep) {
      const p = ep.p;
      const ng = isObj(p.natural_gas) ? p.natural_gas : null;
      const hh = num(p.natural_gas_usd_mmbtu);
      const d = one((ng && (ng.as_of || ng.period)) || '') || null;
      if (hh != null && (!ng || !ng.hub || /henry/i.test(String(ng.hub)))) {
        hhF = { tool: ep.tool, step: ep.step, entity: 'Henry Hub', as_of: d, _gas_price: true,
          text: `Henry Hub spot: $${fmt(hh)}/MMBtu (EIA daily spot via DC Hub${d ? `, as of ${d}` : ''}).` };
        const i = ne.indexOf('The Henry Hub spot is not shown at this access level.');
        if (i >= 0) ne.splice(i, 1);
      }
    }
    if (hhF && !ge && !facts.some((f) => f && f.entity === 'Henry Hub')) facts.push(hhF);
    const clean = facts.filter(Boolean);
    if (!clean.length) return null;
    // 5.46 (item 6): a question that names Henry Hub leads with the Henry Hub figure and its own date; a state's EIA
    // price (often months older) follows as context instead of leading.
    const askedHH = HENRY_HUB_RE.test(String(ctx.intent || ''));
    const priceF = (askedHH && hhF) || clean.find((f) => f._gas_price && !f._withheld) || clean.find((f) => f._gas_price) || null;
    if (askedHH && hhF && clean[0] !== hhF) { const j = clean.indexOf(hhF); if (j > 0) clean.splice(j, 1); clean.unshift(hhF); }
    const verdictF = clean.find((f) => /\(DCGI\) verdict/.test(f.text)) || null;
    const st = (gi[0] && one((isObj(gi[0].p.score) && gi[0].p.score.state) || gi[0].args.state || '')) || '';
    const ctxF = askedHH && hhF ? clean.find((f) => f !== hhF && f.tool === 'get_gas_index' && f._gas_price && !f._withheld) : null;
    const head = [priceF ? priceF.text : `${st ? `${st} ` : ''}natural-gas price: not read in this run.`,
      ctxF ? `For context: ${ctxF.text}` : '',
      verdictF ? verdictF.text : ''].filter(Boolean).join(' ');
    if (priceF && priceF._withheld) ne.push('The gas price figure is withheld at this access level; the DCGI verdict and its bands are shown.');
    return answer('gas_price', st || 'US', head, clean, ne);
  } catch (_e) { return null; }
}

// ---- queue_withdrawals ----
export const WITHDRAWALS_NOT_HELD = 'DC Hub\'s queue tables hold the active queue: its loaders drop withdrawn requests, so a withdrawal count is not served yet.';
// 5.57 (Grok daily 2026-11-20 item 7): since be#9084 the by-iso queue read (get_interconnection_queue) carries a
// queue_withdrawals block for the ISOs whose own file marks withdrawn requests (MISO: 2,327 requests, 395 GW, by year).
// The answer still said "not served yet" because it read only get_refined_queue status=withdrawn, whose loaders drop
// those rows. The block, when it holds a measured count for the ISO asked, is the lead; WITHDRAWALS_NOT_HELD stays for
// an ISO the block lists as not captured, or a read with no block at all.
export function withdrawalsFact(s, isoAsked) {
  const w = s && isObj(s.p) && isObj(s.p.queue_withdrawals) ? s.p.queue_withdrawals : null;
  if (!w) return null;
  const iso = one(isoAsked || s.p.iso || (s.args && s.args.iso) || '').toUpperCase();
  const row = isObj(w.by_iso) ? (w.by_iso[iso] || w.by_iso[iso === 'ISONE' ? 'ISO-NE' : iso]) : null;
  const captured = isObj(row) ? row.status === 'captured' && num(row.count) != null
    : (Array.isArray(w.isos_captured) && w.isos_captured.map((x) => String(x).toUpperCase()).includes(iso) && num(w.count) != null);
  if (!captured) return null;
  const n = isObj(row) ? num(row.count) : num(w.count);
  const gw = isObj(row) ? num(row.gw) : num(w.gw);
  // The block names no report date: loaded_at is when DC Hub read the ISO file, said as that.
  const d = day(w.as_of) || day(w.loaded_at);
  const years = (Array.isArray(w.by_year) ? w.by_year : []).filter((y) => isObj(y) && num(y.year) != null && num(y.count) != null)
    .sort((a, b) => b.year - a.year);
  const latest = years[0] || null;
  const src = isObj(row) && one(row.basis) ? one(row.basis).split(':')[0] : `${iso} queue file`;
  return { tool: s.tool, step: s.step, entity: iso || null, as_of: d, _withdrawn: n,
    text: `${iso} withdrawn interconnection requests: ${fmt(n)}${gw != null ? ` (${fmt(Math.round(gw * 10) / 10)} GW requested)` : ''}`
      + `${latest ? `, ${fmt(latest.count)} of them withdrawn in ${latest.year}` : ''}`
      + ` (${src}${d ? `, as of ${d}` : ''}; withdrawn requests, not part of the active queue).` };
}
export function buildQueueWithdrawalsAnswer(ctx, executed, fullByEntry) {
  try {
    if (!ctx || ctx.intent_class !== 'queue_withdrawals') return null;
    const steps = readSteps(executed, fullByEntry);
    const facts = [];
    const ne = [];
    const rq = steps.find((s) => s.tool === 'get_refined_queue');
    const iq = steps.find((s) => s.tool === 'get_interconnection_queue');
    const fa = rq && isObj(rq.p.filters_applied) ? rq.p.filters_applied : {};
    const iso = one(fa.iso || (rq && rq.args.iso) || (iq && iq.args.iso) || '').toUpperCase();
    const st = one(fa.state || (rq && rq.args.state) || '');
    const n = rq ? num(rq.p.count_total_matching) : null;
    const wf = iq ? withdrawalsFact(iq, iso) : null;
    let head;
    if (wf) {
      facts.push(wf);
      head = wf.text;
    } else if (n) {
      const f = tag(factsFromStep('get_refined_queue', rq.p, rq.args)[0], rq);
      if (f) facts.push(f);
      head = f ? f.text : `${iso} withdrawn requests: ${fmt(n)}.`;
    } else {
      head = `${iso || 'US'}${st ? ` (${st})` : ''} withdrawals: ${WITHDRAWALS_NOT_HELD}`;
      ne.push(WITHDRAWALS_NOT_HELD);
    }
    if (iq) {
      const gw = num(iq.p.queued_generation_gw) ?? num(iq.p.total_gw);
      if (gw != null) {
        const d = stepAsOf(iq.p);
        const f = { tool: iq.tool, step: iq.step, entity: iso || null, as_of: d,
          text: `${iso} active interconnection queue: ${fmt(gw)} GW of requested generation${num(iq.p.project_count) != null ? ` across ${fmt(num(iq.p.project_count))} projects` : ''} (${d ? `as of ${d}` : 'undated'}; generation, not load).` };
        facts.push(f);
        head = `${head} ${f.text}`;
      } else {
        const f = tag(factsFromStep(iq.tool, iq.p, iq.args)[0], iq);
        if (f) { facts.push(f); head = `${head} Active queue: ${f.text}`; }
      }
    }
    if (!facts.length && !head) return null;
    return answer('queue_withdrawals', [iso, st].filter(Boolean).join(' ') || 'US', head, facts, ne);
  } catch (_e) { return null; }
}

// ---- queue_slice ----
// A state's queue asked with a size floor ("VA projects of 100 MW or more in the queue"): the dated state count leads,
// with the floor said as applied or not applied at this access level, never the ISO-wide total first (Grok 2026-11-18
// e2: the lead was PJM-wide 373.5 GW and min_mw was silently dropped). Project names are not listed here.
export function buildQueueSliceAnswer(ctx, executed, fullByEntry) {
  try {
    if (!ctx || ctx.intent_class !== 'interconnection_queue') return null;
    const steps = readSteps(executed, fullByEntry);
    const rq = steps.find((s) => s.tool === 'get_refined_queue' && s.args && s.args.state && num(Number(s.args.min_mw)) != null);
    if (!rq) return null;
    const n = num(rq.p.count_total_matching);
    if (n == null) return null;
    const fa = isObj(rq.p.filters_applied) ? rq.p.filters_applied : {};
    const st = one(fa.state || rq.args.state).toUpperCase();
    const floor = Number(rq.args.min_mw);
    const applied = num(fa.min_mw) != null && num(fa.min_mw) >= floor;
    const base = factsFromStep('get_refined_queue', rq.p, rq.args)[0];
    const d = base ? base.as_of : stepAsOf(rq.p);
    const mw = applied ? num(rq.p.total_queued_mw) : null;
    const facts = [];
    const ne = [];
    const f = tag({ tool: 'get_refined_queue', as_of: d, entity: st,
      text: applied
        ? `${st} interconnection queue: ${fmt(n)} active request${n === 1 ? '' : 's'} of ${fmt(floor)} MW or more${mw != null ? `, ${fmt(Math.round(mw))} MW in all` : ''} (ISO queue files${d ? `, as of ${d}` : ''}).`
        : `${st} interconnection queue: ${fmt(n)} active requests of all sizes (ISO queue files${d ? `, as of ${d}` : ''}); the ${fmt(floor)} MW floor was not applied at this access level, so this is not the count of requests of ${fmt(floor)} MW or more.` }, rq);
    facts.push(f);
    if (!applied) ne.push(`The count of ${st} requests of ${fmt(floor)} MW or more: the size floor filters on a figure withheld at this access level.`);
    let head = f.text;
    for (const iq of steps.filter((s) => s.tool === 'get_interconnection_queue')) {
      const g = tag(factsFromStep(iq.tool, iq.p, iq.args)[0], iq);
      if (g) { facts.push(g); head = `${head} Context, whole grid: ${g.text}`; }
    }
    return answer('queue_slice', st, head, facts, ne);
  } catch (_e) { return null; }
}
