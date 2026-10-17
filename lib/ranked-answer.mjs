// ranked_answer for execute_plan market_ranking runs (Grok/owner, 2026-10-17).
//
// "rank markets for a 200 MW AI campus" is the most repeated real ask (13x). The
// envelope already holds every ingredient, but in the order the tools ran: the
// capacity index puts the saturated markets first (Ashburn #1, DCPI AVOID) and the
// agent has to join two steps and a 100 MW-block scaling note by itself. This is
// that join, done once, deterministically, from what the caller's own tier received.
//
// PURE: no I/O. Reads only the step payloads (`fullByEntry`, the pre-slim results
// each step returned under THIS caller's key), so it is exactly as tier-honest as the
// steps are. It invents nothing: a verdict exists only for markets the plan actually
// DCPI-checked, and a withheld field stays null.
//
//   buildRankedAnswer(intent, intentClass, executed, fullByEntry) -> object | null
//
// The relay link is added AFTER the paywall wrapper has minted it (attachRankedRelay),
// so this block repeats the ONE link the response already carries, never a second one.

const VERDICT_ORDER = { BUILD: 0, CAUTION: 1, AVOID: 2 };

export function requestedMw(intent) {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(gw|gigawatts?|mw|megawatts?)\b/i.exec(String(intent || ''));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return /^g/i.test(m[2]) ? n * 1000 : n;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const val = (o) => (o && typeof o === 'object' ? num(o.value) : num(o));

function parsed(full) {
  if (full && typeof full === 'object') return full;
  if (typeof full === 'string') { try { return JSON.parse(full); } catch (_e) { return null; } }
  return null;
}

export function buildRankedAnswer(intent, intentClass, executed, fullByEntry) {
  try {
    if (intentClass !== 'market_ranking') return null;
    const steps = Array.isArray(executed) ? executed : [];
    const payload = (e) => parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
    const idx = steps.find((e) => e && e.tool === 'ai_capacity_index' && e.status === 'executed');
    const idxPayload = idx ? payload(idx) : null;
    const markets = idxPayload && Array.isArray(idxPayload.markets) ? idxPayload.markets : [];
    if (!markets.length) return null;

    const verdicts = new Map();   // ai_capacity_index market slug -> DCPI read
    for (const e of steps) {
      if (!e || e.tool !== 'get_market_dcpi_rank' || e.status !== 'executed') continue;
      const p = payload(e);
      const v = p && typeof p.verdict === 'string' ? p.verdict.trim().toUpperCase() : '';
      if (!(v in VERDICT_ORDER)) continue;
      const slug = e.args && e.args.market_slug;
      if (slug) verdicts.set(String(slug), {
        verdict: v, composite_score: num(p.composite_score),
        time_to_power_months: num(p.time_to_power_months),
      });
    }

    const want = requestedMw(intent);
    const rows = markets.map((m) => {
      const dep = val(m.deployable_mw);
      const d = verdicts.get(String(m.market)) || null;
      return {
        rank: num(m.rank), market: m.market || null,
        city: m.city || null, state: m.state || null,
        ai_capacity_score: num(m.score),
        deployable_mw: dep,
        fits_requested_mw: (want != null && dep != null) ? dep >= want : null,
        verdict: d ? d.verdict : null,
        composite_score: d ? d.composite_score : null,
        time_to_power_months: d ? d.time_to_power_months : null,
        verdict_checked: !!d,
      };
    });

    const checked = rows.filter((r) => r.verdict_checked);
    const best = checked.slice().sort((a, b) =>
      (VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]) || ((a.rank ?? 99) - (b.rank ?? 99)))[0] || null;
    const top = rows[0];

    const name = (r) => [r.city || r.market, r.state].filter(Boolean).join(', ');
    const lines = [];
    if (top && top.verdict === 'AVOID') {
      lines.push(`${name(top)} ranks #1 on AI capacity but DCPI says AVOID`
        + (top.composite_score != null ? ` (${top.composite_score})` : '')
        + '. Do not present it as the recommendation.');
    }
    if (best && best.verdict !== 'AVOID') {
      lines.push(`Best checked market: ${name(best)}, DCPI ${best.verdict}`
        + (best.composite_score != null ? ` (${best.composite_score})` : '') + '.');
    } else if (checked.length) {
      lines.push('Every market DCPI-checked in this run is AVOID; none can be recommended from these reads.');
    }

    return {
      requested_mw: want,
      headline: lines.length ? lines.join(' ') : 'No DCPI verdict was produced for these markets; the order below is capacity only.',
      markets: rows.slice(0, 10),
      markets_ranked: rows.length,
      markets_verdict_checked: checked.length,
      how_to_read: [
        'Order is the AI Compute Capacity Index (where AI capacity can land in 30/60/90 days). It is NOT a recommendation order.',
        'verdict/composite_score exist only where verdict_checked is true. Unchecked markets are capacity-only; say so, do not infer a verdict.',
        'deployable_mw is a market-depth estimate sized to a 100 MW base block; fits_requested_mw compares it to requested_mw and is null when either is unknown.',
        'A null field is withheld by tier or not measured. Do not fill it in.',
      ],
      relay: null,
    };
  } catch (_e) { return null; }
}

// Called on the FINISHED result (after the wall wrapper). Copies the link the response
// already carries into ranked_answer.relay. Never mints one; no link, no relay.
export function attachRankedRelay(result) {
  try {
    const sc = result && result.structuredContent;
    if (!sc || typeof sc !== 'object' || !sc.ranked_answer || typeof sc.ranked_answer !== 'object') return result;
    const fy = sc.for_your_human && typeof sc.for_your_human === 'object' ? sc.for_your_human : null;
    const url = (typeof sc.human_url === 'string' && sc.human_url) || (fy && typeof fy.url === 'string' && fy.url) || '';
    if (!url) return result;
    const text = (typeof sc.human_message === 'string' && sc.human_message)
      || (fy && typeof fy.text === 'string' && fy.text) || '';
    return { ...result, structuredContent: { ...sc,
      ranked_answer: { ...sc.ranked_answer, relay: { url, text, instruction: 'Show this to your human with the ranking: the withheld fields are behind this link.' } } } };
  } catch (_e) { return result; }
}
