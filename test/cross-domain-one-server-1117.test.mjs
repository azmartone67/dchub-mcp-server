// Grok -> Brain 2026-11-17, "make 'data center + energy in one server' the reason agents pick DC Hub", item 1.
// The handshake's second sentence (CROSS_DOMAIN_SENTENCE, right after CANON_SENTENCE) says what DC Hub joins, and
// six core tool descriptions each name the other domain: the facility side points at the grid, queue and power
// prices for the same place; the energy side says it can be scoped to a data center market or site.
// The selection eval at the end is description-only: a plain word-overlap ranker over the served tools/list, so a
// mixed question ("colo in Ashburn and how deep is the PJM queue") reaches tools from both sides.
import { describe, it, expect, beforeAll } from 'vitest';
import { createServer } from 'node:http';
import { CANON_SENTENCE, CROSS_DOMAIN_SENTENCE } from '../lib/dchub-identity.mjs';
import { ROUTING_LINES } from '../lib/agent-outreach.mjs';
import { CAPABILITIES_INSTRUCTIONS } from '../lib/capabilities-instructions.mjs';
// Note F / option A: no prices, plan names, free tier, credits or calls-per-day wording in agent-facing text.
const NOTE_F_WORDS = /\$\s?\d|\bfree\b|\bpro\b|\bplans?\b|\bpricing\b|\bcredits?\b|\btrial\b|\bper day\b|\ba day\b|calls?\s*(?:\/|per|a)\s*day/i;

const FACILITY_SIDE = ['search_facilities', 'get_facility'];
const ENERGY_SIDE = ['get_interconnection_queue', 'get_energy_prices', 'get_grid_intelligence'];
const CORE = [...FACILITY_SIDE, 'get_market_dcpi_rank', ...ENERGY_SIDE];

let S, tools;
beforeAll(async () => {
  const stub = createServer((q, r) => { q.resume(); q.on('end', () => { r.setHeader('content-type', 'application/json'); r.end('{}'); }); });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  const srv = await new Promise((r) => { const h = S.app.listen(0, '127.0.0.1', () => r(h)); });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/mcp`, { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    const raw = await res.text();
    const body = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
    tools = new Map(JSON.parse(body).result.tools.map((t) => [t.name, t.description]));
  } finally {
    await new Promise((r) => srv.close(r)); await new Promise((r) => stub.close(r));
    if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  }
}, 60000);

describe('the handshake says both domains, second', () => {
  it('the sentence names both sides and stays in the standing rules', () => {
    expect(CROSS_DOMAIN_SENTENCE).toMatch(/^One server for data center and energy intelligence: facilities, capacity, fiber and markets joined with live grid headroom, interconnection queues, time-to-power and power prices for the same place\.$/);
    expect(CROSS_DOMAIN_SENTENCE).not.toMatch(NOTE_F_WORDS);
    // get_energy_prices has no wholesale/LMP price: the sentence must not promise one.
    expect(CROSS_DOMAIN_SENTENCE).not.toMatch(/wholesale|LMP/i);
    expect(CROSS_DOMAIN_SENTENCE).not.toMatch(/\bonly\b|\bfirst\b|#1\b|\blargest\b|\bbest\b|partner/i);
  });
  // Capabilities messaging (2026-11-26): the /mcp texts open with the approved paragraph instead of these two sentences.
  it('full and lean /mcp instructions open with the capabilities paragraph', () => {
    for (const text of [S._INSTRUCTIONS, S._INSTRUCTIONS_LEAN]) {
      expect(text.startsWith(CAPABILITIES_INSTRUCTIONS)).toBe(true);
    }
  });
});

describe('each core description names the other domain', () => {
  it('all six are served and keep their "Use this when" routing lead', () => {
    for (const t of CORE) {
      expect(tools.has(t), t).toBe(true);
      if (ROUTING_LINES[t]) expect(tools.get(t).startsWith(ROUTING_LINES[t]), t).toBe(true);
    }
  });
  it('facility tools point at the grid, queue and power prices for the same place', () => {
    for (const t of FACILITY_SIDE) {
      expect(tools.get(t), t).toMatch(/execute_plan adds the local ISO, interconnection queue and power prices/);
    }
  });
  it('energy tools can be scoped to a data center market or site', () => {
    for (const t of ENERGY_SIDE) {
      expect(tools.get(t), t).toMatch(/Can be scoped to a data center market or site: execute_plan pairs .* with that place's facilities/);
    }
  });
  it('the DCPI rank says what it joins and where the facility side comes from (it carries no facility rows)', () => {
    expect(tools.get('get_market_dcpi_rank')).toMatch(/grid side of a data center market .*get_market_intel gives the same market's facility supply and pipeline/);
  });
  it('the added clauses carry no note-F words', () => {
    const added = [...tools.entries()].filter(([n]) => CORE.includes(n))
      .map(([, d]) => (d.match(/ (?:For the energy side|DCPI joins the grid side|Can be scoped to a data center)[^.]*\./) || [''])[0]);
    expect(added.filter(Boolean)).toHaveLength(6);
    for (const a of added) expect(a, a).not.toMatch(NOTE_F_WORDS);
  });
});

// Description-only selection eval: score = distinct query words found in a tool's description (stop words out); a
// question "reaches both sides" when the top 8 of all served tools hold a facility-side and an energy-side tool (the
// DCPI rank counts as either). The same ranker runs on this served list and on the same list with the six added
// clauses taken out (main's text for those tools), so the test pins the gain, not just a pass.
// Measured 2026-11-17: 3/10 without the clauses, 8/10 with them. The questions were written after the clauses, so
// read the gain as an upper bound; Grok's own measurement (note item 3) is the real one.
const STOP = new Set('a an and the of in for to on at is are what how much does do with by from or it its this that me my i'.split(' '));
const words = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const ADDED = [/ For the energy side of the same place, execute_plan adds the local ISO, interconnection queue and power prices\./,
  / DCPI joins the grid side[^.]*\./, / Can be scoped to a data center market or site: [^.]*\./];
const strip = (d) => ADDED.reduce((x, re) => x.replace(re, ''), d);
function top8(list, q) {
  const qw = words(q);
  return [...list.entries()].map(([n, d]) => { const dw = words(d); let s = 0; for (const w of qw) if (dw.has(w)) s++; return [n, s]; })
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([n]) => n);
}
const bothSides = (top) => top.some((t) => FACILITY_SIDE.includes(t) || t === 'get_market_dcpi_rank')
  && top.some((t) => ENERGY_SIDE.includes(t) || t === 'get_market_dcpi_rank');
// 5 colo-first, 5 energy-first.
const MIXED = [
  'colocation facilities in Ashburn and the interconnection queue there',
  'which data center operators are in Dallas and what do power prices look like for that place',
  'data center facility in Phoenix: local ISO grid headroom for the same site',
  'who operates data centers in Columbus Ohio and how long is time-to-power at that site',
  'Equinix facility in Chicago and the power prices for the same market',
  'ERCOT interconnection queue scoped to the Dallas data center market facilities',
  'PJM grid headroom for a data center site in Northern Virginia and which facilities are there',
  'electricity cost for a data center market in Georgia and the facilities in that market',
  'time-to-power in MISO for a data center site near Chicago facilities',
  'power prices in a data center market and the facilities and capacity in that market',
];
describe('description-only selection: mixed questions reach both sides', () => {
  it('the clauses lift it from 3/10 to at least 8/10', () => {
    const base = new Map([...tools.entries()].map(([n, d]) => [n, strip(d)]));
    expect([...base.values()].join(' ')).not.toMatch(/Can be scoped to a data center market or site|For the energy side of the same place/);
    const withClauses = MIXED.filter((q) => bothSides(top8(tools, q))).length;
    const without = MIXED.filter((q) => bothSides(top8(base, q))).length;
    expect(withClauses, `with ${withClauses}, without ${without}`).toBeGreaterThanOrEqual(8);
    expect(withClauses - without, `with ${withClauses}, without ${without}`).toBeGreaterThanOrEqual(4);
  });
});
