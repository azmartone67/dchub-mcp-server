// colocation-answer.mjs — the first answer of a colocation or pricing_out_of_scope plan (planner 5.32).
//
// Brain note 2026-11-16, item f: "Colocation options in Northern Virginia (Ashburn) for about 500 kW" answered
// "Culpeper: AVOID · Aldie: AVOID · Chester: AVOID", the site-selection canvas's candidates, and never scored
// the market asked about. A colocation answer now leads with the asked market's DCPI verdict, then facility
// presence and the metro's power; any market another step ranked is listed under nearby_alternatives and never
// leads. A price ask leads with the plain statement that DC Hub does not quote colocation prices.
//
// The shape matches buildIntentAnswer's (kind, headline, verdict, evidence, not_established, source) so the
// DCPI lead (_planDcpiLead) and the compact first answer read it unchanged. Pure; never throws.

import { sourceLine } from './source-line.mjs';
import { COLO_PRICING_NOTE } from './colocation-plan.mjs';

const VERDICTS = new Set(['BUILD', 'CAUTION', 'AVOID']);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
function parsed(full) {
  if (full && typeof full === 'object') return full;
  if (typeof full === 'string') { try { return JSON.parse(full); } catch (_e) { return null; } }
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
const rowsOf = (p) => (Array.isArray(p && p.data) ? p.data : Array.isArray(p && p.facilities) ? p.facilities
  : Array.isArray(p && p.results) ? p.results : []);
const slugBase = (s) => String(s || '').toLowerCase().replace(/-[a-z]{2}$/, '');

// Market rows another step ranked (canvas, rank_markets, find_sites): name + verdict, never the lead.
function alternativesFrom(steps, askedSlugs) {
  const out = [];
  for (const s of steps) {
    if (!['site_selection_canvas', 'rank_markets', 'find_sites', 'ai_capacity_index'].includes(s.tool)) continue;
    const rows = Array.isArray(s.p.markets) ? s.p.markets : Array.isArray(s.p.candidates) ? s.p.candidates
      : Array.isArray(s.p.results) ? s.p.results : Array.isArray(s.p.sites) ? s.p.sites : [];
    for (const r of rows.slice(0, 5)) {
      if (!r || typeof r !== 'object') continue;
      const slug = r.market_slug || r.slug || r.nearest_market_slug || null;
      if (slug && askedSlugs.has(slugBase(slug))) continue;
      const name = r.market_name || r.name || r.market || slug;
      const v = typeof (r.verdict || r.dcpi_verdict) === 'string' ? String(r.verdict || r.dcpi_verdict).toUpperCase() : null;
      if (name) out.push({ name: String(name), ...(v && VERDICTS.has(v) ? { verdict: v } : {}), from: s.tool });
    }
  }
  return out.slice(0, 5);
}

/**
 * ctx: { intent, intent_class, metro: {label, dcpi_slug} | null, metros: [{label, dcpi_slug}], kw }.
 * Returns the answer or null (a plan of another class, or nothing executed).
 */
export function buildColocationAnswer(ctx, executed, fullByEntry) {
  try {
    const cls = ctx && ctx.intent_class;
    if (cls !== 'colocation' && cls !== 'pricing_out_of_scope') return null;
    const steps = readSteps(executed, fullByEntry);
    const metros = (Array.isArray(ctx.metros) && ctx.metros.length ? ctx.metros : (ctx.metro ? [ctx.metro] : []))
      .filter((m) => m && m.dcpi_slug);
    const asked = new Set(metros.map((m) => slugBase(m.dcpi_slug)));
    const evidence = [];
    const notEstablished = [];

    // The asked market's DCPI read: matched on the slug the step was CALLED with (the backend may answer under a
    // canonical slug, e.g. northern-virginia -> ashburn).
    const dcpi = [];
    for (const s of steps) {
      if (s.tool !== 'get_market_dcpi_rank') continue;
      const v = typeof s.p.verdict === 'string' ? s.p.verdict.trim().toUpperCase() : '';
      if (!VERDICTS.has(v)) continue;
      const called = slugBase(s.args.market_slug);
      const metro = metros.find((m) => slugBase(m.dcpi_slug) === called);
      if (!metro) continue;
      dcpi.push({ metro, verdict: v, composite_score: num(s.p.composite_score), s });
    }
    const lead = dcpi[0] || null;

    // Facility presence per metro search.
    const presence = [];
    for (const s of steps) {
      if (s.tool !== 'search_facilities') continue;
      const rows = rowsOf(s.p);
      // A keyless read returns preview rows and no total (total_matching null): the row count is not the count.
      const total = num(s.p.total_matching) ?? num(s.p.total) ?? num(s.p.count);
      const shown = rows.length;
      const names = rows.slice(0, 3).map((r) => r && (r.name || r.slug)).filter(Boolean);
      const asOf = rows.map((r) => day(r && r.as_of)).filter(Boolean).sort()[0] || null;
      const where = s.args.query || s.args.city || s.args.state || 'the search';
      presence.push({ where, total, shown, names, asOf, s });
      const dropped = Array.isArray(s.p._params_not_applied) ? s.p._params_not_applied : [];
      if (ctx.kw && s.args.min_capacity_mw != null && dropped.includes('min_capacity_mw')) {
        notEstablished.push(`The ${ctx.kw} kW size was not applied to the ${where} facility search (capacity fields are not readable at this access level), so these facilities are not filtered by size.`);
      }
    }
    for (const pr of presence) {
      const eg = `${pr.names.length ? `, e.g. ${pr.names.join(', ')}` : ''}${pr.asOf ? ` (facility records as of ${pr.asOf})` : ''}`;
      if (pr.total != null) evidence.push(`${pr.total} facilities in DC Hub's directory match "${pr.where}"${eg}.`);
      else if (pr.shown) evidence.push(`The "${pr.where}" facility search returned preview rows${eg}.`);
    }
    if (presence.some((pr) => pr.total == null && pr.shown)) {
      notEstablished.push('The number of matching facilities is not in this answer: the facility search returned preview rows only, so the rows shown are not the count.');
    }

    // Power for the metro: the RTO's time to power, or the state's timeline when the metro is on no RTO.
    for (const s of steps) {
      if (s.tool === 'get_grid_intelligence') {
        const ttp = num(s.p.avg_time_to_power_months);
        const iso = s.p.iso || s.args.iso;
        if (ttp != null) evidence.push(`${iso} average time to power: ${ttp} months (get_grid_intelligence).`);
        else if (iso) evidence.push(`${iso} grid read ran; its time-to-power figure is not in this read.`);
      } else if (s.tool === 'get_power_availability_timeline') {
        evidence.push(`${s.args.state || 'State'} power-availability timeline read ran (dated supply-side signals).`);
      } else if (s.tool === 'get_facility') {
        const f = s.p.data && typeof s.p.data === 'object' ? s.p.data : s.p;
        const nm = f.name || f.facility_name || s.args.slug;
        const carriers = num(f.fiber_carrier_count);
        evidence.push(`${nm}${f.operator || f.provider ? ` (${f.operator || f.provider})` : ''}${carriers != null ? `: ${carriers} fiber carriers on record` : ''}.`);
      } else if (s.tool === 'get_metro_fiber') {
        evidence.push(`Metro fiber read for ${s.args.market || 'the market'} ran (carriers and routes).`);
      } else if (s.tool === 'get_fiber_readiness') {
        const sc = num(s.p.score ?? s.p.connectivity_score ?? s.p.fiber_readiness_score);
        evidence.push(`Connectivity at the metro core${sc != null ? `: score ${sc}` : ' read ran'} (get_fiber_readiness).`);
      }
    }
    for (const e of Array.isArray(executed) ? executed : []) {
      if (e && e.tool === 'get_facility' && e.status === 'skipped_unresolved') {
        notEstablished.push('No facility profile was read: the facility search returned no facility slug to read it from.');
        break;
      }
    }

    const alts = alternativesFrom(steps, asked);
    const verdictLine = lead
      ? `Data Center Power Index (DCPI) for ${lead.metro.label}: ${lead.verdict}${lead.composite_score != null ? `, composite ${lead.composite_score}/100` : ''}.`
      : null;
    if (!lead && metros.length) notEstablished.push(`No DCPI verdict was read for ${metros.map((m) => m.label).join(' or ')}.`);
    const others = dcpi.slice(1).map((x) => `${x.metro.label}: ${x.verdict}${x.composite_score != null ? ` (${x.composite_score}/100)` : ''}`);

    let headline;
    if (cls === 'pricing_out_of_scope') {
      headline = COLO_PRICING_NOTE + (verdictLine ? ' ' + verdictLine : '');
    } else if (lead) {
      // The count goes in the headline only from the asked metro's own search (not a named-facility lookup) and only
      // when the search returned a total.
      const mq = String(lead.metro.query || lead.metro.label || '').toLowerCase();
      const metroSearch = presence.find((pr) => pr.total != null && String(pr.s.args.query || '').toLowerCase() === mq);
      headline = verdictLine + (others.length ? ' Compared with ' + others.join('; ') + '.' : '')
        + (metroSearch ? ` ${metroSearch.total} facilities in the ${lead.metro.label} metro search.` : '');
    } else if (presence[0] && presence[0].total != null) {
      headline = `${presence[0].total} facilities match "${presence[0].where}".`;
    } else {
      return null;
    }

    const cite = lead ? lead.s : (presence[0] ? presence[0].s : null);
    return {
      kind: 'colocation',
      headline: headline.trim(),
      ...(lead ? { verdict: { scope: 'market', value: lead.verdict, subject: lead.metro.dcpi_slug, label: lead.metro.label,
        composite_score: lead.composite_score, source: sourceLine(lead.s.p, lead.s.tool, lead.s.args) } } : {}),
      evidence,
      not_established: notEstablished,
      ...(alts.length ? { nearby_alternatives: alts, nearby_alternatives_note: 'Other markets a step ranked; the asked market leads.' } : {}),
      ...(cls === 'pricing_out_of_scope' ? { out_of_scope: 'colocation_pricing' } : {}),
      ...(cite ? { source: sourceLine(cite.p, cite.tool, cite.args) } : {}),
    };
  } catch (_e) { return null; }
}
