// =============================================================================
// registry-description — the registry `description` fields, rendered from canon.
// -----------------------------------------------------------------------------
// server.json, smithery.yaml and mcp-server.json each carry a `description`
// that a registry shows verbatim. They were hand-authored prose with canon
// numbers pasted in, healed number-by-number (applyQuantities) — which keeps a
// figure fresh but cannot say the three files agree, because nothing owned the
// sentence around the figure. Now one template owns it:
//
//   canonical/registry-description-template.json   the prose, with {slots}
//   this module                                     slot values + renderer
//   sync-tools-manifest.mjs --fix                   writes the render
//   sync-tools-manifest.mjs (check)                 fails when a file differs
//
// SLOT SOURCES (all committed, so CHECK mode needs no network):
//   canonical/mcp_facts.json      numbers.*, grid_coverage.*, facility_count
//   canonical/canon_phrases.json  headline phrases (countries, deals, ...)
//   lib/tier-canon.mjs            free-tier rule text, credit pack
//   server.mjs registrations      tool_count (passed in by the caller)
// The live GET https://dchub.cloud/api/v1/canon is an OPTIONAL cross-check
// (liveCompare): it warns, it never fails.
//
// FAIL CLOSED: a slot with no value, a malformed value, a template placeholder
// with no slot, or a facility count that is no longer withheld all throw. A
// facility NUMBER is never rendered: while facility_count.status is
// "corroboration_pending" the only facility text is the pending phrase.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATE_PATH = 'canonical/registry-description-template.json';
export const TARGETS = ['server_json', 'smithery_yaml', 'mcp_server_json'];
/** The official registry schema caps `description` at 100 characters. */
export const SERVER_JSON_MAX = 100;
export const CANON_LIVE_URL = 'https://dchub.cloud/api/v1/canon';

const readJSON = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
// facts publish floors as "182k"; a comma form ("911,000+") is accepted as-is
// (minus the +) so the quantity guard, not this renderer, is what names a bad figure.
const commaK = (v) => {
  const s = String(v);
  const k = /^(\d{1,3})k$/.exec(s);
  if (k) return `${k[1]},000`;
  const c = /^(\d{1,3}(?:,\d{3})+)\+?$/.exec(s);
  if (!c) throw new Error(`expected "<n>k" or "n,nnn", got ${JSON.stringify(v)}`);
  return c[1];
};
const floorTen = (n) => `${Math.floor(Number(n) / 10) * 10}+`;
const need = (cond, msg) => { if (!cond) throw new Error(`registry-description: ${msg}`); };

/** Slot values from the committed files. `count` is the registered tool count. */
export function buildSlots({ count, facts, phrases, tier }) {
  need(Number.isInteger(count) && count > 0, `tool_count ${count} is not a positive integer`);
  const fc = facts.facility_count || {};
  need(fc.status === 'corroboration_pending',
    `facility_count.status is ${JSON.stringify(fc.status)}, not "corroboration_pending". The template has no facility-number wording; `
    + 'write it (and the owner-approved phrasing) before rendering one.');
  const pending = /\(corroborated count pending\)/.exec(fc.public_phrase || '');
  need(pending, 'facility_count.public_phrase has no "(corroborated count pending)" clause');
  need(typeof fc.prose === 'string' && !/\d/.test(fc.prose), 'facility_count.prose is missing or contains a digit');
  const n = facts.numbers || {};
  const g = facts.grid_coverage || {};
  const slots = {
    tool_count: String(count),
    live_feeds: String(n.live_feeds),
    us_isos: String(g.us_isos),
    eia_ba_floor: floorTen(g.eia_balancing_authorities),
    eu_zones: String(g.eu_entsoe_zones),
    generating_units_global: n.generating_units_global,
    power_plants_us: n.power_plants_us,
    gas_pipelines: n.gas_pipelines,
    countries: phrases.countries,
    markets: phrases.markets,
    deals: phrases.deals,
    substations: phrases.substations,
    transmission_lines: phrases.transmission_lines,
    fiber_routes: phrases.fiber_routes,
    facility_prose: fc.prose,
    facility_pending: pending[0],
    free_tier_rule: tier.freeTierRule,
    free_key_full: String(tier.freeKeyFull),
    identified_calls: String(tier.identifiedCalls),
    pack_usd: String(tier.pack.price_usd),
    pack_credits: Number(tier.pack.credits).toLocaleString('en-US'),
  };
  for (const [k, v] of Object.entries(slots)) need(typeof v === 'string' && v && v !== 'undefined' && v !== 'NaN', `slot ${k} has no value`);
  return slots;
}

const FILTERS = {
  k: commaK,
  bare: (v) => String(v).replace(/\+$/, ''),
};

/** Render one template string. Unknown slot or filter throws. */
export function renderTemplate(tpl, slots) {
  return tpl.replace(/\{([a-z_]+)(?:\|([a-z]+))?\}/g, (_, name, filter) => {
    need(Object.prototype.hasOwnProperty.call(slots, name), `template slot {${name}} has no value`);
    if (!filter) return slots[name];
    need(FILTERS[filter], `unknown filter |${filter} on {${name}}`);
    return FILTERS[filter](slots[name]);
  });
}

/** { server_json, smithery_yaml, mcp_server_json } → rendered description text. */
export function renderAll(ctx, template = readJSON(TEMPLATE_PATH)) {
  const slots = buildSlots(ctx);
  const out = {};
  for (const t of TARGETS) {
    need(typeof template[t] === 'string' && template[t], `template.${t} is missing`);
    out[t] = renderTemplate(template[t], slots);
    need(!/[{}]/.test(out[t]), `${t} still contains a brace after rendering`);
  }
  need(out.server_json.length <= SERVER_JSON_MAX,
    `server_json description is ${out.server_json.length} chars; the registry schema caps it at ${SERVER_JSON_MAX}`);
  return out;
}

/** Offline context from the committed files. */
export async function loadContext(count, { facts, phrases } = {}) {
  const tc = await import('../lib/tier-canon.mjs');
  return {
    count,
    facts: facts ?? readJSON('canonical/mcp_facts.json'),
    phrases: phrases ?? readJSON('canonical/canon_phrases.json'),
    tier: {
      freeTierRule: tc._freeTierRuleText(),
      freeKeyFull: tc._fullAnswersPerToolPerDay('free'),
      identifiedCalls: tc.FREE_TIER.identified_calls_per_day,
      pack: tc.TIER_CANON.credit_pack,
    },
  };
}

/** The `description:` line of smithery.yaml (a JSON-quoted scalar on one line). */
export const SMITHERY_DESC_RX = /^description:[ \t]*(.+)$/m;

/** Live GET /api/v1/canon vs what we render from. Returns warnings only. */
export async function liveCompare(ctx, fetchImpl = globalThis.fetch) {
  const warns = [];
  let live;
  try {
    const r = await fetchImpl(`${CANON_LIVE_URL}?_=${Date.now()}`, { headers: { Accept: 'application/json', 'User-Agent': 'dchub-registry-description/1.0' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    live = await r.json();
  } catch (e) { return { observed: false, warns: [`live canon unreadable (${e.message}); offline render only`] }; }
  const cmp = (label, liveV, localV) => { if (liveV !== undefined && String(liveV) !== String(localV)) warns.push(`${label}: live canon ${JSON.stringify(liveV)} != committed ${JSON.stringify(localV)}`); };
  cmp('tools.surfaces.mcp', live.tools?.surfaces?.mcp, ctx.count);
  for (const k of ['countries', 'markets', 'deals', 'substations', 'transmission_lines', 'fiber_routes', 'assets']) cmp(`headline_phrases.${k}`, live.headline_phrases?.[k], ctx.phrases[k]);
  cmp('prices.credit_pack.price_usd', live.prices?.credit_pack?.price_usd, ctx.tier.pack.price_usd);
  cmp('prices.credit_pack.credits', live.prices?.credit_pack?.credits, ctx.tier.pack.credits);
  cmp('free_tier', live.free_tier, ctx.tier.freeTierRule);
  if (live.facilities?.status && live.facilities.status !== ctx.facts.facility_count?.status) warns.push(`facilities.status: live ${live.facilities.status} != committed ${ctx.facts.facility_count?.status}`);
  return { observed: true, warns };
}
