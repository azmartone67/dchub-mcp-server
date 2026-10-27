// =============================================================================
// ecosystem-sync: the predicates that decide what a listing is saying, and
// whether a lane may be dispatched about it.
// -----------------------------------------------------------------------------
// No network. Every fixture is cut from a page or response measured on
// 2026-09-13, when live served 90 tools / 21,800+ facilities and the listings
// said 88, 79, 21,600+, 20K+ and "$299/mo".
//
// Each describe block carries its False branch. A guard whose negative case has
// never been seen is unverified: the 2026-08-16 Glama check asserted on a field
// that was empty for every server on earth and stayed red for five days.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  facilityFloors, parseFloor, toolClaims, isStaleTotal, bannedClaims, semverCmp,
  pickOfficial, glamaBadge, glamaLatestRelease, stripChangelogDiffs, visibleText,
  hiveItem, packCodes, usableCanon, repoDrift, judge, gate, planActions, stuckKeys,
  stuckMarker, newlyStuck, resolveScope, renderIssue, pasteLine,
  mcpserversRecord, observeMcpServers, glamaDeprecation, observeGlamaDuplicate,
  metaCardText, jsonLdText, headText, observeGlama,
  observeScannedRow, directoriesFromStanding, stuckKeys as _stuckKeys, DIRECTORY_SCAN_MAX_AGE_H,
  scanFieldReview, fieldActionCount,
  COOLDOWN_MIN, FAILURE_BACKOFF_H, PULL_GRACE_H, SELF_TAG, WORKFLOWS, SINKS, FLOOR_TOLERANCE,
  normToolText, toolTextVerdict, toolTextAnchor, toolTextCopies, staleToolTexts, staleToolReason,
  toolRecordMap, withManifestTexts,
} from '../scripts/ecosystem-sync.mjs';
import { _resolvePlatform } from '../server.mjs';

const SSOT = { tools: 90, facilities: '21,800+', deals: '2,100+', markets: '300+', version: '2.12.12', packs: ['grid'] };
const NOW = Date.parse('2026-09-13T02:11:00Z');
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();
const run = (m, conclusion = 'success', status = 'completed') => ({ created_at: minsAgo(m), status, conclusion, html_url: 'u' });

describe('facility floors: every phrasing the live surfaces use reads as one number', () => {
  it('normalises the five phrasings to the same floor', () => {
    const text = '21,800+ facilities · 21,800+ distinct facilities · 21,800+ discovered facilities · '
      + '21,800+ data-center facilities · 21,800+ data centers';
    const floors = facilityFloors(text);
    expect(floors).toEqual(['21,800+']);
    expect(parseFloor(floors[0])).toBe(21800);
  });

  it("reads PulseMCP's shorthand as a floor too", () => {
    expect(facilityFloors('Real-time data center market intelligence: 20K+ facilities, M&A deals')).toEqual(['20K+']);
    expect(parseFloor('20K+')).toBe(20000);
  });

  it('does not read a substation or asset count as a facility floor', () => {
    expect(facilityFloors('127,000+ substations and 320,000+ mapped power/grid/gas/fiber assets')).toEqual([]);
  });

  // ★2026-09-27 the facility COUNT is withdrawn (owner decision) until a
  // corroborated "r3" count lands: any facility floor is drift, and a surface
  // showing none is in sync on facilities.
  it('names every floor on one surface, and each is drift', () => {
    const v = judge({ read: true, floors: ['21,800+', '21,600+'] }, SSOT);
    expect(v.state).toBe('drift');
    expect(v.reasons).toEqual(['says 21,800+ / 21,600+ facilities — count withdrawn — owner decision 2026-09-27']);
  });

  it('a floor EQUAL to canon is drift too: the count is withdrawn, not stale', () => {
    const v = judge({ read: true, floors: ['21,800+'] }, SSOT);
    expect(v.state).toBe('drift');
    expect(v.reasons.join(' ')).toMatch(/count withdrawn — owner decision 2026-09-27/);
  });

  it('CONTROL: a surface with no facility number is in sync', () => {
    expect(judge({ read: true, floors: [] }, SSOT)).toEqual({ state: 'in_sync', reasons: [] });
    expect(judge({ read: true, floors: facilityFloors('a global data-center facility map') }, SSOT))
      .toEqual({ state: 'in_sync', reasons: [] });
  });

  it('judges floors even when canon was not live this cycle: no canon value could make one right', () => {
    const v = judge({ read: true, floors: ['21,500+'] }, { ...SSOT, facilities: null });
    expect(v.state).toBe('drift');
  });
});

describe('tool counts: a stale TOTAL is flagged, a pack size is not', () => {
  it('flags the totals the listings carried', () => {
    for (const n of [88, 83, 79]) expect(isStaleTotal(n, 90)).toBe(true);
  });

  it('ignores pack sizes and other servers on an aggregator page', () => {
    for (const n of [2, 10, 16, 18, 46, 90]) expect(isStaleTotal(n, 90)).toBe(false);
  });

  it('reads the mcp.so listing as three separate drifts', () => {
    const page = 'Live data-center, grid, fiber & M&A intelligence for AI agents — 79 tools, 12,650+ facilities. '
      + 'Starter: $9/mo. Developer: $49/mo. Pro: $299/mo for 2,000 calls/day.';
    const v = judge({ read: true, floors: facilityFloors(page), toolClaims: toolClaims(page), banned: bannedClaims(page) }, SSOT);
    expect(v.state).toBe('drift');
    expect(v.reasons).toEqual([
      'says 79 tools (live 90)',
      'says 12,650+ facilities — count withdrawn — owner decision 2026-09-27',
      'banned pricing copy: $299',
    ]);
  });

  it('an authoritative count that differs is drift on its own', () => {
    expect(judge({ read: true, tools: 88 }, SSOT).reasons).toEqual(['serves 88 tools (live 90)']);
  });
});

describe('pricing: Pro is $99, never $299, and there is no Founding offer', () => {
  it('flags the retired prices and the retired offer', () => {
    expect(bannedClaims('Pro $299/mo · was $199 · Founding $99/mo while seats last').sort())
      .toEqual(['$199', '$299', 'Founding']);
  });

  it('leaves the real prices and look-alike words alone', () => {
    expect(bannedClaims('Pro $99/mo · Developer $49/mo · $1,299 enterprise · $2990 · rounding · grounding')).toEqual([]);
  });
});

describe('Glama: read the badge, not every number on the page', () => {
  const PAGE = '<p>With 82 tools, this server is extremely heavy compared to typical MCP servers (3-15 tools)</p>'
    + '<li>Previous value: -&quot;ADVISORY router: collapses 88 tools, 21,600+ facilities&quot; '
    + 'New value: +&quot;ADVISORY router: collapses 90 tools, 21,800+ facilities&quot;</li>'
    + '<div id="tools"><h2 class="jsgMqa jRXFuD">Available Tools</h2><span class="bZBozA">90<!-- --> tool<!-- -->s</span></div>'
    + '<span>8<!-- --> tool<!-- --> <!-- -->updates<code class="czikZZ">v<!-- -->2.12.10</code></span><time class="x" dateTime="2026-09-09T22:22:31.845206Z"></time>'
    + '<span><code class="czikZZ">v<!-- -->2.12.12</code></span><time class="x" dateTime="2026-09-13T00:36:00.529351Z"></time>';

  it('takes the Available Tools badge', () => {
    expect(glamaBadge(PAGE)).toBe(90);
  });

  it('shows why: a loose scan of the same page reads four numbers', () => {
    expect(toolClaims(visibleText(PAGE))).toEqual([15, 82, 88, 90]);
  });

  it("drops the changelog's previous values before reading floors", () => {
    expect(facilityFloors(visibleText(PAGE))).toContain('21,600+');
    expect(facilityFloors(stripChangelogDiffs(visibleText(PAGE)))).toEqual(['21,800+']);
  });

  it('picks the newest release by date, not by page order', () => {
    expect(glamaLatestRelease(PAGE)).toEqual({ version: '2.12.12', at: '2026-09-13T00:36:00.529351Z' });
  });

  it('returns null when Glama has not introspected a build', () => {
    expect(glamaBadge('<h2>Overview</h2><p>90 tools</p>')).toBeNull();
  });
});

describe('official registry: our isLatest entry by name, never the first row', () => {
  const OFF = 'io.modelcontextprotocol.registry/official';
  const PUB = 'io.modelcontextprotocol.registry/publisher-provided';
  const entry = (name, version, isLatest, status, toolCount) => ({
    server: { name, version, description: 'Live power, energy, grid — query and cite.', _meta: { [PUB]: { toolCount } } },
    _meta: { [OFF]: { isLatest, status, publishedAt: '2026-09-11T22:03:44Z' } },
  });
  const BODY = { servers: [
    entry('cloud.dchub/mcp-server', '1.0.0', false, 'deprecated', 19),
    entry('cloud.dchub/datacenter-power-grid-fiber', '2.12.9', true, 'deprecated', 88),
    entry('cloud.dchub/mcp-server', '2.12.12', true, 'active', 90),
    entry('io.github.someone/other', '9.9.9', true, 'active', 5),
  ] };

  it('selects the current version of our name and its tool count', () => {
    const o = pickOfficial(BODY, 'cloud.dchub/mcp-server');
    expect(o).toMatchObject({ found: true, version: '2.12.12', status: 'active', toolCount: 90 });
  });

  it('reports the orphaned name in our namespace, and nobody else', () => {
    expect(pickOfficial(BODY, 'cloud.dchub/mcp-server').others)
      .toEqual([{ name: 'cloud.dchub/datacenter-power-grid-fiber', version: '2.12.9', status: 'deprecated' }]);
  });

  it('compares versions numerically', () => {
    expect(semverCmp('2.12.10', '2.12.9')).toBe(1);
    expect(semverCmp('2.12.9', '2.12.12')).toBe(-1);
    expect(semverCmp('2.12.12', '2.12.12')).toBe(0);
  });

  it('says not found rather than guessing', () => {
    expect(pickOfficial({ servers: [] }, 'cloud.dchub/mcp-server').found).toBe(false);
  });
});

describe('canon: only a body the daily heal would accept is a source', () => {
  const LIVE = { ok: true, cold: false, source: 'resolve_public_floors (live)', tools: 90, facilities: '21,800+', deals: '2,100+', markets: '300+', countries: '170+', substations: '127,000+' };
  const COLD = { ok: true, cold: true, source: 'resolve_public_floors (cold: PINNED floors)', tools: 90, facilities: '21,500+' };

  it('accepts a live body', () => {
    expect(usableCanon(LIVE).canon).toMatchObject({ tools: 90, facilities: '21,800+' });
  });

  it('refuses the cold pinned body that put 21,500+ beside 21,800+', () => {
    expect(usableCanon(COLD).canon).toBeNull();
  });

  it('fails loudly on a marker nobody taught it', () => {
    expect(usableCanon({ ...LIVE, source: 'resolve_public_floors (warmish)' }).verdict).toBe('fail');
  });
});

describe("What's New: the published MCP pack cards", () => {
  it('reads pack names from the pack cards only', () => {
    const body = { platform: [
      { id: 'nav', tag: 'Navigation', code: null },
      { id: 'mcp-pack-grid', tag: 'MCP pack', code: '/mcp/grid' },
      { id: 'mcp-pack-deepresearch', tag: 'MCP pack', code: '/mcp/deepresearch' },
      { id: 'bad', tag: 'MCP pack', code: '/mcp/grid?x=1' },
    ] };
    expect(packCodes(body)).toEqual(['deepresearch', 'grid']);
  });

  it('an unreadable feed yields no packs, not an error', () => {
    expect(packCodes(null)).toEqual([]);
  });
});

describe('repo drift: what the daily heal would change', () => {
  const snapshot = { tools: 90, facilities: '21,600+', deals: '2,100+', markets: '300+', countries: '170+', substations: '127,000+' };
  const canon = { ...snapshot, facilities: '21,800+' };
  const serverJson = { _meta: { 'io.modelcontextprotocol.registry/publisher-provided': { toolCount: 88 } } };

  it('names each field that moved', () => {
    expect(repoDrift({ snapshot, canon, serverJson, liveTools: 90 })).toEqual([
      'canon_phrases.json facilities 21,600+ -> 21,800+',
      'server.json toolCount 88 -> 90',
    ]);
  });

  it('is empty when the repo already carries the live source', () => {
    const ok = { _meta: { 'io.modelcontextprotocol.registry/publisher-provided': { toolCount: 90 } } };
    expect(repoDrift({ snapshot: canon, canon, serverJson: ok, liveTools: 90 })).toEqual([]);
  });

  it('does not invent drift from a canon it could not read', () => {
    expect(repoDrift({ snapshot, canon: null, serverJson: { _meta: {} }, liveTools: 90 })).toEqual([]);
  });
});

describe('the planner: act on drift, never blind, never twice', () => {
  const quiet = { heal: [run(300)], registry: [run(300)], smithery: [run(600)] };
  const base = { healDrift: ['canon_phrases.json facilities 21,600+ -> 21,800+'], registryBehind: '', smitheryReasons: [], openHealPrs: [], now: NOW };

  it('dispatches the heal when the repo is behind and the lane is idle', () => {
    expect(planActions({ ...base, runs: quiet }).heal.dispatch).toBe(true);
  });

  it('dispatches nothing when the Actions API could not be read', () => {
    const p = planActions({ ...base, registryBehind: 'x', smitheryReasons: ['y'], runs: null });
    expect([p.heal.dispatch, p.registry.dispatch, p.smithery.dispatch]).toEqual([false, false, false]);
    expect(p.heal.why).toMatch(/blind/);
  });

  it('waits for an open heal PR instead of opening a second one', () => {
    const p = planActions({ ...base, runs: quiet, openHealPrs: [{ number: 408 }] });
    expect(p.heal).toMatchObject({ dispatch: false });
    expect(p.heal.why).toMatch(/#408/);
  });

  it('holds inside the cooldown and while a run is queued', () => {
    expect(gate('heal', { heal: [run(COOLDOWN_MIN.heal - 1)] }, NOW).ok).toBe(false);
    expect(gate('heal', { heal: [run(COOLDOWN_MIN.heal + 1)] }, NOW).ok).toBe(true);
    expect(gate('heal', { heal: [run(1, null, 'queued')] }, NOW).ok).toBe(false);
  });

  it('backs off a lane that just failed, then tries again', () => {
    const inside = FAILURE_BACKOFF_H.smithery * 60 - 5;
    const after = FAILURE_BACKOFF_H.smithery * 60 + 5;
    expect(gate('smithery', { smithery: [run(inside, 'failure')] }, NOW)).toMatchObject({ ok: false, failing: true });
    expect(gate('smithery', { smithery: [run(after, 'failure')] }, NOW).ok).toBe(true);
  });

  it('touches the registry and Smithery only when they drifted', () => {
    const idle = planActions({ ...base, healDrift: [], runs: quiet });
    expect([idle.heal.dispatch, idle.registry.dispatch, idle.smithery.dispatch]).toEqual([false, false, false]);
    const moved = planActions({ ...base, healDrift: [], registryBehind: 'registry 2.12.11 < 2.12.12', smitheryReasons: ['serves 88 tools (live 90)'], runs: quiet });
    expect([moved.registry.dispatch, moved.smithery.dispatch]).toEqual([true, true]);
  });
});

describe('escalation: who needs a person, and when to say so', () => {
  const r = (key, kind, state) => ({ key, kind, label: key, fix: 'f', verdict: { state, reasons: state === 'drift' ? ['says 88 tools (live 90)'] : [] } });
  const results = [
    r('mcp_so', 'manual', 'drift'), r('glama_server', 'pull', 'drift'), r('agent_card', 'ours', 'drift'),
    r('pulsemcp', 'manual', 'unreadable'), r('smithery', 'push', 'in_sync'),
  ];

  it('a manual listing is stuck the moment it drifts; ours and unreadable never are', () => {
    expect(stuckKeys(results, { hoursSinceChange: 1 })).toEqual(['mcp_so']);
  });

  it('a pull listing is stuck only once its re-crawl window has passed', () => {
    expect(stuckKeys(results, { hoursSinceChange: PULL_GRACE_H + 1 })).toEqual(['glama_server', 'mcp_so']);
  });

  it('an unknown change time pages rather than buying silence', () => {
    expect(stuckKeys(results, { hoursSinceChange: null })).toEqual(['glama_server', 'mcp_so']);
  });

  it('comments only about listings that were not stuck last time', () => {
    const body = renderIssue({ ssot: SSOT, results, stuck: ['mcp_so'], plan: planActions({ healDrift: [], runs: null, openHealPrs: [], now: NOW }), generatedAt: 't', scope: 'full' });
    expect(stuckMarker(body)).toEqual(['mcp_so']);
    expect(newlyStuck(stuckMarker(body), ['glama_server', 'mcp_so'])).toEqual(['glama_server']);
    expect(newlyStuck(stuckMarker(body), ['mcp_so'])).toEqual([]);
  });

  it('a previous body it could not read produces no comment at all', () => {
    expect(newlyStuck(null, ['mcp_so'])).toEqual([]);
  });

  it('the paste line is built from the live source and quotes no banned price', () => {
    const line = pasteLine(SSOT);
    expect(line).toContain('90 MCP tools');
    expect(line).toContain('a global data-center facility map');
    expect(line).not.toMatch(/corroborated count pending/i);
    expect(facilityFloors(line)).toEqual([]);
    expect(bannedClaims(line)).toEqual([]);
  });

  it('an unreadable read is never drift and never clean', () => {
    expect(judge({ read: false, error: 'HTTP 403' }, SSOT)).toEqual({ state: 'unreadable', reasons: ['HTTP 403'] });
  });
});

describe('scope: the full listing sweep runs every second hour', () => {
  it('derives it from the clock when not told', () => {
    expect(resolveScope('auto', new Date('2026-09-13T02:11:00Z'))).toBe('full');
    expect(resolveScope('auto', new Date('2026-09-13T03:11:00Z'))).toBe('core');
    expect(resolveScope('auto', new Date('2026-09-13T02:41:00Z'))).toBe('core');
    expect(resolveScope('core', new Date('2026-09-13T02:11:00Z'))).toBe('core');
  });
});

describe('MCP Hive: our record, not the other providers on the page', () => {
  it('finds the item that names DC Hub', () => {
    const doc = { '@type': 'ItemList', itemListElement: [
      { item: { name: 'Slacking.biz', description: 'SEC data — 46 MCP tools' } },
      { item: { name: 'DC Hub', description: 'The live data-center layer — 21,200+ verified facilities, 88 tools.' } },
    ] };
    const html = `<script type="application/ld+json">${JSON.stringify(doc)}</script>`;
    const item = hiveItem(html);
    expect(item.name).toBe('DC Hub');
    expect(judge({ read: true, floors: facilityFloors(item.description), toolClaims: toolClaims(item.description) }, SSOT).reasons)
      .toEqual(['says 88 tools (live 90)', 'says 21,200+ facilities — count withdrawn — owner decision 2026-09-27']);
  });

  it('returns null when we are not on the page', () => {
    expect(hiveItem('<script type="application/ld+json">{"itemListElement":[{"item":{"name":"Weather API"}}]}</script>')).toBeNull();
  });
});

describe('verify-only listings: watched every full sweep, never a request to anyone', () => {
  const r = (key, kind, state) => ({ key, kind, label: key, fix: 'verify-only. f', url: `https://example.test/${key}`,
    verdict: { state, reasons: state === 'drift' ? ['says 20K+ facilities (canon 21,800+)'] : [] } });
  const results = [r('pulsemcp', 'watch', 'drift'), r('mcp_so', 'manual', 'drift'), r('glama_server', 'watch', 'drift')];

  it('a watch listing that drifts is never stuck, whatever the change time', () => {
    for (const hoursSinceChange of [1, PULL_GRACE_H + 1, null]) {
      expect(stuckKeys(results, { hoursSinceChange })).toEqual(['mcp_so']);
    }
  });

  it('the issue reports it under Verify-only, never in the stuck table or the catch-up list', () => {
    const body = renderIssue({ ssot: SSOT, results, stuck: ['mcp_so'], plan: planActions({ healDrift: [], runs: null, openHealPrs: [], now: NOW }), generatedAt: 't', scope: 'full' });
    const [head, rest] = body.split('### Verify-only');
    expect(rest).toContain('- [pulsemcp](https://example.test/pulsemcp): says 20K+ facilities (canon 21,800+). verify-only. f');
    expect(rest).toContain('- [glama_server](https://example.test/glama_server): ');
    expect(head).toContain('| [mcp_so](https://example.test/mcp_so) |');
    expect(head).not.toMatch(/pulsemcp|glama_server/);
  });

  it('no fix text asks anyone to email a directory, and the listings with no lever are verify-only', () => {
    for (const [key, s] of Object.entries(SINKS)) {
      expect(s.fix, key).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}|\be-?mail\b/i);
    }
    for (const key of ['pulsemcp', 'mcpservers_org', 'glama_server', 'glama_duplicate', 'mcp_so', 'mcp_so_secondary', 'mcp_hunter']) {
      expect(SINKS[key].kind, key).toBe('watch');
      expect(SINKS[key].fix, key).toMatch(/^verify-only\. /);
    }
  });
});

describe('mcpservers.org: the card is our record, not the servers printed beside it', () => {
  // Shape cut from the live page on 2026-09-15: one seroval payload holds a
  // sponsor record before ours and related servers after it, each with its own
  // description. Ours is the record whose slug is ours.
  const SLUG = 'azmartone67/dchub-mcp-server';
  const page = 'featured:$R[21]=[$R[22]={id:9001,slug:"adsos/adsos",registryName:null,name:"AdsOS",description:"Ad automation with 40 tools",content:null}],'
    + 'l:$R[26]={server:$R[27]={id:7674,slug:"azmartone67/dchub-mcp-server",registryName:null,name:"DC Hub — Data Center Intelligence MCP Server",'
    + 'description:"Data center intelligence MCP server — search 20,000+ facilities across 140+ countries, monitor real-time grid \\"fuel mix\\". 15 tools via Streamable HTTP. Free tier included.",'
    + 'content:null,url:"https://github.com/azmartone67/dchub-mcp-server",websiteUrl:null,category:"productivity",official:!1,featured:!1,historicalImport:!1,'
    + 'updatedAt:null,repoPushedAt:$R[29]=new Date("2026-09-14T19:39:09.000Z"),remoteEndpoints:$R[30]=[]},descriptionTranslationFallback:!1,'
    + 'relatedServers:$R[32]=[$R[33]={id:6767,slug:"propbar/mcp",registryName:null,name:"Propbar",description:"UK property data near 21,800+ data centres, 88 tools",content:null}]';

  it('reads the stored description, when it was last updated, and the repo clock', () => {
    const rec = mcpserversRecord(page, SLUG);
    expect(rec.name).toBe('DC Hub — Data Center Intelligence MCP Server');
    expect(rec.description).toMatch(/^Data center intelligence MCP server — search 20,000\+/);
    expect(rec.description).toContain('grid "fuel mix". 15 tools');
    expect(rec.updatedAt).toBeNull();
    expect(rec.repoPushedAt).toBe('2026-09-14T19:39:09.000Z');
  });

  it("judges the card alone: its floor and its tool count, never a neighbour's", () => {
    expect(judge(observeMcpServers(page, SSOT, SLUG), SSOT).reasons)
      .toEqual(['says 20,000+ facilities — count withdrawn — owner decision 2026-09-27', 'card says 15 tools (live 90)']);
  });

  it('a page without our record is unreadable, never clean', () => {
    const wall = '<html><title>Just a moment...</title></html>';
    expect(mcpserversRecord(wall, SLUG)).toBeNull();
    expect(judge(observeMcpServers(wall, SSOT, SLUG), SSOT).state).toBe('unreadable');
    // A record that lost its description must not borrow the next server's.
    expect(mcpserversRecord(page.replace('description:"Data center', 'summary:"Data center'), SLUG)).toBeNull();
  });
});

describe('Glama duplicate connector: demoted stays demoted', () => {
  // Cut from both connector pages on 2026-09-15. The duplicate renders a banner
  // and its payload carries deprecatedAt; the keeper's payload names the key
  // with no value after it. The duplicate's frozen AI review is never judged.
  const dupe = '<strong>This connector has been deprecated</strong><div class="iPpNxm"><p>duplicate</p></div>'
    + '<script>\\"cloud.dchub/dc-hub-data-center-intelligence-mcp-server\\",\\"claimable\\",\\"deprecatedAt\\",\\"2026-09-05T17:14:48.727945Z\\",'
    + '\\"deprecationComment\\",\\"duplicate\\",\\"With 82 tools, this server is extremely over-scoped. 21,800+ facilities\\"</script>';
  const keeper = '<script>\\"cloud.dchub/mcp-server\\",\\"claimable\\",\\"deprecatedAt\\",\\"deprecationComment\\",\\"Live power, energy\\"</script>';

  it('in sync while Glama shows it deprecated, whatever its frozen review says', () => {
    expect(glamaDeprecation(dupe)).toEqual({ deprecated: true, at: '2026-09-05T17:14:48.727945Z' });
    expect(judge(observeGlamaDuplicate(dupe), SSOT)).toEqual({ state: 'in_sync', reasons: [] });
  });

  it('drift the moment it is live again', () => {
    expect(glamaDeprecation(keeper)).toEqual({ deprecated: false, at: null });
    expect(judge(observeGlamaDuplicate(keeper), SSOT).state).toBe('drift');
  });

  it('a page with neither marker is unreadable, never clean', () => {
    expect(glamaDeprecation('<p>cloud.dchub</p>')).toBeNull();
    expect(judge(observeGlamaDuplicate('<p>cloud.dchub</p>'), SSOT).state).toBe('unreadable');
  });
});

describe('the probe is our own traffic, by the server\'s own rule', () => {
  it('SELF_TAG classifies as internal even on a replica that never saw initialize', () => {
    const call = { method: 'tools/call', params: { name: 'search' } };
    expect(_resolvePlatform(call, 'node', SELF_TAG, 'sid-never-minted-here')).toBe('dchub-internal');
  });
});

describe('the workflow dispatches exactly the lanes the planner names', () => {
  const wf = readFileSync(new URL('../.github/workflows/ecosystem-sync.yml', import.meta.url), 'utf8');

  it('each lane exists and has its own dispatch step', () => {
    for (const file of Object.values(WORKFLOWS)) {
      expect(existsSync(new URL(`../.github/workflows/${file}`, import.meta.url))).toBe(true);
      expect(wf).toContain(`gh workflow run ${file} --ref main`);
    }
  });

  it('the full-sweep cron the scope expression tests for is a real schedule line', () => {
    const full = wf.match(/github\.event\.schedule == '([^']+)'/)?.[1];
    expect(full).toBeTruthy();
    expect(wf).toContain(`- cron: '${full}'`);
  });
});

// 2026-09-25 introduced a tolerance for a conservative floor on a hosted
// listing (24,500+ vs canon 24,600+). ★2026-09-27 the facility COUNT is
// withdrawn (owner decision), so no floor is conservative any more: every kind
// of listing is judged the same way, and a floor is drift in any position.
describe('a facility floor on a hosted listing is drift of every kind (count withdrawn 2026-09-27)', () => {
  const CANON = { ...SSOT, facilities: '24,600+' };
  const hosted = (floors) => judge({ read: true, floors }, CANON, { kind: 'manual' });

  for (const f of ['24,500+', '24,600+', '24,700+', '21,800+']) {
    it(`${f} -> drift, no conservative-floor note`, () => {
      const v = hosted([f]);
      expect(v.state).toBe('drift');
      expect(v.reasons).toEqual([`says ${f} facilities — count withdrawn — owner decision 2026-09-27`]);
      expect(v.notes).toBeUndefined();
    });
  }

  it('applies to every kind: ours, push, pull, watch, manual and an unstated kind', () => {
    for (const opts of [{ kind: 'ours' }, { kind: 'push' }, { kind: 'pull' }, { kind: 'watch' }, { kind: 'manual' }, {}]) {
      expect(judge({ read: true, floors: ['24,500+'] }, CANON, opts).state).toBe('drift');
      expect(judge({ read: true, floors: [] }, CANON, opts).state).toBe('in_sync');
    }
  });

  it('a drifted listing prints the withdrawal reason, never "conservative floor"', () => {
    const results = [{ key: 'mcphive', kind: 'manual', label: 'MCP Hive', fix: 'f', verdict: hosted(['24,500+']) }];
    const body = renderIssue({ ssot: CANON, results, stuck: ['mcphive'], plan: planActions({ healDrift: [], runs: null, openHealPrs: [], now: NOW }), generatedAt: 't', scope: 'full' });
    expect(body).toMatch(/says 24,500\+ facilities — count withdrawn — owner decision 2026-09-27/);
    expect(body).not.toMatch(/conservative floor/);
  });
});

describe('mcp.so is verify-only: its edit form refuses published listings (owner, 2026-09-24)', () => {
  it('both mcp.so listings are watch; LobeHub and MCP Hive stay a person\'s job', () => {
    expect(SINKS.mcp_so.kind).toBe('watch');
    expect(SINKS.mcp_so_secondary.kind).toBe('watch');
    expect(SINKS.lobehub.kind).toBe('manual');
    expect(SINKS.mcphive.kind).toBe('manual');
  });

  it('the banned $299 still prints on the verify-only row, and mcp.so is never stuck', () => {
    const verdict = judge({ read: true, tools: null, toolClaims: [79], floors: ['12,650+'], banned: ['$299'] }, SSOT, { kind: SINKS.mcp_so.kind });
    const results = [{ key: 'mcp_so', kind: SINKS.mcp_so.kind, label: SINKS.mcp_so.label, fix: SINKS.mcp_so.fix, url: SINKS.mcp_so.url, verdict }];
    expect(verdict.state).toBe('drift');
    expect(stuckKeys(results, { hoursSinceChange: null })).toEqual([]);
    const body = renderIssue({ ssot: SSOT, results, stuck: [], plan: planActions({ healDrift: [], runs: null, openHealPrs: [], now: NOW }), generatedAt: 't', scope: 'full' });
    const rest = body.split('### Verify-only')[1] || '';
    expect(rest).toMatch(/\[mcp\.so\]\(https:\/\/mcp\.so\/servers\/dchub-mcp-server\): [^\n]*banned pricing copy: \$299/);
    expect(stuckMarker(body)).toEqual([]);
  });
});

describe('Glama <head> card: meta / og / JSON-LD are read, not only the body', () => {
  // QA 2026-09-25 (21:29-21:44 PT) read this card in the server page's meta
  // description, og:description and SoftwareApplication JSON-LD while #410
  // reported only the body's 22,100+. visibleText() deletes every tag, so a
  // meta attribute and a <script type="application/ld+json"> never reached
  // the reader. Canon that day: 92 tools, 24,600+ facilities.
  const CANON = { tools: 92, facilities: '24,600+', version: '2.12.21' };
  const STALE_CARD = 'AI agents call 92 tools across 22,900+ facilities for land+power, grid and fiber. Pro $99/mo (never $299/Founding).';
  // ★2026-09-27: the clean card carries no facility number (count withdrawn).
  const CLEAN_CARD = 'AI agents call 92 tools across a global data-center facility map for land+power, grid and fiber. Pro $99/mo.';
  const head = (card) => `<head><meta content="${card}" name="description"/>`
    + `<meta property="og:description" content="${card}"/>`
    + '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@graph': [
      { '@type': 'Organization', name: 'Glama', description: 'Host org: 10,000+ data centers' },
      { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: { name: 'Other server', description: '5,000+ facilities' } }] },
      { '@type': 'SoftwareApplication', name: 'DC Hub', description: card },
    ] }) + '</script></head>';
  const body = '<body><p>DC Hub: global facility map</p><div id="tools"><h2 class="x">Available Tools</h2><span>92<!-- --> tool<!-- -->s</span></div></body>';

  it('the body-only read cannot see the card (the defect)', () => {
    expect(facilityFloors(visibleText(head(STALE_CARD) + body))).toEqual([]);
    expect(bannedClaims(visibleText(head(STALE_CARD) + body))).toEqual([]);
  });

  it('reads meta / og and the SoftwareApplication node, never the host Organization or a related-server list', () => {
    expect(metaCardText(head(STALE_CARD))).toContain('22,900+ facilities');
    const ld = jsonLdText(head(STALE_CARD));
    expect(ld).toContain('22,900+ facilities');
    expect(ld).not.toContain('10,000+');
    expect(ld).not.toContain('5,000+');
    expect(facilityFloors(headText(head(STALE_CARD)))).toEqual(['22,900+']);
  });

  it('a stale card is drift: floor below tolerance, dual floor, banned copy', () => {
    const v = judge(observeGlama(head(STALE_CARD) + body), CANON, { kind: SINKS.glama_server.kind });
    expect(v.state).toBe('drift');
    const why = v.reasons.join(' | ');
    expect(why).toMatch(/22,900\+/);
    expect(why).toMatch(/banned pricing copy: \$299, Founding/);
  });

  it('the card Glama serves once it catches up is in sync', () => {
    expect(judge(observeGlama(head(CLEAN_CARD) + body), CANON, { kind: SINKS.glama_server.kind }))
      .toEqual({ state: 'in_sync', reasons: [] });
  });

  it('tool claims come from the meta card only, so the body AI review is not re-read', () => {
    const review = '<p>With 82 tools, this server is heavy</p>';
    expect(observeGlama(head(CLEAN_CARD) + body + review).toolClaims).toEqual([92]);
    expect(judge(observeGlama(head(CLEAN_CARD.replace('92 tools', '88 tools')) + body), CANON, { kind: 'watch' }).reasons.join(' '))
      .toMatch(/says 88 tools \(live 92\)/);
  });

  it('the deprecated duplicate is drift when its card is stale, in sync when its card is clean', () => {
    const dep = '<strong>This connector has been deprecated</strong>'
      + '<script>\\"cloud.dchub/dc-hub-data-center-intelligence-mcp-server\\",\\"deprecatedAt\\",\\"2026-09-05T17:14:48.727945Z\\"</script>';
    const stale = judge(observeGlamaDuplicate(head(STALE_CARD) + dep), CANON, { kind: SINKS.glama_duplicate.kind });
    expect(stale.state).toBe('drift');
    expect(stale.reasons.join(' | ')).toMatch(/22,900\+.*\|.*banned pricing copy/);
    expect(judge(observeGlamaDuplicate(head(CLEAN_CARD) + dep), CANON, { kind: SINKS.glama_duplicate.kind }))
      .toEqual({ state: 'in_sync', reasons: [] });
  });
});

describe('the #410 issue body never prints a banned price itself', () => {
  // ★2026-10 (owner rule 09-27): the header used to say "Pro is $99/mo"; the
  // only public price is the $10 pack, so it now names that and no monthly price.
  it('the paste-line header names only the $10 pack, no monthly price, and no banned figure', () => {
    const results = [{ key: 'mcphive', kind: 'manual', label: 'MCP Hive', fix: 'f', verdict: { state: 'drift', reasons: ['says 88 tools (live 90)'] } }];
    const body = renderIssue({ ssot: SSOT, results, stuck: ['mcphive'], plan: planActions({ healDrift: [], runs: null, openHealPrs: [], now: NOW }), generatedAt: 't', scope: 'full' });
    const header = body.split('\n').find((l) => l.startsWith('Paste-ready line'));
    expect(header).toContain('$10 one-time pack of 1,000 API credits');
    expect(header).not.toMatch(/\$\s?\d[\d,]*(?:\.\d+)?\s*(?:\/\s*(?:mo|month)\b|per month|a month)/i);
    expect(body).not.toMatch(/\$\s?\d[\d,]*(?:\.\d+)?\s*(?:\/\s*(?:mo|month)\b|per month|a month)/i);
    expect(bannedClaims(header)).toEqual([]);
    expect(bannedClaims(body)).toEqual([]);
  });
});

describe('toolClaims: a listing figure quoted as their copy', () => {
  it('ignores a listing figure the page labels as their copy, not ours', () => {
    const row = 'mcp.so lists 79 tools (their copy; we serve 92)';
    expect(toolClaims(row)).toEqual([]);
    expect(judge({ read: true, toolClaims: toolClaims(row) }, SSOT).reasons).toEqual([]);
    // our own stale claim beside it is still caught; an unlabelled "lists" is not exempt
    expect(toolClaims(`${row}. DC Hub serves 79 tools.`)).toEqual([79]);
    expect(toolClaims('mcp.so lists 79 tools')).toEqual([79]);
  });
});

describe('facilityFloors: a floor quoted from a listing on /mcp-standing', () => {
  it('ignores a floor the page attributes to a listing ("still read"), not to us', () => {
    const row = 'stale listing: on 2026-10-07 its description still read \u201c20K+ facilities\u201d and it prints no tool count';
    expect(facilityFloors(row)).toEqual([]);
    // our own floor beside it is still caught; an unquoted floor is not exempt
    expect(facilityFloors(`${row}. DC Hub tracks 20K+ facilities.`)).toEqual(['20K+']);
    expect(facilityFloors('its description is 20K+ facilities')).toEqual(['20K+']);
  });
});

// ── /mcp/directories rows, from the backend's 6-hourly scan (2026-10-24) ──
describe('directories.json rows via /api/v1/mcp/standing', () => {
  const plan0 = () => planActions({ healDrift: [], runs: null, openHealPrs: [], now: NOW });
  const T = Date.parse('2026-10-24T01:00:00Z');
  const standing = (asOf, rows) => ({ measured: { directories: { as_of: asOf, rows } } });
  const ROWS = [
    { id: 'kept', name: 'Kept', display: 'Live', listing_url: 'https://kept.dev' },
    { id: 'gone', name: 'Gone', display: 'Not found', listing_url: 'https://gone.dev', check: { http_status: 404 } },
    { id: 'pr', name: 'PR', display: 'Pending', listing_url: null },
    { id: 'upd', name: 'Upd', display: 'Updating', listing_url: 'https://upd.dev' },
  ];

  it('a row the scan found is in sync; one it did not find is drift with the status', () => {
    expect(judge(observeScannedRow(ROWS[0]), null).state).toBe('in_sync');
    const v = judge(observeScannedRow(ROWS[1]), null);
    expect(v.state).toBe('drift');
    expect(v.reasons[0]).toMatch(/did not find DC Hub on the page \(HTTP 404\)/);
  });

  it('pending, updating and checking rows are not judged at all', () => {
    expect(observeScannedRow(ROWS[2])).toBeNull();
    expect(observeScannedRow(ROWS[3])).toBeNull();
    expect(observeScannedRow({ display: 'Checking' })).toBeNull();
  });

  it('a fresh scan yields the live and missing rows only', () => {
    const d = directoriesFromStanding(standing('2026-10-23T23:20:59+00:00', ROWS), T);
    expect(d.read).toBe(true);
    expect(d.rows.map((r) => r.row.id)).toEqual(['kept', 'gone']);
  });

  it('a row no longer live in the file is not reported, even if the scan had it', () => {
    const d = directoriesFromStanding(standing('2026-10-23T23:20:59+00:00', ROWS), T, new Set(['kept']));
    expect(d.rows.map((r) => r.row.id)).toEqual(['kept']);
  });

  it('a stale, undated or empty scan is unreadable, never clean', () => {
    const old = new Date(T - (DIRECTORY_SCAN_MAX_AGE_H + 1) * 3600000).toISOString();
    expect(directoriesFromStanding(standing(old, ROWS), T)).toMatchObject({ read: false, error: expect.stringMatching(/h old/) });
    expect(directoriesFromStanding(standing('', ROWS), T).read).toBe(false);
    expect(directoriesFromStanding(standing('2026-10-23T23:20:59Z', []), T).read).toBe(false);
    expect(directoriesFromStanding(null, T).read).toBe(false);
  });

  it('a dropped row is listed in the issue, never as stuck and never under In sync', () => {
    const mk = (id, obs) => ({ key: `dir:${id}`, label: id, kind: 'directory', url: `https://${id}.dev`, fix: `row ${id}`, obs, verdict: judge(obs, null) });
    const results = [
      mk('kept', observeScannedRow(ROWS[0])),
      mk('gone', observeScannedRow(ROWS[1])),
    ];
    expect(_stuckKeys(results, { hoursSinceChange: 99 })).toEqual([]);
    const body = renderIssue({ ssot: SSOT, results, stuck: [], plan: plan0(), generatedAt: 't', scope: 'full' });
    expect(body).toContain('1 of 2 live rows in `canonical/directories.json` were found by the 6-hourly listing scan');
    expect(body).toMatch(/\| \[gone\]\(https:\/\/gone\.dev\) \| the 6-hourly scan did not find DC Hub/);
    expect(body).not.toMatch(/### In sync[\s\S]*kept/);
  });

  it('with every row found the section says so and lists no table', () => {
    const results = [{ key: 'dir:k', label: 'k', kind: 'directory', url: 'https://k.dev', fix: '', obs: { read: true }, verdict: { state: 'in_sync', reasons: [] } }];
    const body = renderIssue({ ssot: SSOT, results, stuck: [], plan: plan0(), generatedAt: 't', scope: 'full' });
    expect(body).toContain('1 of 1 live rows');
    expect(body).not.toContain('| row | what the page shows now |');
  });
});

// ── field review: what a Live page shows vs canon (2026-10-27) ──────────────
describe('field review from the backend scan', () => {
  const plan0 = () => planActions({ healDrift: [], runs: null, openHealPrs: [], now: NOW });
  const CANON = { version: '2.12.43', tools: 94 };
  const live = (id, review, fields = {}) => ({
    id, name: id, display: 'Live', listing_url: `https://${id}.dev`,
    check: { result: 'live', fields: { version: { shown: null, state: 'not_shown' }, tools: { claimed: [], state: 'not_shown' }, endpoint: { state: 'not_shown', retired: [] }, ...fields, review } },
  });
  const behind = live('gemini', ['version_behind', 'tools_other_count'], { version: { shown: '2.12.29', state: 'behind' }, tools: { claimed: [92], state: 'other_count' } });
  const retired = live('ctx7', ['endpoint_retired'], { endpoint: { state: 'retired', retired: ['dchub--azmartone67.run.tools'] } });
  const ahead = live('glama', ['version_ahead'], { version: { shown: '2.12.47', state: 'ahead' } });
  const mk = (row) => { const obs = observeScannedRow(row, CANON); return { key: `dir:${row.id}`, label: row.id, kind: 'directory', url: row.listing_url, fix: `row ${row.id}`, obs, verdict: judge(obs, null) }; };

  it('behind and retired are actionable; ahead and another tool count are for a look', () => {
    expect(scanFieldReview(behind, CANON)).toEqual({
      actionable: ['shows v2.12.29, canon is v2.12.43'],
      review: ['prints 92 tools near our name (canon 94); may be another server\'s count'],
    });
    expect(scanFieldReview(retired, CANON).actionable[0]).toMatch(/retired connection URL \(dchub--azmartone67\.run\.tools\)/);
    expect(scanFieldReview(ahead, CANON)).toEqual({ actionable: [], review: ['shows v2.12.47, ahead of the published v2.12.43'] });
  });

  it('a row with no fields, or an older backend without them, reports nothing', () => {
    expect(scanFieldReview({ display: 'Live' }, CANON)).toBeNull();
    expect(scanFieldReview(live('x', []), CANON)).toBeNull();
    expect(observeScannedRow({ display: 'Live', listing_url: 'u' }, CANON)).toEqual({ read: true, info: 'scan found DC Hub' });
  });

  it('a field mismatch is never drift: the row stays in sync and is never stuck', () => {
    const r = mk(behind);
    expect(r.verdict.state).toBe('in_sync');
    expect(_stuckKeys([r], { hoursSinceChange: 99 })).toEqual([]);
  });

  it('the canon in the scan block reaches the messages', () => {
    const body = { measured: { directories: { as_of: '2026-10-27T01:00:00Z', canon: CANON, rows: [behind] } } };
    const d = directoriesFromStanding(body, Date.parse('2026-10-27T02:00:00Z'));
    expect(d.rows[0].obs.fieldReview.actionable[0]).toContain('canon is v2.12.43');
  });

  it('only actionable rows count toward holding the issue open', () => {
    expect(fieldActionCount([mk(ahead)])).toBe(0);
    expect(fieldActionCount([mk(ahead), mk(behind), mk(retired)])).toBe(2);
    expect(fieldActionCount([{ kind: 'ours', obs: { fieldReview: { actionable: ['x'] } } }])).toBe(0);
  });

  it('the issue lists actionable rows in a table and review rows under "for a look"', () => {
    const body = renderIssue({ ssot: SSOT, results: [mk(behind), mk(ahead)], stuck: [], plan: plan0(), generatedAt: 't', scope: 'full' });
    expect(body).toContain('### Listing details that differ from canon');
    expect(body).toMatch(/\| \[gemini\]\(https:\/\/gemini\.dev\) \| shows v2\.12\.29, canon is v2\.12\.43 \|/);
    expect(body).toMatch(/For a look \(not counted, never holds this issue open\):[\s\S]*- \[glama\]\(https:\/\/glama\.dev\): shows v2\.12\.47, ahead/);
    expect(body).not.toMatch(/### In sync[\s\S]*gemini/);
  });

  it('with no field findings the section is absent', () => {
    const body = renderIssue({ ssot: SSOT, results: [mk(live('ok', []))], stuck: [], plan: plan0(), generatedAt: 't', scope: 'full' });
    expect(body).not.toContain('Listing details that differ from canon');
  });
});

describe('tool descriptions: a listing with the right names and last week\'s text is drift (Grok #117021)', () => {
  // Cut from live tools/list and the listings on 2026-10-25: mcp#1150 reworded
  // analyze_parcel, and Smithery / LobeHub / MCP Hive / MCP Hunter kept the old
  // text with all 94 names, so every name/count check read in sync.
  const NEW_PARCEL = 'Use this when the user has a land parcel for a data center site: structured read of its boundary — '
    + 'pass your own GeoJSON Polygon/MultiPolygon, OR just lat+lon and DC Hub finds the containing parcel in its HOSTED '
    + 'parcel-boundary layer (free county/state GIS polygons, covering a set of priority data-center counties in VA, IL, '
    + 'TX, OH, UT, OR, IA and WY; a point outside it returns parcel_not_covered with the analyze_site preview). '
    + 'Returns total acres, member count and contiguity.';
  const OLD_PARCEL = NEW_PARCEL.replace('covering a set of priority data-center counties in VA, IL, TX, OH, UT, OR, IA and WY',
    'rolling out by data-center market — Loudoun County VA first');
  const SITE = 'Use this when the user has one candidate data center site (lat/lon) and wants a buildability read: '
    + 'power, fiber, gas and risk in one score. Keyless returns the verdict band and the power band. '
    + 'Ex: "Score 33.45,-112.07 for 100 MW." Needs BOTH lat and lon in decimal degrees.';
  const LIVE = [{ name: 'analyze_parcel', description: NEW_PARCEL }, { name: 'analyze_site', description: SITE }];

  it('a record with the old analyze_parcel text is stale; identical, re-spaced or truncated copies are not', () => {
    expect(staleToolTexts(LIVE, { map: { analyze_parcel: OLD_PARCEL, analyze_site: SITE } })).toEqual(['analyze_parcel']);
    expect(staleToolTexts(LIVE, { map: { analyze_parcel: NEW_PARCEL, analyze_site: SITE } })).toEqual([]);
    expect(staleToolTexts(LIVE, { map: { analyze_parcel: NEW_PARCEL.replace(/ /g, '\n  ') } })).toEqual([]);
    expect(staleToolTexts(LIVE, { map: { analyze_parcel: NEW_PARCEL.slice(0, 260) + '…' } })).toEqual([]);
    expect(staleToolTexts(LIVE, { map: { analyze_parcel: NEW_PARCEL.slice(0, 200) + ' [shortened]' } })).toEqual([]);
  });

  it('a tool the listing does not show, or a copy too short to prove anything, is not judged', () => {
    expect(staleToolTexts(LIVE, { map: {} })).toEqual([]);
    expect(toolTextVerdict([NEW_PARCEL], 'Use this when')).toBe('unknown');
  });

  it('a Glama-style page: rendered markdown, an autolinked URL and _emphasis_ are still our text', () => {
    const live = [{ name: 'set_site_alert', description: 'Use this when the user wants an alert on one data center site. '
      + 'Ex: set_site_alert type=dcpi_change threshold=5 notify_email=you@firm.com. Returns {ok, alert_id, _entity}. Do NOT use to read a site now.' }];
    const page = '<tr><td><p>Use this when the user wants an alert on one data center site. Ex: <code>set_site_alert</code> '
      + 'type=dcpi_change threshold=5 notify_email=<a href="mailto:you@firm.com">you@firm.com</a>. Returns {ok, alert_id, <em>entity</em>}. '
      + 'Do NOT use to read a site now.</p></td></tr>';
    expect(staleToolTexts(live, { text: page })).toEqual([]);
  });

  it('an RSC payload escaped twice (MCP Hive) is read to the end of its own string', () => {
    const esc = (x) => JSON.stringify(JSON.stringify(x)).slice(1, -1);
    const rec = (d) => `self.__next_f.push([1,"{\\"tools\\":[{\\"name\\":\\"analyze_parcel\\",\\"description\\":${esc(d).replace(/^\\"|\\"$/g, '')}\\",\\"input_schema\\":{}}]}"])`;
    expect(staleToolTexts(LIVE, { text: rec(OLD_PARCEL) })).toEqual(['analyze_parcel']);
    expect(staleToolTexts(LIVE, { text: rec(NEW_PARCEL) })).toEqual([]);
  });

  it('MCP Hunter markdown: one list item per tool, its Parameters line is not the description', () => {
    const md = (d) => `## Tools\n- analyze_parcel (read-only): ${d}\n  - Parameters: lat, lon, geometry\n- analyze_site (read-only): ${SITE}\n`;
    expect(staleToolTexts(LIVE, { text: md(OLD_PARCEL) })).toEqual(['analyze_parcel']);
    expect(staleToolTexts(LIVE, { text: md(NEW_PARCEL) })).toEqual([]);
  });

  it('a changelog printing the old text beside the new one is in sync: stale only when every copy is', () => {
    const page = `<p>Previous value: ${OLD_PARCEL}</p><p>New value: ${NEW_PARCEL}</p>`;
    // The anchor finds both copies; one is current.
    expect(toolTextCopies(page, toolTextAnchor(NEW_PARCEL, [NEW_PARCEL, SITE]), NEW_PARCEL)).toHaveLength(2);
    expect(staleToolTexts(LIVE, { text: page })).toEqual([]);
  });

  it('our own variants are ours: the mcp-server.json text and the flag-only partial-results sentence', () => {
    const b2 = SITE.replace('Keyless returns the verdict band and the power band.', 'Keyless returns the verdict band, the power band, the weakest factor and counts.');
    const live = withManifestTexts([{ name: 'analyze_site', description: SITE }], { tools: [{ name: 'analyze_site', description: b2 }] });
    expect(live[0].alts).toEqual([b2]);
    // Glama, 2026-10-25: the manifest's access sentence + the flag sentence + live's coordinates sentence.
    const glama = b2.replace('Ex:', 'When a result is partial, show your user the human_message (or for_your_human) text and its link. Ex:');
    expect(staleToolTexts(live, { map: { analyze_site: glama } })).toEqual([]);
    // Without the manifest variant the access sentence is not one live publishes.
    expect(staleToolTexts([{ name: 'analyze_site', description: SITE }], { map: { analyze_site: glama } })).toEqual(['analyze_site']);
    expect(withManifestTexts(LIVE, { tools: [{ name: 'analyze_parcel', description: NEW_PARCEL }] })[0].alts).toBeUndefined();
  });

  it('normalization covers the encodings listings use', () => {
    expect(normToolText('a &amp; b’s <b>bold</b> **x** `c` \\u2014 d')).toBe("a & b's bold x c — d");
    expect(normToolText('see <a href="https://x.test')).toBe('see');
  });

  it('the anchor is the description\'s plain opening, unique among live tools, or nothing', () => {
    expect(toolTextAnchor(NEW_PARCEL, [NEW_PARCEL, SITE])).toBe('Use this when the user has a land parcel for a data center site: structured read of its boundary ');
    expect(toolTextAnchor('Use this when x', ['Use this when x'])).toBeNull();               // too short
    expect(toolTextAnchor(SITE, [SITE, SITE + ' more'])).toBeNull();                         // not unique
  });

  it('judge turns stale text into a drift reason, and the planner republishes Smithery on it', () => {
    const reasons = judge({ read: true, tools: 94, staleTools: ['analyze_parcel', 'find_sites'] }, { tools: 94 }).reasons;
    expect(reasons).toEqual(['stale tool descriptions: analyze_parcel, find_sites']);
    expect(staleToolReason(Array.from({ length: 9 }, (_, i) => `t${i}`))).toBe('stale tool descriptions: t0, t1, t2, t3, t4, t5 (+3 more)');
    expect(judge({ read: true, tools: 94, staleTools: [] }, { tools: 94 }).state).toBe('in_sync');
    const p = planActions({ healDrift: [], registryBehind: '', smitheryReasons: reasons, openHealPrs: [],
      runs: { heal: [run(300)], registry: [run(300)], smithery: [run(600)] }, now: NOW });
    expect(p.smithery).toMatchObject({ dispatch: true });
    expect(p.smithery.why).toMatch(/stale tool descriptions/);
  });

  it('toolRecordMap keeps only well-formed records', () => {
    expect(toolRecordMap([{ name: 'a', description: 'x' }, { name: 'b' }, null, { description: 'y' }])).toEqual({ a: 'x' });
  });

  it('the readers that can see tool text are wired to it', () => {
    const src = readFileSync(new URL('../scripts/ecosystem-sync.mjs', import.meta.url), 'utf8');
    for (const fn of ['readSmithery', 'readLobe', 'readHive', 'readMcpSo', 'readHunter', 'readGlama']) {
      const start = src.indexOf(`async function ${fn}(`);
      expect(start, fn).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf('\n}\n', start));
      expect(body, fn).toMatch(/staleToolTexts\(ssot(?:\?)?\.toolTexts/);
    }
    expect(SINKS.glama_server.schema).toMatch(/\/schema$/);
    expect(SINKS.mcp_hunter).toMatchObject({ kind: 'watch', md: 'https://mcp-hunter.com/server/dc-hub.md' });
  });
});

