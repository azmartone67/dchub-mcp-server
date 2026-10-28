// execute_plan route_back (owner 2026-10-28): for an intent that asks for something DC Hub does not hold,
// the response names who owns it, read from the Works with registry (the backend twin), never typed here.
//
// What fails here:
//   - a need whose real intent no longer returns the registry's organisation names;
//   - a registry edit that does not change the output (names or wording typed in code);
//   - an organisation name typed in lib/route-back.mjs or in the server.mjs wiring;
//   - an intent with no match that carries a route_back key or a changed answer_guide;
//   - the kill switch DCHUB_PLAN_ROUTE_BACK=0 leaving the field or the sentence behind;
//   - a banned word (directive, superlative, status claim, figure, emoji) reaching an agent, from the
//     registry or from the code;
//   - the call path fetching the registry (it is read from memory);
//   - the existing planner response changing for any other key.
// Pure functions are tested directly; the end-to-end half runs the REAL server.mjs on loopback against a
// stub backend that serves the twin fixture and records every request.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NEED_RULES, classifyNeeds, buildRouteBack, parseRegistry, createRouteBackRegistry,
  routeBackEnabled, violatesRouteBackRules, ROUTE_BACK_WHERE, ROUTE_BACK_PATH,
} from '../lib/route-back.mjs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const TWIN = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'works-with-twin.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

// The six intents the PR body measures, one per class of outcome.
const INTENTS = {
  compare: 'compare Dallas vs Phoenix for a 100 MW AI campus and what else do I need to decide',
  leaseComps: 'what are current lease rates, vacancy and absorption for colocation in Northern Virginia',
  broker: 'I need a broker to negotiate an LOI and represent me as tenant for 5 MW in Dallas',
  news: 'latest news and analyst reports on the Ashburn data center market',
  rfp: 'run an RFP to procure 2 MW of colocation in Phoenix',
  noMatch: 'evaluate 100 MW power headroom for a GPU training cluster in PJM',
};

// Second, independent copy of the house rules: the module's own BANNED list is not trusted to check itself.
const RULES = {
  directive: /\b(must|shall|always|never|required to)\b/i,
  superlative: /\b(only|first|largest|best|deepest|unique)\b/i,
  status: /\b(partner|partners|partnered|partnership|pilot|agreement|endorse|endorsed|endorsement|official|exclusive|preferred)\b/i,
  figure: /[$€£%]|\d/,
  emoji: /[←-⯿☀-➿️\u{1F000}-\u{1FAFF}]/u,
};
// `where` is the fixed page URL (its path says "partners"); the rules apply to the words that came from the registry.
const stripWhere = (s) => String(s).split(ROUTE_BACK_WHERE).join('');
const brokenRules = (s0) => { const s = stripWhere(s0); return Object.entries(RULES).filter(([, rx]) => rx.test(s)).map(([k]) => k); };

// A registry whose names appear nowhere in code or in the shipped registry: output must follow it.
const synthetic = () => ({
  needs: [
    { id: 'lease_comps_research', label: 'checked rent evidence' },
    { id: 'research_reports', label: 'paid analyst writing' },
    { id: 'news_editorial', label: 'trade reporting' },
    { id: 'brokerage_deal_execution', label: 'agents who close leases' },
    { id: 'colocation_procurement', label: 'running a space tender' },
  ],
  partners: [
    { id: 'z1', name: 'Zeta Rentals', route_back: 'Rent evidence: ask Zeta Rentals.', dchub_supplies: 'Grid context beside the rent data.', needs: ['lease_comps_research'] },
    { id: 'z2', name: 'Yarrow Insight', route_back: 'Writing and studies: read Yarrow Insight.', dchub_supplies: null, needs: ['research_reports', 'news_editorial'] },
    { id: 'z3', name: 'Xylo Advisors', route_back: 'Lease closing: talk to Xylo Advisors.', dchub_supplies: 'A cited queue figure.', needs: ['brokerage_deal_execution', 'colocation_procurement'] },
  ],
});

describe('classifier: a small deterministic rule set over the intent text', () => {
  const CASES = [
    ['lease_comps_research', [
      'what are current lease rates for colocation in Dallas', 'verified lease comps in Phoenix', 'vacancy in Northern Virginia',
      'market absorption in Atlanta this year', 'asking rents for wholesale space in Chicago', 'price per kW for retail colocation']],
    ['research_reports', [
      'I want a research subscription for Dallas', 'which analyst reports cover Ashburn', 'pull the latest market report on Phoenix',
      'is there an industry report on hyperscale absorption']],
    ['news_editorial', [
      'latest news on data center moratoriums', 'editorial coverage of Loudoun power', 'what are journalists reporting on Phoenix', 'headlines about Ashburn']],
    ['brokerage_deal_execution', [
      'I need a broker for 5 MW in Dallas', 'tenant representation for a 10 MW lease', 'help me negotiate the lease', 'draft an LOI for this site',
      'sign the lease for this space']],
    ['colocation_procurement', [
      'run an RFP for 2 MW of colocation', 'send an RFQ to colocation providers', 'procurement of colocation space in Phoenix', 'colocation procurement for 3 MW']],
  ];
  for (const [id, intents] of CASES) {
    for (const t of intents) {
      it(`${id}: "${t}"`, () => { expect(classifyNeeds(t)).toContain(id); });
    }
  }

  it('the six measured intents classify as designed', () => {
    expect(classifyNeeds(INTENTS.compare)).toEqual([]);
    expect(classifyNeeds(INTENTS.leaseComps)).toEqual(['lease_comps_research']);
    expect(classifyNeeds(INTENTS.broker)).toEqual(['brokerage_deal_execution']);
    expect(classifyNeeds(INTENTS.news)).toEqual(['research_reports', 'news_editorial']);
    expect(classifyNeeds(INTENTS.rfp)).toEqual(['colocation_procurement']);
    expect(classifyNeeds(INTENTS.noMatch)).toEqual([]);
  });

  it('most intents match nothing (the planner battery used in the allowlist test)', () => {
    const quiet = [
      'rank markets for a 200 MW AI campus', 'rank markets for a 200 MW AI campus in Texas', 'compare Dallas vs Phoenix for a hyperscale campus',
      'find 100 MW of buildable capacity near Ashburn', 'where do fiber density and grid headroom overlap in Atlanta', 'how much power is available in ERCOT',
      'evaluate 100 MW power headroom for a GPU training cluster in PJM', 'analyze site 33.45,-112.07 for 100 MW', 'tax incentives for data centers in Ohio',
      'water risk and climate for a site at 39.04,-77.48', 'interconnection queue in MISO for solar over 100 MW', 'plan fiber lead-in from 39.04,-77.48 to a carrier hotel',
      'gas fired power for a data center in Texas', 'what changed this week', 'my saved sites', 'retirements that could free capacity for 300 MW in PJM',
      'permitting moratorium in Loudoun', 'where is the market heading in Phoenix', 'hosting capacity near 33.45,-112.07', 'is a company a good lease for the site',
      'compare the two campuses', 'report the substation distance', 'what is the first step to energize 50 MW'];
    expect(quiet.filter((t) => classifyNeeds(t).length)).toEqual([]);
  });

  it('empty, null and non-string input classify to nothing', () => {
    for (const v of ['', '   ', null, undefined, 42, {}]) expect(classifyNeeds(v)).toEqual([]);
  });

  it('control: every need id has a rule and the rules are not all-matching', () => {
    expect(NEED_RULES.map((r) => r.id).sort()).toEqual(['brokerage_deal_execution', 'colocation_procurement', 'lease_comps_research', 'news_editorial', 'research_reports']);
    expect(classifyNeeds('x')).toEqual([]);
  });
});

describe('builder: names and wording come from the registry document', () => {
  const real = parseRegistry(TWIN);

  it('control: the shipped twin shape parses and every need has an owner', () => {
    expect(real.labels.size).toBe(5);
    for (const id of real.labels.keys()) expect(real.partners.some((p) => p.needs.includes(id)), id).toBe(true);
  });

  it('each need returns the registry names for that need, the registry label and the registry route line', () => {
    const cases = [
      ['lease_comps_research', INTENTS.leaseComps], ['brokerage_deal_execution', INTENTS.broker],
      ['colocation_procurement', INTENTS.rfp], ['news_editorial', 'latest headlines on Ashburn'],
      ['research_reports', 'which analyst reports cover Dallas'],
    ];
    for (const [id, intent] of cases) {
      const rb = buildRouteBack(intent, real);
      const e = rb.entries.find((x) => x.need === real.labels.get(id));
      expect(e, id).toBeTruthy();
      const owners = real.partners.filter((p) => p.needs.includes(id)).slice(0, 3);
      expect(e.owned_by).toEqual(owners.map((p) => p.name));
      expect(e.where).toBe(ROUTE_BACK_WHERE);
      for (const o of owners) expect(rb.sentence).toContain(o.route.replace(/[.;:\s]+$/, ''));
      expect(rb.sentence).toContain(`For ${real.labels.get(id)}, DC Hub does not hold that; `);
      expect(rb.need_ids).toContain(id);
    }
  });

  it('entries carry exactly need, owned_by, where, note (note from the registry supplies line)', () => {
    const e = buildRouteBack(INTENTS.leaseComps, real).entries[0];
    expect(Object.keys(e)).toEqual(['need', 'owned_by', 'where', 'note']);
    expect(e.note).toBe(real.partners.find((p) => p.needs.includes('lease_comps_research')).supplies);
  });

  it('changing the registry changes the output; the old names disappear (nothing typed in code)', () => {
    const a = buildRouteBack(INTENTS.leaseComps, real);
    const syn = parseRegistry(synthetic());
    const b = buildRouteBack(INTENTS.leaseComps, syn);
    expect(b.entries[0].owned_by).toEqual(['Zeta Rentals']);
    expect(b.entries[0].need).toBe('checked rent evidence');
    expect(b.sentence).toBe('For checked rent evidence, DC Hub does not hold that; Rent evidence: ask Zeta Rentals.');
    expect(JSON.stringify(b)).not.toContain(a.entries[0].owned_by[0]);
    // an edit of one route line moves exactly that line
    const doc = synthetic(); doc.partners[0].route_back = 'Reworded line: try Zeta Rentals.';
    expect(buildRouteBack(INTENTS.leaseComps, parseRegistry(doc)).sentence).toContain('Reworded line: try Zeta Rentals');
    // removing the tag removes the entry
    const untagged = synthetic(); untagged.partners[0].needs = [];
    expect(buildRouteBack(INTENTS.leaseComps, parseRegistry(untagged))).toBeNull();
  });

  it('no match -> null, never an empty object', () => {
    expect(buildRouteBack(INTENTS.noMatch, real)).toBeNull();
    expect(buildRouteBack(INTENTS.compare, real)).toBeNull();
  });

  it('a missing, malformed or untagged registry -> null (fail closed)', () => {
    for (const r of [null, undefined, {}, parseRegistry(null), parseRegistry({ partners: [] }), parseRegistry({ partners: TWIN.partners }),
      parseRegistry({ needs: TWIN.needs, partners: TWIN.partners.map((p) => ({ ...p, needs: undefined })) })]) {
      expect(buildRouteBack(INTENTS.leaseComps, r)).toBeNull();
    }
  });

  it('caps: at most 3 entries and 3 owners per entry', () => {
    const doc = synthetic();
    doc.partners = ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({ id: 'q' + i, name: 'Org' + n, route_back: `Line ${n}: ask Org${n}.`, dchub_supplies: null,
      needs: ['lease_comps_research', 'research_reports', 'news_editorial', 'brokerage_deal_execution', 'colocation_procurement'] }));
    const rb = buildRouteBack('broker, RFP, news, vacancy and analyst reports please', parseRegistry(doc));
    expect(rb.entries.length).toBe(3);
    expect(rb.entries.every((e) => e.owned_by.length === 3)).toBe(true);
    const mutantOk = rb.entries.length <= 3;
    expect(mutantOk).toBe(true);
  });

  it('identical route lines from two organisations are said once', () => {
    const doc = synthetic();
    doc.partners = [
      { id: 'a', name: 'Alpha Co', route_back: 'Closing: work with Alpha Co.', dchub_supplies: null, needs: ['brokerage_deal_execution'] },
      { id: 'b', name: 'Beta Co', route_back: 'Closing: work with Beta Co.', dchub_supplies: null, needs: ['brokerage_deal_execution'] }];
    const rb = buildRouteBack('need a broker', parseRegistry(doc));
    expect(rb.entries[0].owned_by).toEqual(['Alpha Co', 'Beta Co']);
    expect(rb.sentence.split('Closing:').length - 1).toBe(2);
  });
});

describe('the emitted strings keep the house rules', () => {
  it('every string emitted from the shipped twin, for every need, passes an independent copy of the rules', () => {
    const real = parseRegistry(TWIN);
    const all = 'broker for an RFP with lease comps, analyst reports and news';
    const rb = buildRouteBack(all, real);
    expect(rb.entries.length).toBe(3);
    const text = JSON.stringify(rb.entries) + ' ' + rb.sentence;
    expect(brokenRules(text)).toEqual([]);
    for (const id of real.labels.keys()) {
      const one = buildRouteBack({ lease_comps_research: 'vacancy', research_reports: 'analyst', news_editorial: 'news', brokerage_deal_execution: 'broker', colocation_procurement: 'RFP' }[id], real);
      expect(brokenRules(JSON.stringify(one.entries) + one.sentence), id).toEqual([]);
    }
  });

  it('claims no partnership, agreement, pilot or endorsement in any emitted string', () => {
    const rb = buildRouteBack('broker, RFP, news, vacancy', parseRegistry(TWIN));
    expect(/partner|agreement|pilot|endors|official|exclusive/i.test(stripWhere(JSON.stringify(rb.entries) + rb.sentence))).toBe(false);
  });

  const BAD = {
    directive: 'Closing: you must use Xylo.', superlative: 'Closing: the best desk is Xylo.', status: 'Closing: our partner Xylo.',
    agreement: 'Closing: under agreement with Xylo.', pilot: 'Closing: pilot with Xylo.', endorse: 'Closing: Xylo is endorsed.',
    figure: 'Closing: from 20 percent of fees at Xylo.', price: 'Closing: Xylo costs $5.', emoji: 'Closing: Xylo \u{1F680}.',
  };
  for (const [k, line] of Object.entries(BAD)) {
    it(`a registry line with ${k} wording drops that entry instead of emitting it`, () => {
      expect(violatesRouteBackRules(line), 'control: the guard fires on this sample').toBe(true);
      expect(brokenRules(line).length || /endorse|agreement|pilot/.test(line), 'control: the independent rules also fire').toBeTruthy();
      const doc = synthetic();
      doc.partners[2].route_back = line;
      expect(buildRouteBack('need a broker', parseRegistry(doc))).toBeNull();
      const bad2 = synthetic(); bad2.partners[2].name = 'Xylo ' + line.split(' ')[1];
    });
  }

  it('a bad label or name or supplies line is dropped too, and good entries survive', () => {
    for (const patch of [
      (d) => { d.needs[3].label = 'the best brokerage'; }, (d) => { d.partners[2].name = 'Xylo (official partner)'; },
      (d) => { d.partners[2].dchub_supplies = 'Always cite this.'; }]) {
      const d = synthetic(); patch(d);
      expect(buildRouteBack('need a broker', parseRegistry(d))).toBeNull();
    }
    const d = synthetic(); d.partners[2].route_back = 'Closing: it must be Xylo.';
    const rb = buildRouteBack('need a broker and vacancy data', parseRegistry(d));
    expect(rb.entries.map((e) => e.owned_by[0])).toEqual(['Zeta Rentals']);
  });

  it('the guard is not always-true: clean copy passes', () => {
    expect(violatesRouteBackRules('Leasing comps and market supply research: use a research firm.')).toBe(false);
    expect(violatesRouteBackRules('News, events and research: go to the publisher')).toBe(false);
  });
});

describe('source scan: no organisation name typed in code', () => {
  const names = TWIN.partners.flatMap((p) => [p.name, p.id, p.name.replace(/\s*\(.*\)/, ''), ...(p.name.match(/\(([^)]+)\)/) || []).slice(1)])
    .filter((n) => n.length >= 3);
  const mod = fs.readFileSync(path.join(ROOT, 'lib', 'route-back.mjs'), 'utf8');
  const wiring = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8').split('\n')
    .filter((l) => /route_back|routeBack|RouteBack|_rb\b|ROUTE_BACK/.test(l)).join('\n');

  it('control: the scan has names to look for and sees the module and the wiring', () => {
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(mod.length).toBeGreaterThan(3000);
    expect(wiring.split('\n').length).toBeGreaterThan(8);
  });
  it('lib/route-back.mjs and the server.mjs route_back lines name no organisation from the registry', () => {
    const hits = names.filter((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(mod) || new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(wiring));
    expect(hits).toEqual([]);
  });
  it('the scan can fail: a planted name is found', () => {
    const planted = mod + '\n// ask ' + TWIN.partners[0].name;
    expect(names.filter((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(planted))).toContain(TWIN.partners[0].name);
  });
  it('the route lines are not typed in code either', () => {
    for (const p of TWIN.partners) expect(mod.includes(p.route_back.replace(/[.\s]+$/, '')), p.id).toBe(false);
  });
});

describe('kill switch', () => {
  it('DCHUB_PLAN_ROUTE_BACK defaults on and 0/off/false/no turns it off', () => {
    expect(routeBackEnabled({})).toBe(true);
    for (const v of ['1', 'on', 'true', 'yes', '']) expect(routeBackEnabled({ DCHUB_PLAN_ROUTE_BACK: v }), v).toBe(true);
    for (const v of ['0', 'off', 'false', 'no', ' 0 ', 'OFF']) expect(routeBackEnabled({ DCHUB_PLAN_ROUTE_BACK: v }), v).toBe(false);
  });
  it('the registry hands out nothing while the switch is off, and again when it is back on', () => {
    let on = true;
    const reg = createRouteBackRegistry({ fetchTwin: async () => TWIN, enabled: () => on });
    reg.load(TWIN);
    expect(reg.get()).not.toBeNull();
    on = false; expect(reg.get()).toBeNull();
    on = true; expect(reg.get()).not.toBeNull();
  });
});

describe('registry cache: filled in the background, read from memory', () => {
  const tick = () => new Promise((r) => setTimeout(r, 5));

  it('an unarmed cache never fetches, and get() on a cold cache returns null at once', () => {
    let calls = 0;
    const reg = createRouteBackRegistry({ fetchTwin: async () => { calls += 1; return TWIN; } });
    expect(reg.get()).toBeNull(); expect(reg.get()).toBeNull();
    expect(calls).toBe(0);
  });

  it('armed: get() starts one background fetch and does not wait for it', async () => {
    let calls = 0, release;
    const gate = new Promise((r) => { release = r; });
    const reg = createRouteBackRegistry({ fetchTwin: async () => { calls += 1; await gate; return TWIN; } });
    reg.arm();
    expect(reg.get()).toBeNull();            // returned synchronously while the fetch is pending
    expect(reg.get()).toBeNull();
    expect(calls).toBe(1);                   // one in flight, not one per call
    release(); await tick();
    expect(reg.get()).not.toBeNull();
    expect(calls).toBe(1);                   // warm and fresh: no further fetch
  });

  it('accepts the {http_status, body} envelope callAPI returns and ignores a non-200', async () => {
    const ok = createRouteBackRegistry({ fetchTwin: async () => ({ http_status: 200, body: TWIN }) });
    await ok.refresh(); expect(ok.get()).not.toBeNull();
    const bad = createRouteBackRegistry({ fetchTwin: async () => ({ http_status: 503, body: null }) });
    await bad.refresh(); expect(bad.get()).toBeNull();
  });

  it('a failed or hung refresh keeps the last good copy; a copy past max-stale is dropped', async () => {
    let t = 0, fail = false;
    const reg = createRouteBackRegistry({ fetchTwin: async () => { if (fail) throw new Error('down'); return TWIN; },
      now: () => t, ttlMs: 100, retryMs: 10, maxStaleMs: 1000, timeoutMs: 50 });
    reg.arm(); await reg.refresh(); expect(reg.get()).not.toBeNull();
    fail = true; t = 200; reg.get(); await tick();
    expect(reg.get()).not.toBeNull();         // stale but inside max-stale
    t = 5000; expect(reg.get()).toBeNull();   // too old: say nothing
  });

  it('after the ttl a read starts a refresh, so a registry edit reaches agents without a restart', async () => {
    let t = 0, doc = clone(TWIN), calls = 0;
    const reg = createRouteBackRegistry({ fetchTwin: async () => { calls += 1; return doc; }, now: () => t, ttlMs: 100, retryMs: 10 });
    reg.arm(); await reg.refresh();
    expect(reg.get().partners.some((p) => p.name === 'Zeta Rentals')).toBe(false);
    doc = synthetic();
    t = 50; reg.get(); await tick(); expect(calls).toBe(1);        // still fresh: no fetch
    t = 200; reg.get(); await tick();                                // due: one background fetch
    expect(calls).toBe(2);
    expect(reg.get().partners.some((p) => p.name === 'Zeta Rentals')).toBe(true);
  });

  it('a hung fetch times out and the cache stays empty', async () => {
    const reg = createRouteBackRegistry({ fetchTwin: () => new Promise(() => {}), timeoutMs: 20 });
    reg.arm(); await reg.refresh();
    expect(reg.get()).toBeNull();
  });

  it('retries a cold cache no faster than retryMs', async () => {
    let t = 1000, calls = 0;
    const reg = createRouteBackRegistry({ fetchTwin: async () => { calls += 1; throw new Error('down'); }, now: () => t, retryMs: 60000 });
    reg.arm(); reg.get(); await tick(); reg.get(); reg.get(); await tick();
    expect(calls).toBe(1);
    t += 61000; reg.get(); await tick();
    expect(calls).toBe(2);
  });
});

describe('latency: the pure path is microseconds', () => {
  it('buildRouteBack over the shipped registry stays far under a millisecond per call', () => {
    const reg = parseRegistry(TWIN);
    const N = 5000;
    buildRouteBack(INTENTS.broker, reg);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) { buildRouteBack(INTENTS.broker, reg); buildRouteBack(INTENTS.noMatch, reg); }
    const perCallUs = Number(process.hrtime.bigint() - t0) / 1000 / (2 * N);
    console.log(`[route-back] buildRouteBack: ${perCallUs.toFixed(1)} us per call (match and no-match mixed)`);
    expect(perCallUs).toBeLessThan(1000);
  });
});

// ── end to end: the real server.mjs, a stub backend serving the twin ─────────
describe('execute_plan end to end (real server.mjs on loopback)', () => {
  let H, S, fence, twinDoc = clone(TWIN);
  const prevSwitch = process.env.DCHUB_PLAN_ROUTE_BACK;

  async function settle(quietMs = 400, maxMs = 10000) {
    const t0 = Date.now(); let n = H.hits.length, last = Date.now();
    while (Date.now() - t0 < maxMs) {
      await new Promise((r) => setTimeout(r, 50));
      if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); } else if (Date.now() - last >= quietMs) return;
    }
  }
  async function plan(intent, p = '/mcp', headers = { 'user-agent': 'test-client' }) {
    const before = H.hits.length;
    const r = await H.call(p, 'execute_plan', { intent }, headers);
    await settle();
    const sc = r.msg && r.msg.result && r.msg.result.structuredContent;
    const text = r.msg && r.msg.result && r.msg.result.content && r.msg.result.content[0] && r.msg.result.content[0].text;
    const out = sc || (text ? JSON.parse(text) : null);
    return { r, out, hits: H.hits.slice(before), text };
  }
  const stepsRow = (hits) => hits.find((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.tool === 'execute_plan_steps');
  const twinHits = () => H.hits.filter((h) => h.path === ROUTE_BACK_PATH).length;

  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({ extraRoutes: (p) => (p === ROUTE_BACK_PATH ? { status: 200, body: twinDoc } : undefined) });
    S = H.S;
  }, 240_000);
  afterAll(async () => {
    if (prevSwitch === undefined) delete process.env.DCHUB_PLAN_ROUTE_BACK; else process.env.DCHUB_PLAN_ROUTE_BACK = prevSwitch;
    if (S && S._routeBackRegistry) S._routeBackRegistry.reset();
    if (H) await H.stop();
    if (fence) fence.restore();
  });

  it('control: before the registry is read there is no route_back, and the call made no registry request', async () => {
    S._routeBackRegistry.reset();
    const r = await plan(INTENTS.broker);
    expect(r.out && r.out._entity).toBe('plan_execution');
    expect('route_back' in r.out).toBe(false);
    expect(twinHits()).toBe(0);            // an unarmed process never fetches
  }, 60_000);

  it('the background read goes through the real fetch path (callAPI) once armed', async () => {
    S._routeBackRegistry.reset(); S._routeBackRegistry.arm();
    const got = await S._routeBackRegistry.refresh();
    expect(got && got.partners.length).toBe(7);
    expect(twinHits()).toBe(1);
  }, 60_000);

  it('six intents: route_back only where a need matched; names are the registry names', async () => {
    const reg = parseRegistry(twinDoc);
    const seen = {};
    for (const [k, intent] of Object.entries(INTENTS)) seen[k] = await plan(intent);
    for (const k of ['compare', 'noMatch']) {
      expect('route_back' in seen[k].out, k).toBe(false);
      expect(seen[k].text.includes('DC Hub does not hold that'), k).toBe(false);
    }
    const want = {
      leaseComps: ['lease_comps_research'], broker: ['brokerage_deal_execution'],
      news: ['research_reports', 'news_editorial'], rfp: ['colocation_procurement'],
    };
    for (const [k, ids] of Object.entries(want)) {
      const o = seen[k].out;
      expect(o.human_url || o.for_your_human, `control: ${k} ran walled (keyless), the case the one-link rule scrubs`).toBeTruthy();
      expect(Array.isArray(o.route_back), k).toBe(true);
      expect(o.route_back.map((e) => e.need)).toEqual(ids.map((id) => reg.labels.get(id)));
      for (const e of o.route_back) {
        expect(e.where).toBe('https://dchub.cloud/partners#works-with');
        expect(Object.keys(e)).toEqual(['need', 'owned_by', 'where', 'note']);
      }
      const expectedNames = ids.map((id) => reg.partners.filter((p) => p.needs.includes(id)).slice(0, 3).map((p) => p.name));
      expect(o.route_back.map((e) => e.owned_by)).toEqual(expectedNames);
      expect(o.answer_guide.endsWith(buildRouteBack(INTENTS[k], reg).sentence), k).toBe(true);
      expect(brokenRules(JSON.stringify(o.route_back) + buildRouteBack(INTENTS[k], reg).sentence), k).toEqual([]);
      // logged: the existing call-log row carries which need was returned
      const row = stepsRow(seen[k].hits);
      expect(row && row.body.params.route_back_need, k).toBe(ids.join('|'));
    }
    for (const k of ['compare', 'noMatch']) {
      const row = stepsRow(seen[k].hits);
      expect(row, k).toBeTruthy();
      expect('route_back_need' in row.body.params, k).toBe(false);
    }
    // the call path read the registry from memory: no registry request during any of the six calls
    expect(twinHits()).toBe(1);
  }, 240_000);

  it('only route_back and the answer_guide sentence are added; every other key is unchanged', async () => {
    const on = await plan(INTENTS.rfp);
    process.env.DCHUB_PLAN_ROUTE_BACK = '0';
    const off = await plan(INTENTS.rfp);
    delete process.env.DCHUB_PLAN_ROUTE_BACK;
    expect(Object.keys(on.out).filter((k) => !(k in off.out))).toEqual(['route_back']);
    expect(Object.keys(off.out).filter((k) => !(k in on.out))).toEqual([]);
    const sentence = buildRouteBack(INTENTS.rfp, parseRegistry(twinDoc)).sentence;
    expect(on.out.answer_guide).toBe(off.out.answer_guide + ' ' + sentence);
    expect(on.out.intent_class).toBe(off.out.intent_class);
    expect(on.out.planner_version).toBe(off.out.planner_version);
    expect(on.out.executed.map((e) => [e.tool, e.status])).toEqual(off.out.executed.map((e) => [e.tool, e.status]));
  }, 120_000);

  it('kill switch DCHUB_PLAN_ROUTE_BACK=0 removes the field, the sentence and the log marker; unset restores them', async () => {
    process.env.DCHUB_PLAN_ROUTE_BACK = '0';
    try {
      for (const k of ['leaseComps', 'broker', 'news', 'rfp']) {
        const r = await plan(INTENTS[k]);
        expect('route_back' in r.out, k).toBe(false);
        expect(r.text.includes('DC Hub does not hold that'), k).toBe(false);
        expect('route_back_need' in stepsRow(r.hits).body.params, k).toBe(false);
      }
    } finally { delete process.env.DCHUB_PLAN_ROUTE_BACK; }
    const back = await plan(INTENTS.broker);
    expect(Array.isArray(back.out.route_back)).toBe(true);
  }, 240_000);

  it('a changed registry changes the live output on the next refresh (no names in the planner)', async () => {
    twinDoc = synthetic();
    twinDoc.schema = 1;
    S._routeBackRegistry.reset(); S._routeBackRegistry.arm();
    await S._routeBackRegistry.refresh();
    const r = await plan(INTENTS.broker);
    expect(r.out.route_back).toEqual([{ need: 'agents who close leases', owned_by: ['Xylo Advisors'], where: ROUTE_BACK_WHERE, note: 'A cited queue figure.' }]);
    expect(r.out.answer_guide.endsWith('For agents who close leases, DC Hub does not hold that; Lease closing: talk to Xylo Advisors.')).toBe(true);
    twinDoc = clone(TWIN);
  }, 120_000);

  it('the directory profiles carry no new field (same gate as ranked_answer)', async () => {
    S._routeBackRegistry.reset(); S._routeBackRegistry.arm(); await S._routeBackRegistry.refresh();
    for (const p of ['/mcp/chatgpt', '/mcp/claude']) {
      const r = await plan(INTENTS.broker, p);
      expect(r.out && r.out._entity, p).toBe('plan_execution');
      expect('route_back' in r.out, p).toBe(false);
      expect(r.text.includes('DC Hub does not hold that'), p).toBe(false);
    }
  }, 240_000);
});
