// ranked-table-lead.mjs: an inline ranked table leads a gated execute_plan ranking answer (Grok -> Brain 2026-11-28,
// Change 1; owner "please fix" 2:39 AM MST).
//
// WHY. Live 2026-11-28, keyless: "Where can 100 MW get power fastest in ERCOT, by DCPI?" ran rank_markets and
// get_grid_intelligence and led with the Midland score, a "Withheld here:" list and the /u/ link. The rows the
// caller's own preview already received (verdict, score, confidence, inputs, as_of) never reached the agent as a
// table: execute_plan slims each step's result out of the envelope for a preview caller.
//
// WHAT. For an execute_plan market_ranking answer shown to a caller below a paid plan (the same "gated answer" test
// as the other wall steps), ONE content item goes first: a markdown table built only from what that caller's own
// steps returned (the rank_markets / site_selection_canvas preview rows, joined with any get_market_dcpi_rank card
// the plan read for the same market slug). Every unlock, relay and report link stays where it was, after the table.
// A cell the ranking step held back is the token `withheld`; one not in this answer or not measured is
// `unavailable`. Never 0. Nothing is invented: no field the preview
// withheld is filled from anywhere else.
//
// Not on /mcp/chatgpt, /mcp/claude, /mcp/grok, /mcp/core or a clean platform (server.mjs decides that, with the same
// checks as ranked_answer). No link, price, plan name or tool count in the table. Kill switch DCHUB_RANKED_TABLE_LEAD=0.
// Pure: no ctx, no network.

export const RANKED_TABLE_FLAG = 'DCHUB_RANKED_TABLE_LEAD';
export const UNAVAILABLE = 'unavailable';
// A cell the caller's own ranking step held back reads `withheld`, the word the next block's "Withheld here:" list
// uses (lib/withheld-copy.mjs WITHHELD_VALUE). Grok 2026-11-28 14:46Z: the Texas table showed Composite 80.6 from the
// DCPI card while "Withheld here:" named composite score (the canvas step's preview held it). The table now keeps the
// ranking step's preview: a field that step withheld is never filled from a card.
export const WITHHELD = 'withheld';
export const TABLE_MARKER = '| # | Market | DCPI verdict |';
const MAX_ROWS = 10;
const VERDICTS = new Set(['BUILD', 'CAUTION', 'AVOID']);

// ON unless set to 0 / false / no / off.
export function rankedTableLeadOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env[RANKED_TABLE_FLAG]) || '').trim());
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const heldIn = (row, key) => !!row && (row[`_${key}_withheld`] === true || row[`_${key}_in_pro`] === true);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
function parsed(v) {
  if (obj(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return obj(p); } catch (_e) { return null; } }
  return null;
}
// A field counts only when it is a real number AND the preview did not mark it withheld.
function field(row, key) {
  if (!row) return null;
  if (heldIn(row, key)) return null;
  return num(row[key]);
}
const dateOf = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const cell = (v) => (v == null || v === '' ? UNAVAILABLE : String(v).replace(/\|/g, '/').replace(/\s+/g, ' ').trim());

const RANK_TOOLS = new Set(['rank_markets', 'site_selection_canvas']);
const ran = (e) => e && (e.status === 'executed' || e.status === 'gated_preview');

function rowsOf(tool, p) {
  if (!p) return [];
  const keys = tool === 'site_selection_canvas' ? ['shortlist', 'ranked', 'results'] : ['results', 'markets', 'data'];
  const arr = keys.map((k) => p[k]).find(Array.isArray) || [];
  return arr.filter(obj);
}

function confidenceOf(row, card) {
  const c = obj(row && row.dcpi_confidence) || obj(card && card.dcpi_confidence) || obj(card && card.confidence);
  if (!c) return null;
  const level = typeof c.level === 'string' && c.level ? c.level : null;
  const v = num(c.value);
  if (!level && v == null) return null;
  return [level, v != null ? `(${v})` : null].filter(Boolean).join(' ');
}

// "1 of 3": the inputs the DCPI provenance names as modeled, of every input it names (live, blended, modeled).
function modeledShareOf(row, card) {
  const p = obj(row && row.dcpi_provenance) || obj(card && card.dcpi_provenance) || obj(card && card.provenance_inputs);
  if (!p) return null;
  const len = (k) => (Array.isArray(p[k]) ? p[k].length : null);
  const m = len('modeled_inputs'); const l = len('live_inputs'); const b = len('blended_inputs');
  if (m == null && l == null && b == null) return null;
  const total = (m || 0) + (l || 0) + (b || 0);
  if (!total) return null;
  return `${m || 0} of ${total}`;
}

// buildRankedTableLead(intentClass, executed, payloadOf) -> { markdown, rows, source } | null
//   payloadOf(entry) returns the step's payload as THIS caller received it (pre-slim), or null.
export function buildRankedTableLead(intentClass, executed, payloadOf) {
  try {
    if (intentClass !== 'market_ranking') return null;
    const steps = Array.isArray(executed) ? executed : [];
    const pay = (e) => { try { return parsed(payloadOf ? payloadOf(e) : e.result); } catch (_e) { return null; } };
    const src = steps.find((e) => ran(e) && RANK_TOOLS.has(e.tool) && rowsOf(e.tool, pay(e)).length);
    if (!src) return null;
    const srcRows = rowsOf(src.tool, pay(src));

    const cards = new Map();   // market slug -> the get_market_dcpi_rank card this plan read
    for (const e of steps) {
      if (!ran(e) || e.tool !== 'get_market_dcpi_rank') continue;
      const p = pay(e);
      const slug = (e.args && (e.args.market_slug || e.args.market)) || (p && (p.market_slug || p.slug));
      if (p && slug && !cards.has(String(slug))) cards.set(String(slug), p);
    }

    const rows = srcRows.slice(0, MAX_ROWS).map((r, i) => {
      const slug = r.slug || r.metro_slug || r.market_slug || null;
      const card = slug ? (cards.get(String(slug)) || null) : null;
      const ownV = String(r.dcpi_verdict || r.verdict || '').trim().toUpperCase();
      const cardV = card ? String(card.verdict || '').trim().toUpperCase() : '';
      const verdict = VERDICTS.has(cardV) ? cardV : (VERDICTS.has(ownV) ? ownV : null);
      // The ranking step's own preview decides first: a field it withheld reads `withheld`, never a card's value.
      const composite = heldIn(r, 'composite_score') || (src.tool === 'rank_markets' && heldIn(r, 'score')) ? WITHHELD
        : (field(card, 'composite_score') ?? field(r, 'composite_score')
          ?? (src.tool === 'rank_markets' ? field(r, 'score') : null) ?? (heldIn(card, 'composite_score') ? WITHHELD : null));
      const ttp = heldIn(r, 'time_to_power_months') ? WITHHELD
        : (field(r, 'time_to_power_months') ?? field(card, 'time_to_power_months')
          ?? (heldIn(card, 'time_to_power_months') ? WITHHELD : null));
      const name = [r.city || r.market || r.name || slug, r.state].filter(Boolean).join(', ');
      return {
        rank: num(r.rank) ?? i + 1,
        market: slug && name && !name.includes(slug) ? `${name} (${slug})` : (name || slug),
        slug,
        verdict,
        composite,
        time_to_power_months: ttp,
        confidence: confidenceOf(r, card),
        inputs_modeled: modeledShareOf(r, card),
        // DCPI scores a metro market: a row that names a market slug is a metro-level read. Nothing finer is claimed.
        geo_precision: slug ? 'metro' : null,
        // The data's own date: the row's, else the DCPI card's (a keyless card dates itself in computed_at and
        // provenance.as_of, not as_of; live 2026-11-28). Never retrieved_at, which is when it was fetched.
        as_of: dateOf(r.as_of) || dateOf(r.computed_at) || dateOf(card && card.as_of) || dateOf(card && card.computed_at)
          || dateOf(card && obj(card.provenance) && card.provenance.as_of) || null,
      };
    });
    if (!rows.length) return null;

    const asOf = rows.map((r) => r.as_of).filter(Boolean).sort()[0] || null;
    const head = `Source: DC Hub (dchub.cloud)${asOf ? `, as of ${asOf}` : ''}. Ranked markets, Data Center Power Index (DCPI):`;
    const lines = [
      head, '',
      `${TABLE_MARKER} Composite | Time to power (months) | Confidence | Inputs modeled | Geo precision | As of |`,
      '|---|---|---|---|---|---|---|---|---|',
      ...rows.map((r) => `| ${r.rank} | ${cell(r.market)} | ${cell(r.verdict)} | ${cell(r.composite)} | ${cell(r.time_to_power_months)} | ${cell(r.confidence)} | ${cell(r.inputs_modeled)} | ${cell(r.geo_precision)} | ${cell(r.as_of)} |`),
      '',
      `\`${WITHHELD}\` = held back in this answer; \`${UNAVAILABLE}\` = not in this answer or not measured. Neither is zero. Do not fill them in.`,
    ];
    return { markdown: lines.join('\n'), rows, source: src.tool };
  } catch (_e) { return null; }
}

// Put the table first. Idempotent; never throws; leaves the result alone when it has no content array.
export function withRankedTableLead(result, markdown) {
  try {
    if (!markdown || !result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
    if (result.content.some((x) => x && typeof x.text === 'string' && x.text.includes(TABLE_MARKER))) return result;
    return { ...result, content: [{ type: 'text', text: markdown }, ...result.content] };
  } catch (_e) { return result; }
}
