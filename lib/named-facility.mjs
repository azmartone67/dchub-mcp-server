// named-facility.mjs -- planner 5.56: one named facility is searched by its name, read by its best name match, and its
// record leads the answer.
//
// WHY. Grok's daily MCP note (2026-11-20, item 2), live on planner 5.55: "Give me the details for QTS Atlanta Metro data
// center: address, operator, power capacity and status." planned search_facilities {query:"Atlanta", state:"GA"} (the
// metro, the facility's name dropped), and get_facility read the first row, QTS Suwanee. A direct search_facilities
// {query:"QTS Atlanta Metro"} returns "QTS Atlanta-Metro (ATL1)". The lead was the state's power figures.
//
// WHAT.
//   * namedFacility(text): the provider + facility name the question names ("QTS Atlanta Metro", "Equinix DA11"), when
//     the question is about ONE facility (a facility code, a singular facility noun after the name, or "details for /
//     tell me about / profile of" before it). An operator-wide ask ("Equinix sites in Virginia") is not one.
//   * facilityNameScore(row, name): whole-token match of the name against the row's provider + name (a code such as
//     ATL1 must match whole: "DA1" never matches "DA11"). rankByFacilityName(rows, name): matching rows first, best first.
//   * buildNamedFacilityAnswer(ctx, executed, fullByEntry): the intent_answer. The headline is the facility record:
//     name, operator, city, status, address and power capacity as the record holds them, the record's as_of, and the
//     fields the record does not hold (or withholds at this access level). The power context of the place follows as a
//     second sentence, never ahead of the record.
// Pure; nothing here throws.

import { facilityDisplayName, shortProvider, cityOnlyName } from './facility-names.mjs';
import { factsFromStep } from './plan-step-facts.mjs';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v.trim()) ? Number(v) : null));
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(Math.round(n * 10) / 10));
const toks = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

export const NAMED_FACILITY_KIND = 'named_facility';

// The providers a facility name starts with (the colocation operator list, lib/colocation-plan.mjs, plus the
// wholesale names the facility registry carries).
const PROVIDER_RE = /\b(equinix|digital\s+realty|interxion|coresite|qts|cyrusone|vantage|ntt|stack\s+infrastructure|stack|switch|aligned|flexential|cologix|iron\s+mountain|databank|h5|centersquare|evoque|cyxtera|lumen|level\s*3|zayo|sabey|edgeconnex|compass|t5|tierpoint|colohouse|element\s+critical|yondr|cloudhq|novva|prime)\b/i;
// A facility code: ATL1, DA11, DC2, NVA9, IAD38, CH1 (letters then digits).
const CODE_RE = /^[A-Za-z]{2,4}-?\d{1,3}[A-Za-z]?$/;
// Words that end the name: generic nouns, prepositions, punctuation-led words.
const STOP_RE = /^(?:data|datacenter|datacentre|center|centre|facility|facilities|campus|campuses|building|site|sites|colo|colocation|in|at|near|for|of|on|and|or|with|vs|versus|the|a|an|is|are|what|who|where|how|give|me|details?|address|operator|power|capacity|status)$/i;
const SINGULAR_AFTER_RE = /^\s*(?:data\s*cent(?:er|re)|facility|campus|building)(?!s)\b/i;
const ONE_FACILITY_BEFORE_RE = /\b(?:details?\s+(?:for|on|of|about)|tell\s+me\s+about|profile\s+(?:for|of)|look\s+up|information\s+(?:on|about)|info\s+(?:on|about))\s+(?:the\s+)?$/i;

/** The one facility the question names: { name, provider, code } or null. */
export function namedFacility(text) {
  try {
    const t = String(text || '').slice(0, 600);
    const m = PROVIDER_RE.exec(t);
    if (!m) return null;
    const provider = m[1].replace(/\s+/g, ' ');
    const rest = t.slice(m.index + m[0].length);
    const words = [];
    let consumed = 0;
    const re = /^(\s+|-)([A-Za-z0-9][A-Za-z0-9'.]*)/;
    let s = rest;
    for (let i = 0; i < 5; i += 1) {
      const w = re.exec(s);
      if (!w) break;
      const word = w[2].replace(/[.']+$/, '');
      if (STOP_RE.test(word)) break;
      // A name word is capitalised ("Atlanta", "Metro") or a facility code ("ATL1"); a lowercase word ends the name.
      if (!(CODE_RE.test(word) || /^[A-Z][A-Za-z]+$/.test(word) || /^[IVX]+$/.test(word) || /^\d{1,2}$/.test(word))) break;
      words.push(word);
      consumed += w[0].length;
      s = s.slice(w[0].length);
    }
    if (!words.length) return null;
    const code = words.find((w) => CODE_RE.test(w)) || null;
    const after = rest.slice(consumed);
    const before = t.slice(0, m.index);
    // ONE facility: a code, a singular facility noun right after the name, or a "details for" lead-in before it.
    if (!(code || SINGULAR_AFTER_RE.test(after) || ONE_FACILITY_BEFORE_RE.test(before))) return null;
    const pv = provider.split(' ').map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ');
    return { name: `${pv} ${words.join(' ')}`, provider: pv, code };
  } catch (_e) { return null; }
}

/** Whole-token match of a facility name against a row's provider + name: 0 (no match) .. 100 (exact). */
export function facilityNameScore(row, name) {
  try {
    const want = toks(name);
    if (!want.length || !isObj(row)) return 0;
    const have = toks([one(row.provider) || one(row.operator), one(row.name)].join(' '));
    const own = toks(row.name);
    if (!have.length) return 0;
    if (!want.every((w) => have.includes(w))) return 0;
    // Exact (the row's name is the name, the provider maybe in front), then the fewest extra words.
    const extra = own.filter((w) => !want.includes(w)).length;
    return Math.max(1, 100 - extra * 5);
  } catch (_e) { return 0; }
}

/** Rows that match the name first (best match first, stable), the rest after in their order. A city-only row never leads. */
export function rankByFacilityName(rows, name) {
  const list = Array.isArray(rows) ? rows : [];
  if (!one(name)) return list;
  const scored = list.map((r, i) => ({ r, i, s: cityOnlyName(r) ? 0 : facilityNameScore(r, name) }));
  const hit = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.r);
  return [...hit, ...list.filter((r) => !hit.includes(r))];
}

function parsed(v) {
  if (isObj(v)) return v;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return null;
}
const ran = (e) => isObj(e) && (e.status === 'executed' || e.status === 'gated_preview');
const rowsOf = (p) => (isObj(p) && (Array.isArray(p.data) ? p.data : Array.isArray(p.facilities) ? p.facilities
  : Array.isArray(p.results) ? p.results : null)) || [];

const locked = (p, rec, re) => (Array.isArray(p && p._locked_fields) && p._locked_fields.some((f) => re.test(String(f))))
  || (Array.isArray(rec && rec._locked_fields) && rec._locked_fields.some((f) => re.test(String(f))));
const mwOf = (r) => num(r.power_mw) ?? num(r.total_power_mw) ?? num(r.capacity_mw) ?? num(r.it_load_mw) ?? num(r.power_capacity_mw);
const asOfOf = (r, p) => day(r.updated_at) || day(r.last_verified) || day(r.last_updated) || day(r.as_of)
  || day(p && p.as_of) || (isObj(p && p.citation) ? day(p.citation.as_of) : null);

/**
 * The intent_answer for a named-facility plan, or null. ctx: { intent, intent_class, facility: {name, ...} }.
 * The record comes from get_facility when it read the facility the name matched, else from the search row.
 */
export function buildNamedFacilityAnswer(ctx, executed, fullByEntry) {
  try {
    const name = ctx && isObj(ctx.facility) ? one(ctx.facility.name) : '';
    if (!name || !ctx || ctx.intent_class !== 'facility_search') return null;
    const ex = Array.isArray(executed) ? executed : [];
    const full = (e) => parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
    const search = ex.find((e) => e.tool === 'search_facilities' && ran(e));
    const sp = search ? full(search) : null;
    const ranked = rankByFacilityName(rowsOf(sp), name);
    const best = ranked.find((r) => facilityNameScore(r, name) > 0) || null;
    let rec = best;
    let recP = sp;
    let recTool = 'search_facilities';
    const gf = ex.find((e) => e.tool === 'get_facility' && ran(e));
    const gp = gf ? full(gf) : null;
    const gd = gp ? (isObj(gp.data) ? gp.data : gp) : null;
    if (gd && (one(gd.name) || one(gd.slug)) && facilityNameScore(gd, name) > 0) { rec = { ...(best || {}), ...gd }; recP = gp; recTool = 'get_facility'; }
    if (!rec) {
      const headline = `No DC Hub facility record matched "${name}" in this read; the facility search returned ${ranked.length ? `${ranked.length} other row${ranked.length === 1 ? '' : 's'}` : 'no rows'}, and none is presented as that facility.`;
      return { kind: NAMED_FACILITY_KIND, facility: name, headline, evidence: [], facts: [],
        not_established: [`Which DC Hub record, if any, is "${name}": search_facilities with another spelling or the facility code.`] };
    }
    const display = facilityDisplayName(rec) || name;
    const provider = shortProvider(one(rec.provider) || one(rec.operator) || one(rec.provider_name));
    const city = one(rec.city), st = one(rec.state);
    const status = one(rec.status) || one(rec.operational_status);
    const address = one(rec.address) || one(rec.street_address);
    const mw = mwOf(rec);
    const d = asOfOf(rec, recP);
    const parts = [];
    if (provider) parts.push(`operator ${provider}`);
    if (city || st) parts.push([city, st].filter(Boolean).join(', '));
    if (status) parts.push(`status ${status}`);
    if (address) parts.push(`address ${address}`);
    if (mw != null) parts.push(`power capacity ${fmt(mw)} MW`);
    const missing = [];
    const withheld = [];
    const want = [
      ['address', !address, /address/i],
      ['operator', !provider, /provider|operator/i],
      ['power capacity (MW)', mw == null, /power|capacity|mw/i],
      ['status', !status, /status/i],
    ];
    for (const [label, absent, re] of want) {
      if (!absent) continue;
      (locked(recP, rec, re) ? withheld : missing).push(label);
    }
    let headline = `${display}${parts.length ? ` (${parts.join('; ')})` : ''}: DC Hub facility record${d ? ` as of ${d}` : ''}`;
    if (missing.length) headline += `. Not on record: ${missing.join(', ')}`;
    if (withheld.length) headline += `. Withheld at this access level: ${withheld.join(', ')}`;
    headline += '.';
    // The place's power is context, second: one dated fact from the power step, after the record.
    const power = ex.find((e) => ran(e) && ['get_power_availability_timeline', 'get_grid_intelligence', 'get_energy_prices'].includes(e.tool));
    let powerLine = '';
    if (power) {
      const pf = factsFromStep(power.tool, full(power) || {}, power.args || {})[0];
      if (pf && pf.text) powerLine = `Power context for ${st || 'the state'} (not this facility's own supply): ${pf.text}`;
    }
    const facts = [{ tool: recTool, entity: display, as_of: d,
      text: `${display}: ${parts.join('; ') || 'facility record'} (DC Hub facility record${d ? `, as of ${d}` : ''}).` }];
    return {
      kind: NAMED_FACILITY_KIND, facility: display, matched_name: name,
      headline: powerLine ? `${headline} ${powerLine}` : headline,
      evidence: [`Matched "${name}" to the record "${one(rec.name) || display}"${one(rec.slug) ? ` (${one(rec.slug)})` : ''} by name, not by the first search row.`],
      facts,
      not_established: [...missing.map((m) => `${m}: not in this facility record.`), ...withheld.map((m) => `${m}: withheld at this access level.`)],
    };
  } catch (_e) { return null; }
}
