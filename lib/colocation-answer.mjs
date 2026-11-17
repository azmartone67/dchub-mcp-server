// colocation-answer.mjs — the first answer of a colocation or pricing_out_of_scope plan (planner 5.32).
//
// Brain note 2026-11-16, item f: "Colocation options in Northern Virginia (Ashburn) for about 500 kW" answered
// "Culpeper: AVOID · Aldie: AVOID · Chester: AVOID", the site-selection canvas's candidates, and never scored
// the market asked about. A colocation answer now leads with the asked market's DCPI verdict, then facility
// presence and the metro's power; any market another step ranked is listed under nearby_alternatives and never
// leads. A price ask leads with the plain statement that DC Hub does not publish colocation pricing.
//
// The shape matches buildIntentAnswer's (kind, headline, verdict, evidence, not_established, source) so the
// DCPI lead (_planDcpiLead) and the compact first answer read it unchanged. Pure; never throws.

import { sourceLine, dataAsOfDay } from './source-line.mjs';
import { COLO_PRICING_NOTE } from './colocation-plan.mjs';
import { factsFromExecuted, addressMatches } from './plan-step-facts.mjs';

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

// A named facility pair, side by side (Grok re-run 2026-11-17, Q-b: the lead was the market's DCPI, not the two
// facilities). Each side: the search that resolved it, the profile get_facility read, and the record date the search
// row carried. Only fields the steps returned; what neither read carries is listed as not established.
const PAIR_GAPS = [['power_mw', 'power capacity'], ['fiber_carrier_count', 'fiber carrier count'], ['available_kw', 'available space']];
function pairSides(pair, steps) {
  const out = [];
  const facs = steps.filter((s) => s.tool === 'get_facility');
  [pair.a, pair.b].forEach((asked, i) => {
    const q = String(asked || '').toLowerCase();
    const search = steps.find((s) => s.tool === 'search_facilities' && String(s.args.query || '').toLowerCase() === q);
    const rows = search ? rowsOf(search.p) : [];
    const fac = facs.find((f) => rows.some((r) => r && r.slug && r.slug === f.args.slug)) || facs[i] || null;
    const d = fac ? (fac.p.data && typeof fac.p.data === 'object' ? fac.p.data : fac.p) : {};
    const row = rows.find((r) => r && fac && r.slug === fac.args.slug) || rows[0] || {};
    const name = d.name || d.facility_name || row.name || null;
    if (!name) { out.push({ asked, resolved: false }); return; }
    const has = (k) => d[k] != null && d[k] !== '' || (k === 'power_mw' && (num(d.power_capacity_mw) != null || num(d.capacity_mw) != null));
    out.push({ asked, resolved: true, name: String(name), operator: d.operator || d.provider || row.operator || null,
      place: [d.city || row.city, d.state || row.state].filter(Boolean).join(', ') || null,
      status: d.status || null, as_of: day(row.as_of) || day(d.as_of) || day(d.updated_at),
      carriers: num(d.fiber_carrier_count), gaps: PAIR_GAPS.filter(([k]) => !has(k)).map(([, label]) => label) });
  });
  return out;
}
const sideLine = (x) => `${x.name} (${[x.operator, x.place, x.status, x.as_of ? `record as of ${x.as_of}` : null].filter(Boolean).join(', ')}`
  + `${x.carriers != null ? `; ${x.carriers} fiber carriers on record` : ''})`;

/**
 * ctx: { intent, intent_class, metro: {label, dcpi_slug} | null, metros: [{label, dcpi_slug}], kw,
 *        pair: {a, b} | null (two named facilities), address: "350 E Cermak" | null }.
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
      // One date per row (Grok midday re-run 2026-11-17, Q-b): the lead said DA11 "record as of 2026-11-17" while this
      // line stamped the oldest row's 2026-03-30 on the set. Rows sharing one date keep one stamp; mixed dates go per row.
      const shownRows = rows.slice(0, 3).filter((r) => r && (r.name || r.slug));
      const rowDays = [...new Set(shownRows.map((r) => day(r.as_of)).filter(Boolean))];
      const asOf = rowDays.length === 1 ? rowDays[0] : null;
      const names = shownRows.map((r) => `${r.name || r.slug}${!asOf && day(r.as_of) ? ` (record as of ${day(r.as_of)})` : ''}`);
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
      } else if (s.tool === 'get_peering_intel') {
        // PeeringDB counts, not the derived score (the tool's own rule); withheld counts are left out, never guessed.
        const c = s.p.connectivity && typeof s.p.connectivity === 'object' ? s.p.connectivity : s.p;
        const parts = [];
        const fac = num(c.facilities_nearby); if (fac != null) parts.push(`${fac} facilities nearby`);
        const ix = num(c.total_ix_presence); if (ix != null) parts.push(`${ix} IX presences`);
        const nets = num(c.total_networks); if (nets != null) parts.push(`${nets} networks`);
        const top = (Array.isArray(c.top_facilities) ? c.top_facilities : []).map((f) => f && f.name).filter(Boolean).slice(0, 3);
        evidence.push(`Peering at the metro core (PeeringDB)${parts.length ? `: ${parts.join(', ')}` : ' read ran'}${top.length ? `; led by ${top.join(', ')}` : ''} (get_peering_intel).`);
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

    // Dated driver and fiber facts the steps returned (energy rate, incentive status, timeline, on-net / key endpoint).
    const facts = factsFromExecuted(executed, fullByEntry, { address: ctx.address || null });
    for (const f of facts) if (!evidence.includes(f.text)) evidence.push(f.text);
    const sides = ctx.pair && ctx.pair.a && ctx.pair.b ? pairSides(ctx.pair, steps) : [];
    for (const x of sides) {
      if (!x.resolved) notEstablished.push(`"${x.asked}" did not resolve to a facility in DC Hub's directory in this read.`);
      else if (x.gaps.length) notEstablished.push(`${x.name}: ${x.gaps.join(', ')} not in this read.`);
    }
    // A named address resolved as the facility asked about (Q-f: "near 350 E Cermak" read QTS Chicago instead).
    if (ctx.address) {
      const hit = steps.find((s) => s.tool === 'get_facility' && addressMatches(
        [s.p.data && s.p.data.name, s.p.name, s.p.data && s.p.data.address, s.p.address].filter(Boolean).join(' '), ctx.address));
      // Say why: a profile cut by the step budget is not "no facility row at that address" (Grok midday re-run, Q-f).
      const cut = (Array.isArray(executed) ? executed : []).find((e) => e && e.tool === 'get_facility' && e.status === 'not_run');
      if (!hit && cut) notEstablished.push(`No facility profile at ${ctx.address} was read: get_facility was not run because the plan reached its step limit (${cut.note || 'max_steps'}), not because no facility is at that address; call get_facility with the address search's slug.`);
      else if (!hit) notEstablished.push(`No facility profile at ${ctx.address} was read; the facts below are for the address and the metro.`);
    }

    const alts = alternativesFrom(steps, asked);
    const dcpiDay = lead ? dataAsOfDay(lead.s.p) : null;
    const verdictLine = lead
      ? `Data Center Power Index (DCPI) for ${lead.metro.label}: ${lead.verdict}${lead.composite_score != null ? `, composite ${lead.composite_score}/100` : ''}${dcpiDay ? ` (as of ${dcpiDay})` : ''}.`
      : null;
    if (!lead && metros.length) notEstablished.push(`No DCPI verdict was read for ${metros.map((m) => m.label).join(' or ')}.`);
    const others = dcpi.slice(1).map((x) => `${x.metro.label}: ${x.verdict}${x.composite_score != null ? ` (${x.composite_score}/100)` : ''}`);

    let headline;
    const fiberFacts = facts.filter((f) => f.tool === 'get_metro_fiber' || f.tool === 'get_fiber_readiness');
    const driverFacts = facts.filter((f) => f.tool === 'get_energy_prices' || f.tool === 'get_tax_incentives');
    if (cls === 'pricing_out_of_scope') {
      // At least one dated driver figure rides the lead (Q-c: the drivers were named, none was shown).
      headline = COLO_PRICING_NOTE + (driverFacts[0] ? ' ' + driverFacts[0].text : '') + (verdictLine ? ' ' + verdictLine : '');
    } else if (sides.length && sides.some((x) => x.resolved)) {
      headline = sides.map((x) => (x.resolved ? sideLine(x) : `"${x.asked}" (not resolved)`)).join(' vs ') + '.'
        + (verdictLine ? ' ' + verdictLine : '');
    } else if (ctx.address && fiberFacts.length) {
      headline = fiberFacts.slice(0, 2).map((f) => f.text).join(' ') + (verdictLine ? ' ' + verdictLine : '');
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
      ...(sides.length ? { side_by_side: sides } : {}),
      ...(cls === 'pricing_out_of_scope' ? { out_of_scope: 'colocation_pricing' } : {}),
      ...(cite ? { source: sourceLine(cite.p, cite.tool, cite.args) } : {}),
    };
  } catch (_e) { return null; }
}
