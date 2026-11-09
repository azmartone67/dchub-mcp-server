// execute_plan hand-off (owner 2026-11-09, design dchub-planner-handoff-design-2026-11-09.md): route_back
// entries carry the organisation's own link, and a plan DC Hub answered carries one complement naming who
// covers what the answer did not. DC Hub works alongside these sources; it never replaces or ranks them.
//
// What fails here:
//   - a registry url that is not https, carries a query, or points at dchub.cloud reaching an agent;
//   - the utm pair missing, or appended twice;
//   - a missing registry url producing a link (a guess);
//   - owners listed in registry order instead of alphabetically, in the field or in the sentence;
//   - route_back's existing shape changing for readers of owned_by (names) when no url is present;
//   - a complement on a class or outcome the design says gets none (grid, capacity with matches);
//   - a complement repeating a need route_back already named;
//   - a complement beside a human_url, a for_your_human relay or a wall;
//   - more than one complement field or sentence;
//   - banned wording (directive, superlative, status claim, figure, emoji) in any emitted string;
//   - an organisation name typed in lib/handoff.mjs or the server.mjs wiring;
//   - the complement on /mcp/claude, /mcp/chatgpt, /mcp/grok, a ChatGPT client, or /mcp/core with the
//     flag off; the kill switch DCHUB_PLAN_HANDOFF=0 leaving the field, the sentence or the log marker;
//   - the sentence displacing the UNDATED guard or the answer guidance (it is appended after them).
// Pure functions are tested directly; the end-to-end half runs the REAL server.mjs on loopback against a
// stub backend (clean full-depth bodies for the Pro key, the twin registry with urls).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  orgLink, parseRegistry, buildRouteBack, ownersFor, ROUTE_BACK_WHERE, ORG_LINK_UTM,
} from '../lib/route-back.mjs';
import {
  handoffEnabled, coreHandoffOn, handoffBasis, planLooksWalled, placeName, boundPlaces,
  buildHandoff, renderHandoffSentence, stripHandoffIfPointered, HANDOFF_BASES,
} from '../lib/handoff.mjs';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const TWIN = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'works-with-twin.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

// The homepages the design lists (review_sources), keyed by registry id. Test data only.
const URLS = {
  datacenterhawk: 'https://datacenterhawk.com/',
  dcbyte: 'https://www.dcbyte.com/',
  dcd: 'https://www.datacenterdynamics.com/en/',
  dcf: 'https://www.datacenterfrontier.com/',
  baxtel: 'https://baxtel.com/',
  cbre: 'https://www.cbre.com/',
  jll: 'https://www.jll.com/en-us/industries/data-centers',
};
const withUrls = (doc = TWIN) => { const d = clone(doc); for (const p of d.partners) if (URLS[p.id]) p.url = URLS[p.id]; return d; };
const UTM = 'utm_source=dchub.cloud&utm_medium=agent';
const countUtm = (s) => (String(s).match(/utm_source=/g) || []).length;

// Second, independent copy of the house rules (the module's own list is not trusted to check itself).
const RULES = {
  directive: /\b(must|shall|always|never|required to)\b/i,
  superlative: /\b(only|first|largest|best|deepest|unique|leading|top|premier)\b/i,
  status: /\b(partner|partners|partnered|partnership|pilot|agreement|endorse|endorsed|endorsement|official|exclusive|preferred|sponsor\w*|affiliat\w*)\b/i,
  figure: /[$€£%]|\d/,
  emoji: /[←-⯿☀-➿️\u{1F000}-\u{1FAFF}]/u,
};
// URLs are not prose: drop them (and the fixed Works with page) before applying the rules.
const prose = (s) => String(s).replace(/https:\/\/[^\s"']+/g, '').split(ROUTE_BACK_WHERE).join('');
const brokenRules = (s) => Object.entries(RULES).filter(([, rx]) => rx.test(prose(s))).map(([k]) => k);

const step = (tool, status = 'executed', result = { ok: true }) => ({ step: 1, tool, status, result });
const MARKET_STEPS = () => [step('site_selection_canvas'), step('get_market_dcpi_rank'), step('get_grid_intelligence')];

describe('orgLink: the registry url, validated, with the tag appended once', () => {
  it('a homepage gets the utm pair exactly once, after the path', () => {
    expect(orgLink('https://datacenterhawk.com')).toBe(`https://datacenterhawk.com/?${UTM}`);
    expect(orgLink('https://www.jll.com/en-us/industries/data-centers')).toBe(`https://www.jll.com/en-us/industries/data-centers?${UTM}`);
    for (const u of Object.values(URLS)) expect(countUtm(orgLink(u)), u).toBe(1);
    expect(Object.keys(ORG_LINK_UTM)).toEqual(['utm_source', 'utm_medium']);
  });
  it('a fragment stays after the query', () => {
    expect(orgLink('https://example.org/a#b')).toBe(`https://example.org/a?${UTM}#b`);
  });
  it('refuses: http, a query (even an existing utm), dchub.cloud, credentials, an address, junk', () => {
    for (const bad of [
      'http://datacenterhawk.com/', 'https://datacenterhawk.com/?ref=x', `https://datacenterhawk.com/?${UTM}`, 'https://datacenterhawk.com/?',
      'https://dchub.cloud/partners', 'https://www.dchub.cloud/', 'https://api.dchub.cloud/x', 'https://dchub.cloud./x',
      'https://user:pw@example.org/', 'https://203.0.113.9/', 'https://[2001:db8::1]/', 'https://localhost/',
      'javascript:alert(1)', 'ftp://example.org/', '', '   ', null, undefined, 42, {}, 'not a url', 'https://exa mple.org/',
      'https://example.org/' + 'a'.repeat(400),
    ]) expect(orgLink(bad), String(bad)).toBeNull();
  });
  it('control: a lookalike host that merely contains dchub is not refused', () => {
    expect(orgLink('https://notdchub.cloud.example.org/')).toBe(`https://notdchub.cloud.example.org/?${UTM}`);
  });
});

describe('route_back: links beside owned_by, alphabetical order', () => {
  it('no url anywhere (the registry today) -> the existing shape exactly: no links key', () => {
    const rb = buildRouteBack('need a broker and an RFP for colocation', parseRegistry(TWIN));
    for (const e of rb.entries) expect(Object.keys(e)).toEqual(['need', 'owned_by', 'where', 'note']);
    expect(JSON.stringify(rb)).not.toContain('utm_');
  });

  it('with urls: links = [{name, url}] for each owner that has one, owned_by stays names', () => {
    const reg = parseRegistry(withUrls());
    const rb = buildRouteBack('run an RFP to procure 2 MW of colocation in Phoenix', reg);
    const e = rb.entries[0];
    expect(Object.keys(e)).toEqual(['need', 'owned_by', 'where', 'note', 'links']);
    expect(e.owned_by.every((n) => typeof n === 'string')).toBe(true);
    expect(e.links.map((l) => l.name)).toEqual(e.owned_by);
    for (const l of e.links) { expect(l.url.startsWith('https://')).toBe(true); expect(countUtm(l.url)).toBe(1); }
    expect(e.where).toBe(ROUTE_BACK_WHERE);
  });

  it('a row with no url, or a refused url, gets no link; the others keep theirs', () => {
    const d = withUrls();
    const tagged = d.partners.filter((p) => p.needs.includes('colocation_procurement'));
    delete tagged[0].url;                     // no url -> no link
    tagged[1].url = 'http://' + 'insecure.example.org/';  // refused -> no link
    const e = buildRouteBack('run an RFP for colocation', parseRegistry(d)).entries[0];
    expect(e.owned_by.length).toBe(3);
    expect(e.links.map((l) => l.name)).toEqual([tagged[2].name]);
    const none = withUrls(); for (const p of none.partners) delete p.url;
    expect('links' in buildRouteBack('run an RFP for colocation', parseRegistry(none)).entries[0]).toBe(false);
  });

  it('owners and their route lines are alphabetical by name, not registry order', () => {
    const doc = {
      needs: [{ id: 'brokerage_deal_execution', label: 'agents who close leases' }],
      partners: [
        { id: 'z', name: 'Zulu Desk', route_back: 'Closing: Zulu Desk.', needs: ['brokerage_deal_execution'], url: 'https://zulu.example.org/' },
        { id: 'a', name: 'alpha house', route_back: 'Closing: alpha house.', needs: ['brokerage_deal_execution'] },
        { id: 'm', name: 'Mike Co', route_back: 'Closing: Mike Co.', needs: ['brokerage_deal_execution'], url: 'https://mike.example.org/' },
      ],
    };
    const rb = buildRouteBack('need a broker', parseRegistry(doc));
    expect(rb.entries[0].owned_by).toEqual(['alpha house', 'Mike Co', 'Zulu Desk']);
    expect(rb.entries[0].links.map((l) => l.name)).toEqual(['Mike Co', 'Zulu Desk']);
    expect(rb.sentence).toBe('For agents who close leases, DC Hub does not hold that; Closing: alpha house; Closing: Mike Co; Closing: Zulu Desk.');
    // reversing the registry changes nothing
    const rev = clone(doc); rev.partners.reverse();
    expect(buildRouteBack('need a broker', parseRegistry(rev))).toEqual(rb);
  });

  it('the shipped twin: every multi-owner need comes out sorted', () => {
    const reg = parseRegistry(TWIN);
    for (const id of reg.labels.keys()) {
      const names = ownersFor(reg, id).map((o) => o.name);
      expect(names, id).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    }
  });
});

describe('handoffBasis: which plans earn a complement', () => {
  it('market classes with an answered step -> market_answer', () => {
    for (const cls of ['market_ranking', 'market_outlook', 'market_comparison']) expect(handoffBasis(cls, MARKET_STEPS()), cls).toBe('market_answer');
  });
  it('market classes where nothing ran in full -> none', () => {
    expect(handoffBasis('market_ranking', [step('get_market_dcpi_rank', 'failed'), step('get_grid_intelligence', 'gated_preview')])).toBeNull();
    expect(handoffBasis('market_ranking', [])).toBeNull();
  });
  it('capacity_search: no fit -> capacity_no_fit; matches, no source_capacity step, or a gated one -> none', () => {
    expect(handoffBasis('capacity_search', [step('get_market_dcpi_rank'), step('source_capacity', 'executed', { items: [] })])).toBe('capacity_no_fit');
    expect(handoffBasis('capacity_search', [step('source_capacity', 'executed', { exact: [], bundles: [], shortfall: { kw: 1 } })])).toBe('capacity_no_fit');
    expect(handoffBasis('capacity_search', [step('source_capacity', 'executed', { items: [{ id: 1 }] })])).toBeNull();
    expect(handoffBasis('capacity_search', [step('get_market_dcpi_rank')])).toBeNull();
    expect(handoffBasis('capacity_search', [step('source_capacity', 'gated_preview', { items: [] })])).toBeNull();
    // the full (pre-slim) result wins over the slim one
    const e = step('source_capacity', 'executed', { items: [] });
    expect(handoffBasis('capacity_search', [e], new Map([[e, { items: [{ id: 1 }] }]]))).toBeNull();
  });
  it('every other class -> none', () => {
    for (const cls of ['grid_headroom', 'interconnection_queue', 'fiber_intel', 'site_analysis', 'water_risk', 'tax_incentives', 'hyperscaler_activity', undefined, null]) {
      expect(handoffBasis(cls, MARKET_STEPS()), String(cls)).toBeNull();
    }
  });
});

describe('buildHandoff: the field and its one sentence', () => {
  const reg = parseRegistry(withUrls());
  const base = { intentClass: 'market_ranking', executed: MARKET_STEPS(), registry: reg, places: ['Dallas'] };

  it('Dallas market_ranking: lease and news needs, owners from the registry tags, links tagged, place named', () => {
    const h = buildHandoff(base);
    expect(h.basis).toBe('market_answer');
    expect(h.need_ids).toEqual(['lease_comps_research', 'news_editorial']);
    expect(Object.keys(h.field)).toEqual(['kind', 'basis', 'for', 'needs']);
    expect(h.field.kind).toBe('complement');
    expect(h.field.for).toBe('Dallas');
    for (const [i, id] of h.need_ids.entries()) {
      const n = h.field.needs[i];
      expect(n.need).toBe(reg.labels.get(id));
      expect(n.owned_by.map((o) => o.name)).toEqual(ownersFor(reg, id).map((o) => o.name));
      for (const o of n.owned_by) { expect(Object.keys(o)).toEqual(['name', 'url']); expect(countUtm(o.url)).toBe(1); }
    }
    expect(h.sentence.startsWith(HANDOFF_BASES.market_answer.lead + '; for ' + reg.labels.get('lease_comps_research') + ' in Dallas, ')).toBe(true);
    expect(h.sentence).toBe(renderHandoffSentence(h.field));
    expect(brokenRules(JSON.stringify(h.field) + ' ' + h.sentence)).toEqual([]);
  });

  it('at most one: one field object, one sentence, the lead said once', () => {
    const h = buildHandoff(base);
    expect(Array.isArray(h.field)).toBe(false);
    expect(h.sentence.split(HANDOFF_BASES.market_answer.lead).length - 1).toBe(1);
    expect((h.sentence.match(/\.$/g) || []).length).toBe(1);
    expect(h.sentence.slice(0, -1).includes('. ')).toBe(false);
  });

  it('capacity no-fit: procurement and brokerage needs, alphabetical owners', () => {
    const h = buildHandoff({ ...base, intentClass: 'capacity_search', executed: [step('source_capacity', 'executed', { items: [] })] });
    expect(h.basis).toBe('capacity_no_fit');
    expect(h.need_ids).toEqual(['colocation_procurement', 'brokerage_deal_execution']);
    for (const n of h.field.needs) {
      const names = n.owned_by.map((o) => o.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    }
    expect(h.sentence.startsWith(HANDOFF_BASES.capacity_no_fit.lead + '; ')).toBe(true);
  });

  it('owners are alphabetical in the field AND in the sentence, whatever the registry order', () => {
    const doc = {
      needs: [{ id: 'news_editorial', label: 'trade reporting' }, { id: 'lease_comps_research', label: 'rent evidence' }],
      partners: [
        { id: 'z', name: 'Zeta Wire', route_back: 'News: Zeta Wire.', needs: ['news_editorial'], url: 'https://zeta.example.org/' },
        { id: 'b', name: 'beta post', route_back: 'News: beta post.', needs: ['news_editorial'] },
        { id: 'r', name: 'Rent Desk', route_back: 'Rents: Rent Desk.', needs: ['lease_comps_research'] },
      ],
    };
    const h = buildHandoff({ ...base, registry: parseRegistry(doc) });
    expect(h.field.needs[1].owned_by).toEqual([{ name: 'beta post' }, { name: 'Zeta Wire', url: `https://zeta.example.org/?${UTM}` }]);
    expect(h.sentence).toBe('DC Hub covers power, grid and DCPI here; for rent evidence in Dallas, Rent Desk; for trade reporting, beta post and Zeta Wire.');
    const rev = clone(doc); rev.partners.reverse();
    expect(buildHandoff({ ...base, registry: parseRegistry(rev) })).toEqual(h);
  });

  it('no registry url -> owned_by carries the name and no url (never a guessed link)', () => {
    const h = buildHandoff({ ...base, registry: parseRegistry(TWIN) });
    for (const n of h.field.needs) for (const o of n.owned_by) expect(Object.keys(o)).toEqual(['name']);
    expect(JSON.stringify(h)).not.toMatch(/https?:/);
  });

  it('never repeats a need route_back already named; both named -> no complement', () => {
    const h = buildHandoff({ ...base, routeBackIds: ['lease_comps_research'] });
    expect(h.need_ids).toEqual(['news_editorial']);
    expect(JSON.stringify(h.field)).not.toContain(reg.labels.get('lease_comps_research'));
    expect(buildHandoff({ ...base, routeBackIds: ['lease_comps_research', 'news_editorial'] })).toBeNull();
  });

  it('walled -> nothing', () => {
    expect(buildHandoff({ ...base, walled: true })).toBeNull();
  });

  it('places: none -> no `for`; two -> joined; more than three -> dropped; a bad one is refused', () => {
    expect('for' in buildHandoff({ ...base, places: [] }).field).toBe(false);
    expect(buildHandoff({ ...base, intentClass: 'market_comparison', places: ['Dallas', 'Phoenix'] }).field.for).toBe('Dallas and Phoenix');
    expect('for' in buildHandoff({ ...base, places: ['A', 'B', 'C', 'D'].map((x) => x + 'ville') }).field).toBe(false);
    expect('for' in buildHandoff({ ...base, places: ['the best market'] }).field).toBe(false);
  });

  it('a registry label or name with banned wording drops that need; good needs survive', () => {
    const d = withUrls(); d.needs.find((n) => n.id === 'news_editorial').label = 'the leading news';
    const h = buildHandoff({ ...base, registry: parseRegistry(d) });
    expect(h.need_ids).toEqual(['lease_comps_research']);
    const d2 = withUrls(); for (const p of d2.partners) if (p.needs.includes('lease_comps_research')) p.name += ' (official partner)';
    expect(buildHandoff({ ...base, registry: parseRegistry(d2) }).need_ids).toEqual(['news_editorial']);
  });

  it('no registry, an untagged registry, or a non-answer -> null', () => {
    expect(buildHandoff({ ...base, registry: null })).toBeNull();
    const untagged = withUrls(); for (const p of untagged.partners) p.needs = p.needs.filter((n) => !['lease_comps_research', 'news_editorial'].includes(n));
    expect(buildHandoff({ ...base, registry: parseRegistry(untagged) })).toBeNull();
    expect(buildHandoff({ ...base, intentClass: 'grid_headroom' })).toBeNull();
    expect(buildHandoff({ ...base, intentClass: 'capacity_search', executed: [step('source_capacity', 'executed', { items: [{ id: 1 }] })] })).toBeNull();
  });
});

describe('places', () => {
  it('placeName: slugs and plain names, never digits or markup', () => {
    expect(placeName('dallas-tx')).toBe('Dallas');
    expect(placeName('northern-virginia')).toBe('Northern Virginia');
    expect(placeName('salt-lake-city-ut')).toBe('Salt Lake City');
    expect(placeName('dallas')).toBe('Dallas');
    expect(placeName('Phoenix')).toBe('Phoenix');
    for (const bad of ['33.4,-112.0', 'zone-7', '<b>x</b>', '', null, 42, 'a'.repeat(80)]) expect(placeName(bad), String(bad)).toBeNull();
  });
  it('boundPlaces: the market hint wins; else every table city the intent names, once', () => {
    const table = { dallas: { slug: 'dallas-tx' }, dfw: { slug: 'dallas-tx' }, phoenix: { slug: 'phoenix-az' }, 'central illinois': { iso: 'MISO' } };
    const hit = (k, m, t) => t.includes(k);
    expect(boundPlaces({ intent: 'compare dallas (dfw) vs phoenix', cityTable: table, cityHit: hit })).toEqual(['Dallas', 'Phoenix']);
    expect(boundPlaces({ intent: 'compare dallas vs phoenix', market: 'columbus-oh', cityTable: table, cityHit: hit })).toEqual(['Columbus']);
    expect(boundPlaces({ intent: 'central illinois', cityTable: table, cityHit: hit })).toEqual([]);
    expect(boundPlaces({})).toEqual([]);
  });
});

describe('never beside a pointer', () => {
  const reg = parseRegistry(withUrls());
  const h = buildHandoff({ intentClass: 'market_ranking', executed: MARKET_STEPS(), registry: reg, places: ['Dallas'] });
  const make = (extra) => {
    const sc = { _entity: 'plan_execution', answer_guide: 'Compose the answer. ' + h.sentence, handoff: h.field, ...extra };
    return { content: [{ type: 'text', text: JSON.stringify(sc) }, { type: 'text', text: 'a human line' }], structuredContent: sc };
  };

  it('planLooksWalled: a gated step, a step carrying human_url / for_your_human, or a wall step', () => {
    expect(planLooksWalled(MARKET_STEPS())).toBe(false);
    expect(planLooksWalled([...MARKET_STEPS(), step('x', 'gated_preview')])).toBe(true);
    expect(planLooksWalled([step('x', 'executed', { human_url: 'https://dchub.cloud/u/abc' })])).toBe(true);
    expect(planLooksWalled([step('x', 'executed', { for_your_human: { url: 'u' } })])).toBe(true);
    expect(planLooksWalled([step('x', 'executed', { _gated: true })], { isWall: (r) => !!r._gated })).toBe(true);
    const e = step('x');
    expect(planLooksWalled([e], { fullOf: new Map([[e, { human_url: 'https://dchub.cloud/u/abc' }]]) })).toBe(true);
    expect(planLooksWalled([step('x')], { isWall: () => { throw new Error('boom'); } })).toBe(false);
  });

  for (const [label, extra, isWall] of [
    ['human_url', { human_url: 'https://dchub.cloud/u/abcdef' }, undefined],
    ['for_your_human', { for_your_human: { text: 'see this', url: 'https://dchub.cloud/u/abcdef' } }, undefined],
    ['a wall', { _preview_only: true }, (sc) => !!sc._preview_only],
  ]) {
    it(`final result with ${label}: the field and the sentence leave structuredContent and the text block`, () => {
      const r = stripHandoffIfPointered(make(extra), { isWall });
      expect('handoff' in r.structuredContent).toBe(false);
      expect(r.structuredContent.answer_guide).toBe('Compose the answer.');
      expect(r.content[0].text).not.toContain('"handoff"');
      expect(r.content[0].text).not.toContain(h.sentence);
      expect(JSON.parse(r.content[0].text).answer_guide).toBe('Compose the answer.');
      expect(r.content[1].text).toBe('a human line');
    });
  }

  it('a text block that is not the byte-exact serialisation still loses the field (parse fallback)', () => {
    const r0 = make({ human_url: 'https://dchub.cloud/u/abcdef' });
    r0.content[0].text = JSON.stringify(JSON.parse(r0.content[0].text), null, 1);
    const r = stripHandoffIfPointered(r0);
    expect(r.content[0].text).not.toContain('"handoff"');
  });

  it('no pointer -> the same result object, untouched', () => {
    const r0 = make({});
    expect(stripHandoffIfPointered(r0, { isWall: () => false })).toBe(r0);
    expect(stripHandoffIfPointered({ content: [], structuredContent: { human_url: 'x' } })).toEqual({ content: [], structuredContent: { human_url: 'x' } });
    expect(stripHandoffIfPointered(null)).toBeNull();
  });
});

describe('switches', () => {
  it('DCHUB_PLAN_HANDOFF defaults on; 0/off/false/no turn it off', () => {
    expect(handoffEnabled({})).toBe(true);
    for (const v of ['1', 'on', 'true', 'yes', '']) expect(handoffEnabled({ DCHUB_PLAN_HANDOFF: v }), v).toBe(true);
    for (const v of ['0', 'off', 'false', 'no', ' 0 ', 'OFF']) expect(handoffEnabled({ DCHUB_PLAN_HANDOFF: v }), v).toBe(false);
  });
  it('DCHUB_CORE_HANDOFF defaults OFF; only 1/on/true/yes turn it on', () => {
    expect(coreHandoffOn({})).toBe(false);
    for (const v of ['', '0', 'off', 'no', 'maybe']) expect(coreHandoffOn({ DCHUB_CORE_HANDOFF: v }), v).toBe(false);
    for (const v of ['1', 'on', 'TRUE', 'yes']) expect(coreHandoffOn({ DCHUB_CORE_HANDOFF: v }), v).toBe(true);
  });
});

describe('source scan: no organisation name typed in lib/handoff.mjs or its wiring', () => {
  const names = TWIN.partners.flatMap((p) => [p.name, p.id, p.name.replace(/\s*\(.*\)/, ''), ...(p.name.match(/\(([^)]+)\)/) || []).slice(1)])
    .filter((n) => n.length >= 3);
  const mod = fs.readFileSync(path.join(ROOT, 'lib', 'handoff.mjs'), 'utf8');
  const wiring = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8').split('\n')
    .filter((l) => /\b_ho\b|buildHandoff|handoffEnabled|_coreHandoffOn|stripHandoffIfPointered|planLooksWalled|boundPlaces|handoff_kind|handoff_need|handoff:/.test(l)).join('\n');
  const esc = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = (text) => names.filter((n) => new RegExp(`\\b${esc(n)}\\b`, 'i').test(text));

  it('control: the scan has names and sees the module and the wiring', () => {
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(mod.length).toBeGreaterThan(3000);
    expect(wiring.split('\n').length).toBeGreaterThanOrEqual(8);
  });
  it('no registry name appears', () => { expect(found(mod)).toEqual([]); expect(found(wiring)).toEqual([]); });
  it('the scan can fail: a planted name is found', () => {
    expect(found(mod + '\n// ask ' + TWIN.partners[4].name)).toContain(TWIN.partners[4].name);
  });
});

// ── end to end: the real server.mjs on loopback ────────────────────────────
describe('execute_plan end to end (real server.mjs, stub backend)', () => {
  let H, S, fence;
  const twinDoc = withUrls();
  const AS_OF = '2026-11-08T00:00:00Z';
  let listings = { ok: true, items: [], total: 0, as_of: AS_OF };
  const clean = () => ({ ok: true, as_of: AS_OF, source: 'DC Hub', items: [{ metro_slug: 'dallas-tx', name: 'Dallas', score: 70, as_of: AS_OF }] });
  const prevEnv = {};
  const ENV_KEYS = ['DCHUB_PLAN_HANDOFF', 'DCHUB_CORE_HANDOFF', 'DCHUB_PLAN_ROUTE_BACK'];
  const PRO = { 'user-agent': 'test-client', 'x-api-key': PRO_KEY };

  async function settle(quietMs = 300, maxMs = 8000) {
    const t0 = Date.now(); let n = H.hits.length, last = Date.now();
    while (Date.now() - t0 < maxMs) {
      await new Promise((r) => setTimeout(r, 50));
      if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); } else if (Date.now() - last >= quietMs) return;
    }
  }
  async function plan(intent, p = '/mcp', headers = PRO, tool = 'execute_plan', args = {}) {
    const before = H.hits.length;
    const r = await H.call(p, tool, { intent, ...args }, headers);
    await settle();
    const res = r.msg && r.msg.result;
    const text = res && res.content ? res.content.map((b) => b.text || '').join('\n') : '';
    let out = res && res.structuredContent;
    if (!out && res && res.content && res.content[0]) { try { out = JSON.parse(res.content[0].text); } catch { out = null; } }
    return { r, out, text, hits: H.hits.slice(before) };
  }
  const stepsRow = (hits) => hits.find((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.tool === 'execute_plan_steps');

  beforeAll(async () => {
    for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
    fence = fenceNetwork();
    H = await startHarness({ extraRoutes: (p, req) => {
      if (p === '/api/v1/partners/works-with.json') return { status: 200, body: twinDoc };
      if (req.headers['x-api-key'] !== PRO_KEY) return undefined;   // keyless: the harness's walled bodies
      if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
      if (p.startsWith('/api/v1/listings')) return { status: 200, body: listings };
      return { status: 200, body: clean() };
    } });
    S = H.S;
    S._routeBackRegistry.reset(); S._routeBackRegistry.arm();
    await S._routeBackRegistry.refresh();
  }, 240_000);
  afterAll(async () => {
    for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
    if (S && S._routeBackRegistry) S._routeBackRegistry.reset();
    if (H) await H.stop();
    if (fence) fence.restore();
  });

  const DALLAS = 'rank markets for a 200 MW AI campus in Dallas';
  const NOFIT = 'find 20 MW of colocation capacity in Dallas';
  const GRID = 'evaluate 100 MW power headroom for a GPU training cluster in PJM';

  it('Dallas market_ranking (full answer): one handoff naming the lease and news owners with tagged links', async () => {
    const r = await plan(DALLAS);
    expect(r.out.intent_class).toBe('market_ranking');
    expect(r.out.human_url, 'control: a full answer, no wall').toBeUndefined();
    const h = r.out.handoff;
    expect(h && h.kind).toBe('complement');
    expect(h.basis).toBe('market_answer');
    expect(h.for).toBe('Dallas');
    const reg = parseRegistry(twinDoc);
    expect(h.needs.map((n) => n.need)).toEqual([reg.labels.get('lease_comps_research'), reg.labels.get('news_editorial')]);
    for (const n of h.needs) for (const o of n.owned_by) { expect(o.url.startsWith('https://')).toBe(true); expect(countUtm(o.url)).toBe(1); expect(o.url).not.toContain('dchub.cloud/'); }
    const sentence = renderHandoffSentence(h);
    expect(r.out.answer_guide.endsWith(' ' + sentence)).toBe(true);
    expect(r.text.split(sentence).length - 1, 'the sentence once per block that carries the JSON').toBeGreaterThanOrEqual(1);
    expect(brokenRules(JSON.stringify(h) + ' ' + sentence)).toEqual([]);
    expect('route_back' in r.out).toBe(false);
    const row = stepsRow(r.hits);
    expect(row.body.params.handoff_kind).toBe('market_answer');
    expect(row.body.params.handoff_need).toBe('lease_comps_research|news_editorial');
  }, 120_000);

  it('only `handoff` and the appended sentence differ from the kill-switched run; the UNDATED lead stays first', async () => {
    const on = await plan(DALLAS);
    process.env.DCHUB_PLAN_HANDOFF = '0';
    const off = await plan(DALLAS);
    delete process.env.DCHUB_PLAN_HANDOFF;
    expect(Object.keys(on.out).filter((k) => !(k in off.out))).toEqual(['handoff']);
    expect(Object.keys(off.out).filter((k) => !(k in on.out))).toEqual([]);
    expect(on.out.answer_guide).toBe(off.out.answer_guide + ' ' + renderHandoffSentence(on.out.handoff));
    expect(off.out.answer_guide.startsWith('UNDATED'), 'control: this run carries the UNDATED guard').toBe(true);
    expect(on.out.answer_guide.startsWith('UNDATED')).toBe(true);
    expect(off.text.includes('DC Hub covers power, grid and DCPI here')).toBe(false);
    const row = stepsRow(off.hits);
    expect('handoff_kind' in row.body.params || 'handoff_need' in row.body.params).toBe(false);
  }, 120_000);

  it('a need route_back named is not repeated: lease asked outright -> route_back has it, handoff has news alone', async () => {
    const r = await plan('rank markets in Dallas for a 200 MW AI campus with lease rates and vacancy');
    expect(r.out.route_back.map((e) => e.need)).toContain(parseRegistry(twinDoc).labels.get('lease_comps_research'));
    expect(r.out.handoff.needs.map((n) => n.need)).toEqual([parseRegistry(twinDoc).labels.get('news_editorial')]);
    for (const e of r.out.route_back) if (e.links) for (const l of e.links) expect(countUtm(l.url)).toBe(1);
    expect(stepsRow(r.hits).body.params.handoff_need).toBe('news_editorial');
  }, 120_000);

  it('capacity_search with no fit -> procurement and brokerage complement', async () => {
    listings = { ok: true, items: [], total: 0, as_of: AS_OF };
    const r = await plan(NOFIT);
    expect(r.out.intent_class).toBe('capacity_search');
    expect(r.out.executed.some((e) => e.tool === 'source_capacity' && e.status === 'executed')).toBe(true);
    expect(r.out.handoff && r.out.handoff.basis).toBe('capacity_no_fit');
    expect(r.out.handoff.for).toBe('Dallas');
    expect(stepsRow(r.hits).body.params.handoff_need).toBe('colocation_procurement|brokerage_deal_execution');
  }, 120_000);

  it('capacity_search with a match -> no complement (DC Hub answered it)', async () => {
    listings = { ok: true, total: 1, as_of: AS_OF, items: [{ id: 7, slug: 'dallas-a', market: 'Dallas', state: 'TX', capacity_kw: 20000, delivery_type: 'colocation' }] };
    try {
      const r = await plan(NOFIT);
      expect(r.out.intent_class).toBe('capacity_search');
      expect('handoff' in r.out).toBe(false);
      expect('handoff_need' in stepsRow(r.hits).body.params).toBe(false);
    } finally { listings = { ok: true, items: [], total: 0, as_of: AS_OF }; }
  }, 120_000);

  it('grid_headroom -> no complement, no log marker', async () => {
    const r = await plan(GRID);
    expect(r.out.intent_class).toBe('grid_headroom');
    expect('handoff' in r.out).toBe(false);
    expect(r.text.includes(HANDOFF_BASES.market_answer.lead) || r.text.includes(HANDOFF_BASES.capacity_no_fit.lead)).toBe(false);
    expect('handoff_kind' in stepsRow(r.hits).body.params).toBe(false);
  }, 120_000);

  it('a walled run (keyless preview) carries no complement: human_url present, no field, no sentence, no log marker', async () => {
    const r = await plan(DALLAS, '/mcp', { 'user-agent': 'test-client' });
    expect(r.out.human_url || r.out.for_your_human, 'control: this run is walled').toBeTruthy();
    expect('handoff' in r.out).toBe(false);
    expect(r.text.includes('DC Hub covers power, grid and DCPI here')).toBe(false);
    expect('handoff_need' in stepsRow(r.hits).body.params).toBe(false);
  }, 120_000);

  it('directory profiles and ChatGPT clients: no field, no sentence', async () => {
    for (const [p, hdr] of [['/mcp/claude', PRO], ['/mcp/chatgpt', PRO], ['/mcp/grok', PRO], ['/mcp', { ...PRO, 'user-agent': 'openai-mcp/1.0.0' }]]) {
      const r = await plan(DALLAS, p, hdr);
      expect(r.out && r.out._entity, p).toBe('plan_execution');
      expect('handoff' in r.out, p).toBe(false);
      expect(r.text.includes('DC Hub covers power, grid and DCPI here'), p).toBe(false);
    }
  }, 240_000);

  it('/mcp/core plan_and_answer: off by default, on only with DCHUB_CORE_HANDOFF=1', async () => {
    delete process.env.DCHUB_CORE_HANDOFF;
    const off = await plan(DALLAS, '/mcp/core', PRO, 'plan_and_answer');
    expect(off.text.length, 'control: core answered').toBeGreaterThan(200);
    expect(off.text.includes('"handoff"')).toBe(false);
    expect(off.text.includes('DC Hub covers power, grid and DCPI here')).toBe(false);
    expect('handoff' in off.r.msg.result.structuredContent).toBe(false);
    const offRow = stepsRow(off.hits);
    expect(offRow, 'control: the core run logged its plan row').toBeTruthy();
    expect('handoff_need' in offRow.body.params, 'the handler built nothing on core with the flag off').toBe(false);
    process.env.DCHUB_CORE_HANDOFF = '1';
    try {
      const on = await plan(DALLAS, '/mcp/core', PRO, 'plan_and_answer');
      const env = on.r.msg.result.structuredContent;
      expect(env.handoff && env.handoff.basis).toBe('market_answer');
      expect(env.handoff.for).toBe('Dallas');
      for (const n of env.handoff.needs) for (const o of n.owned_by) expect(countUtm(o.url)).toBe(1);
      expect(stepsRow(on.hits).body.params.handoff_need).toBe('lease_comps_research|news_editorial');
    } finally { delete process.env.DCHUB_CORE_HANDOFF; }
  }, 240_000);

  it('kill switches are independent: DCHUB_PLAN_ROUTE_BACK=0 keeps the complement; DCHUB_PLAN_HANDOFF=0 keeps route_back', async () => {
    process.env.DCHUB_PLAN_ROUTE_BACK = '0';
    try {
      const r = await plan(DALLAS);
      expect(r.out.handoff && r.out.handoff.basis).toBe('market_answer');
    } finally { delete process.env.DCHUB_PLAN_ROUTE_BACK; }
    process.env.DCHUB_PLAN_HANDOFF = '0';
    try {
      const r = await plan('rank markets in Dallas for a 200 MW AI campus with lease rates and vacancy');
      expect(Array.isArray(r.out.route_back)).toBe(true);
      expect('handoff' in r.out).toBe(false);
      expect('handoff_kind' in stepsRow(r.hits).body.params).toBe(false);
    } finally { delete process.env.DCHUB_PLAN_HANDOFF; }
  }, 240_000);
});
