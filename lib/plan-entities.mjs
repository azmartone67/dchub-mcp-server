// plan-entities.mjs -- planner 5.35 (Grok MCP-dominance evals 2026-11-17, gaps 1, 3, 5 and 7).
//
// WHY. Most of the eval's lost points were routing, not gating:
//   gap 1  "What is the generating capacity mix in Virginia?" matched no class and ran discover_tools only, while
//          compare_isos already returned generation_mix_pct at preview depth.
//   gap 3  multi-entity asks kept one entity: "PJM, MISO and SPP" read PJM only; "Northern Virginia vs ERCOT" read
//          ERCOT with state=VA (0 rows); "Dallas, Atlanta and Columbus" read two; "Texas vs Ohio" minted the market
//          slugs "texas" and "ohio-power", and a harvested "ercot-supply" reached get_market_dcpi_rank (404).
//   gap 5  "Stargate Abilene" routed to deals_ma and read nothing about the campus.
//   gap 7  "Henry Hub" read the electricity rate (get_energy_prices) and never the gas index.
//
// WHAT. Pure helpers server.mjs's planner calls: the generation-mix grids for a state, the per-entity ISO list, the
// state-vs-state sequence, the named-campus detector, a market-slug check used before a step runs, and the
// generation-mix answer. Nothing here does I/O; nothing throws.

import { dcpiMarketBySlug, matchDcpiMarket } from './dcpi-market-match.mjs';
import { sourceLine } from './source-line.mjs';
import { anchorMarketForState } from './dc-power-place.mjs';

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ---- gap 1: generation mix ------------------------------------------------------------------------------------
export const GENERATION_MIX_RE = /\b(?:generation|generating|fuel|power|energy|supply|resource|capacity)\s+mix\b|\bfuel\s+(?:split|breakdown|shares?)\b|\bmix\s+of\s+(?:generation|fuels?|power)\b|\b(?:share|percent(?:age)?)\s+of\s+(?:its\s+|the\s+)?(?:power|generation|electricity)\s+(?:from|is)\b|\bhow\s+much\s+of\s+.{0,40}\b(?:gas|coal|nuclear|wind|solar|renewables?)\b/i;
export function generationMixAsk(text) { return GENERATION_MIX_RE.test(String(text || '').slice(0, 1000)); }

// The grid whose EIA hourly fuel mix answers for a state: its first RTO, else its main utility balancing authority
// (the EIA-930 codes get_grid_data / compare_isos read). A split state reads its primary grid and says so.
export const STATE_MIX_GRID = Object.freeze({
  GA: 'SOCO', AL: 'SOCO', TN: 'TVA', FL: 'FPL', SC: 'DUK',
  WA: 'BPA', OR: 'BPA', ID: 'BPA', MT: 'NWMT', WY: 'PACE', UT: 'PACE',
  NV: 'NEVP', AZ: 'AZPS', CO: 'PSCO', NM: 'PNM',
});
export const SPLIT_STATE_NOTE = Object.freeze({
  TX: 'Texas is mostly ERCOT; the Panhandle is SPP, far-east Texas MISO and El Paso WECC.',
  VA: 'Virginia is mostly PJM (Dominion zone); a strip of the southwest is outside it.',
  IL: 'Illinois splits between PJM (ComEd, the north) and MISO (Ameren, the south).',
  IN: 'Indiana splits between PJM and MISO.', MI: 'Michigan splits between MISO and PJM.',
  MO: 'Missouri splits between SPP and MISO.', NC: 'North Carolina is mostly Duke (non-RTO); the northeast corner is PJM.',
  KY: 'Kentucky splits between PJM and the non-RTO Southeast.', NM: 'New Mexico splits between SPP and WECC.',
});
const RTOS = new Set(['ERCOT', 'PJM', 'MISO', 'SPP', 'CAISO', 'NYISO', 'ISONE']);
// A second grid for compare_isos (it takes 2-4) when only one was asked: a neighbour, read for context only.
const MIX_NEIGHBOUR = Object.freeze({ PJM: 'MISO', MISO: 'PJM', ERCOT: 'SPP', SPP: 'ERCOT', CAISO: 'BPA', NYISO: 'ISONE',
  ISONE: 'NYISO', SOCO: 'TVA', TVA: 'SOCO', FPL: 'SOCO', DUK: 'PJM', BPA: 'CAISO', AZPS: 'CAISO', NEVP: 'CAISO',
  PSCO: 'SPP', PACE: 'BPA', NWMT: 'BPA', PNM: 'SPP' });

/** The grid a state's mix is read from. stateIsoMeta: server.mjs _STATE_ISO_META. */
export function stateMixGrid(state, stateIsoMeta) {
  const st = String(state || '').toUpperCase();
  if (STATE_MIX_GRID[st]) return STATE_MIX_GRID[st];
  if (st === 'NC') return 'DUK';
  const isos = (stateIsoMeta && stateIsoMeta[st]) || [];
  return isos.find((x) => RTOS.has(x)) || null;
}

/** [{grid, state|null}] for a mix ask: named grids first, then each named state's grid. At most four. */
export function mixGrids(d, stateIsoMeta) {
  const out = [];
  const add = (grid, state = null) => { if (grid && !out.some((x) => x.grid === grid)) out.push({ grid, state }); };
  for (const iso of (d && Array.isArray(d.isos) ? d.isos : [])) add(String(iso).toUpperCase() === 'ISO-NE' ? 'ISONE' : String(iso).toUpperCase());
  if (d && d.iso && !out.length) add(String(d.iso).toUpperCase());
  const states = [...(d && Array.isArray(d.states) ? d.states : []), d && d.state, d && d.stateFromPlace].filter((s) => typeof s === 'string' && /^[A-Z]{2}$/.test(s));
  for (const st of states) add(stateMixGrid(st, stateIsoMeta), st);
  return out.slice(0, 4);
}

export function generationMixSequence(d, stateIsoMeta) {
  const grids = mixGrids(d, stateIsoMeta);
  if (!grids.length) {
    return [{ step: 1, tool: 'get_grid_scoreboard', depends_on: [], estimated_calls: 1,
      why: 'No grid or state was named: the US grid scoreboard carries each ISO\'s gas and renewable share, so the mix question has an answer per grid.',
      args_hint: {} }];
  }
  const asked = grids.map((g) => g.grid);
  const cmp = asked.length >= 2 ? asked : [asked[0], MIX_NEIGHBOUR[asked[0]] || (asked[0] === 'PJM' ? 'MISO' : 'PJM')];
  const seq = [{ step: 1, tool: 'compare_isos', depends_on: [], estimated_calls: 1,
    why: `The hourly generation mix as percentages (generation_mix_pct, EIA-930) for ${asked.join(', ')}`
      + (asked.length < 2 ? `; ${cmp[1]} is read beside it only because compare_isos takes two grids, and is context, not the answer` : '') + '.',
    args_hint: { isos: cmp.map((x) => (x === 'ISONE' ? 'ISO-NE' : x)).join(',') } }];
  for (const g of grids) {
    seq.push({ step: seq.length + 1, tool: 'get_grid_data', depends_on: [], estimated_calls: 1,
      why: `Live fuel mix and demand for ${g.grid}${g.state ? ` (the grid serving ${g.state})` : ''}: the same EIA hourly series, as megawatts.`,
      args_hint: { iso: g.grid, metric: 'fuel_mix' } });
  }
  return seq;
}

const FUEL = { NG: 'gas', NUC: 'nuclear', COL: 'coal', WND: 'wind', SUN: 'solar', WAT: 'hydro', OIL: 'oil', GEO: 'geothermal',
  BAT: 'battery storage', PS: 'pumped storage', OTH: 'other', UNK: 'unknown', SNB: 'solar+battery', WNB: 'wind+battery' };
function parsed(v) {
  if (isObj(v)) return v;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return null;
}
function mixLine(grid, row) {
  const pct = isObj(row.generation_mix_pct) ? row.generation_mix_pct : null;
  if (!pct) return null;
  const parts = Object.entries(pct).filter(([k, v]) => num(v) != null && num(v) > 0 && k !== 'BAT' && k !== 'PS')
    .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${FUEL[k] || k.toLowerCase()} ${v}%`);
  if (!parts.length) return null;
  const per = typeof row.generation_mix_period === 'string' ? row.generation_mix_period : null;
  return { grid, text: `${grid} generation mix: ${parts.join(', ')}`, period: per };
}

/**
 * intent_answer for a generation-mix plan: one line per asked grid with its percentages, as of the EIA hour, then
 * the split-state note and the honest caveat that this is the hour's generation, not installed capacity.
 * ctx: { intent, intent_class, grids: [{grid, state}] }. null when no asked grid has a mix in this run.
 */
export function buildGenerationMixAnswer(ctx, executed, fullByEntry) {
  try {
    if (!ctx || !(ctx.intent_class === 'generation_mix' || (ctx.intent_class === 'iso_comparison' && generationMixAsk(ctx.intent)))) return null;
    const grids = Array.isArray(ctx.grids) ? ctx.grids : [];
    const rows = new Map();
    let cite = null;
    for (const e of Array.isArray(executed) ? executed : []) {
      if (!e || !(e.status === 'executed' || e.status === 'gated_preview') || e.tool !== 'compare_isos') continue;
      const p = parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
      const cmp = p && isObj(p.comparison) ? p.comparison : null;
      if (!cmp) continue;
      for (const [k, row] of Object.entries(cmp)) if (isObj(row)) rows.set(String(k).toUpperCase().replace('ISO-NE', 'ISONE'), row);
      cite = cite || { p, tool: e.tool, args: e.args || {} };
    }
    const asked = grids.length ? grids : [...rows.keys()].map((grid) => ({ grid, state: null }));
    const lines = [];
    const notEstablished = [];
    const periods = [];
    for (const g of asked) {
      const row = rows.get(g.grid);
      const l = row ? mixLine(g.grid, row) : null;
      if (l) { lines.push(`${l.text}${g.state ? ` (the grid serving ${g.state})` : ''}${l.period ? ` (EIA-930 hour ${l.period})` : ''}.`); if (l.period) periods.push(l.period); }
      else notEstablished.push(`No generation mix for ${g.grid} in this run.`);
    }
    if (!lines.length) return null;
    const notes = asked.map((g) => g.state && SPLIT_STATE_NOTE[g.state]).filter(Boolean);
    const capacityAsk = /\bcapacity\b|\binstalled\b|\bnameplate\b/i.test(String(ctx.intent || ''));
    const caveat = 'These are shares of the hour\'s generation (EIA-930 hourly), not installed capacity'
      + (capacityAsk ? '; installed capacity by fuel is not in this read' : '') + '.';
    return {
      kind: 'generation_mix',
      headline: lines.join(' '),
      evidence: [...notes, caveat],
      not_established: notEstablished,
      as_of: periods.length ? periods.slice().sort()[0] : null,
      relay: null,
      source: cite ? sourceLine(cite.p, cite.tool, cite.args) : null,
    };
  } catch (_e) { return null; }
}

// ---- gap 3: entities --------------------------------------------------------------------------------------------
const ISO_TOKEN = /\b(?:ercot|pjm|miso|spp|caiso|nyiso|iso-?ne|isone|wecc|serc|frcc)\b/i;
const NOT_A_MARKET_WORD = /\b(?:supply|power|prices?|pricing|grid|queue|outlook|demand|energy|capacity|availability|headroom|cost|costs|rates?|mix)\b/i;
const US_STATE_NAMES = ['alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida',
  'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland',
  'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire',
  'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania',
  'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
  'west virginia', 'wisconsin', 'wyoming'];

/**
 * Why a market slug must not be sent to a market tool, or null. A slug the DCPI table knows is fine; an unknown slug
 * is passed through (the backend decides) unless it is plainly not a market: a US state name ("texas", "virginia"),
 * an ISO name ("ercot-supply"), or a slug carrying a non-market word ("ohio-power", "prices-texas").
 */
export function marketSlugProblem(slug, knownSlugs = null) {
  const s = String(slug || '').trim().toLowerCase();
  if (!s || /^<.*>$/.test(s)) return null;
  if (dcpiMarketBySlug(s)) return null;
  if (knownSlugs && knownSlugs.has && knownSlugs.has(s)) return null;
  const words = s.replace(/[-_]+/g, ' ');
  if (US_STATE_NAMES.includes(words)) return `"${s}" is a US state, not a DCPI market slug`;
  if (ISO_TOKEN.test(words)) return `"${s}" names a grid operator, not a DCPI market slug`;
  if (NOT_A_MARKET_WORD.test(words)) return `"${s}" is not a DCPI market slug (it carries "${(words.match(NOT_A_MARKET_WORD) || [''])[0]}")`;
  return null;
}
const MARKET_ARG = { get_market_dcpi_rank: 'market_slug', get_market_intel: 'market', get_facility_risk_delta: 'market',
  predict_market_trajectory: 'market_slug' };
/** Before a step runs: { missing, note } when its market argument is not a market, else null. */
export function marketSlugGuard(tool, args, knownSlugs = null) {
  const k = MARKET_ARG[tool];
  if (!k || !args || typeof args !== 'object' || typeof args[k] !== 'string') return null;
  const why = marketSlugProblem(args[k], knownSlugs);
  return why ? { missing: k, note: `${why}; the step was not run, so nothing is reported for it. Name a tracked market (get_market_dcpi_rank takes slugs like dallas, columbus, phoenix).` } : null;
}

/**
 * The grids a comparison names, in text order: grid names, then the grid of a named place when the text compares
 * ("Northern Virginia vs ERCOT" -> PJM, ERCOT). placeIso: the place's RTO (server-resolved), or null.
 */
export function entityIsos(text, d, placeIso) {
  const t = String(text || '');
  const isos = (d && Array.isArray(d.isos) ? d.isos : []).map((x) => String(x).toUpperCase());
  const comparing = /\b(?:vs\.?|versus|compared?\s+(?:to|with)|compare|or)\b/i.test(t);
  if (!comparing || !placeIso || !RTOS.has(placeIso) || isos.includes(placeIso)) return isos;
  return [placeIso, ...isos];
}

/** Two or more US states compared and no DCPI market among the comparison's sides: the per-state sequence. */
export function stateComparisonSequence(d, stateIsoMeta, text) {
  const states = (d && Array.isArray(d.states) ? d.states : []).slice(0, 4);
  if (states.length < 2) return null;
  const price = /\b(?:prices?|costs?|rates?|tariffs?|cents|kwh|mwh)\b/i.test(String(text || ''));
  const seq = [];
  const add = (tool, args, why) => seq.push({ step: seq.length + 1, tool, depends_on: [], estimated_calls: 1, why, args_hint: args });
  const kinds = price ? ['price', 'timeline', 'grid'] : ['timeline', 'price', 'grid'];
  for (const k of kinds) {
    for (const st of states) {
      if (k === 'price') add('get_energy_prices', { state: st }, `Retail electricity rate for ${st}, one of the states compared (EIA).`);
      if (k === 'timeline') add('get_power_availability_timeline', { state: st }, `Supply-side power timing for ${st}, one of the states compared: its grid's own queue total and the firm-supply signal.`);
      if (k === 'grid') {
        const iso = stateMixGrid(st, stateIsoMeta);
        if (iso && RTOS.has(iso) && !seq.some((x) => x.tool === 'get_grid_intelligence' && x.args_hint.iso === iso)) {
          add('get_grid_intelligence', { iso }, `Grid headroom and time to power for ${iso}, the grid serving ${st}.`);
        }
      }
    }
  }
  return seq;
}

// ---- gap 5: a named campus --------------------------------------------------------------------------------------
const CAMPUS_BRANDS = /\b(stargate|hyperion|prometheus|colossus|fairwater|project\s+[A-Z][a-z]+)\b/i;
const CAMPUS_TAIL = /\b((?:[A-Z][A-Za-z0-9&'-]+\s+){1,4})(?:campus|data\s*cent(?:er|re)\s+campus|hyperscale\s+campus|ai\s+campus|gigawatt\s+campus|project)\b/;
const NOT_A_NAME = /^(?:the|a|an|my|our|which|what|where|how|is|are|data|ai|gpu|hyperscale)$/i;
/** { name, market } for a named campus ("Stargate Abilene", "the Hyperion campus"), else null. */
export function namedCampus(text) {
  const t = String(text || '').slice(0, 500);
  let name = null;
  const b = CAMPUS_BRANDS.exec(t);
  if (b) {
    const after = t.slice(b.index + b[0].length).match(/^\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
    name = (b[0].replace(/\b\w/g, (c) => c.toUpperCase()) + (after ? ' ' + after[1] : '')).trim();
  } else {
    const m = CAMPUS_TAIL.exec(t);
    if (m) {
      // A name is proper nouns ("Mount Pleasant"), never a size or acronym run ("200 MW AI campus").
      const words = m[1].trim().split(/\s+/);
      const proper = words.length && words.every((w) => /^[A-Z][a-z][A-Za-z'-]*$/.test(w) && !NOT_A_NAME.test(w));
      const before = t.slice(0, m.index);
      if (proper && !/\b\d[\d,.]*\s*(?:mw|gw|kw)?\s*$/i.test(before)) name = words.join(' ');
    }
  }
  if (!name) return null;
  name = name.replace(/\s+(?:campus|project)$/i, '').trim();
  let market = null;
  try { const hit = matchDcpiMarket(name) || matchDcpiMarket(t); market = hit && hit.slug ? hit : null; } catch (_e) { market = null; }
  const rec = market ? (dcpiMarketBySlug(market.slug) || market) : null;
  return { name, market: rec ? { slug: rec.slug, state: Array.isArray(rec.states) ? rec.states[0] : null } : null };
}

export function namedCampusSequence(c, d = null) {
  const st = d && (d.state || d.stateFromPlace || (Array.isArray(d.states) && d.states.length === 1 ? d.states[0] : null)) || null;
  const seq = [{ step: 1, tool: 'search_facilities', depends_on: [], estimated_calls: 1,
    why: `The campus by name: "${c.name}" (free-text search over facility name, operator and location).`,
    args_hint: { query: c.name, limit: 5 } }];
  seq.push({ step: 2, tool: 'get_pipeline', depends_on: [], estimated_calls: 1,
    why: `The construction pipeline ${c.market ? `in ${c.market.slug}${c.market.state ? `, ${c.market.state}` : ''}` : (st ? `in ${st}` : 'in the US')}: the projects on record and their MW (a project with no stated size is said as MW not held).`,
    args_hint: c.market ? { market: c.market.slug, ...(c.market.state ? { state: c.market.state } : {}) } : (st ? { state: st } : { country: 'US' }) });
  seq.push({ step: 3, tool: 'semantic_search', depends_on: [], estimated_calls: 1,
    why: `Coverage of "${c.name}" in DC Hub's news and intelligence corpus: announcements, phases and dates.`,
    args_hint: { query: c.name } });
  if (c.market) {
    seq.push({ step: 4, tool: 'get_market_dcpi_rank', depends_on: [], estimated_calls: 1,
      why: `The power verdict for the campus's market (${c.market.slug}).`, args_hint: { market_slug: c.market.slug } });
  }
  return seq;
}

// ---- gap 7: gas price ----------------------------------------------------------------------------------------
export const GAS_PRICE_RE = /\bhenry\s*hub\b|\bnatural\s+gas\s+(?:prices?|costs?|rates?)\b|\bgas\s+(?:prices?|costs?|index)\b|\$\s*\/\s*mmbtu\b|\bmmbtu\b|\bdcgi\b|\bdata\s+center\s+gas\s+index\b/i;
export function gasPriceAsk(text) { return GAS_PRICE_RE.test(String(text || '').slice(0, 1000)); }
const ELECTRIC_RE = /\belectric(?:ity)?\b|\bkwh\b|\bretail\s+rate\b|\bpower\s+(?:prices?|costs?)\b/i;
export function gasPriceSequence(d) {
  const st = d && (d.state || d.stateFromPlace || (Array.isArray(d.states) && d.states[0])) || null;
  const states = (d && Array.isArray(d.states) && d.states.length > 1 ? d.states : (st ? [st] : [])).slice(0, 3);
  const seq = [];
  const add = (tool, args, why) => seq.push({ step: seq.length + 1, tool, depends_on: [], estimated_calls: 1, why, args_hint: args });
  if (states.length) for (const s of states) add('get_gas_index', { state: s }, `The Data Center Gas Index (DCGI) for ${s}: the state's gas-suitability score and the EIA gas price series that priced it.`);
  else add('get_gas_index', { limit: 10 }, 'The Data Center Gas Index (DCGI) across states, with the EIA gas price series each was priced on.');
  // 5.40 (Grok energy head-to-head, gap 2): a state-only question resolves the market from the state, so the economics
  // step runs instead of skipping on an unbound placeholder.
  const gm = (d && d.market) || (d && d.__outlook && d.__outlook.slug) || anchorMarketForState(st);
  add('get_gas_economics', { market: gm || '<market slug, e.g. dallas>' }, `Behind-the-meter gas-fired economics on the same gas price${gm && !(d && d.market) ? ` (${gm}, the market DC Hub reads for ${st})` : ''}: delivered gas, burner tip and gas-to-grid $/MWh.`);
  if (d && d.__elecToo) add('get_energy_prices', st ? { state: st } : {}, 'The grid electricity rate the question also asked about.');
  return seq;
}
export function gasAlsoAsksElectricity(text) { return ELECTRIC_RE.test(String(text || '')); }
