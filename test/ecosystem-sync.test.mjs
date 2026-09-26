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
  COOLDOWN_MIN, FAILURE_BACKOFF_H, PULL_GRACE_H, SELF_TAG, WORKFLOWS, SINKS, FLOOR_TOLERANCE,
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

  it('flags two floors on one surface as a dual floor, even when one is right', () => {
    const v = judge({ read: true, floors: ['21,800+', '21,600+'] }, SSOT);
    expect(v.state).toBe('drift');
    expect(v.reasons.join(' ')).toMatch(/dual floor/);
    expect(v.reasons.join(' ')).toMatch(/21,600\+/);
  });

  it('passes a surface whose only floor is the canon one', () => {
    expect(judge({ read: true, floors: ['21,800+'] }, SSOT)).toEqual({ state: 'in_sync', reasons: [] });
  });

  it('judges no floor at all when canon was not live this cycle', () => {
    // A cold canon must never become the yardstick — that IS the second floor.
    const v = judge({ read: true, floors: ['21,500+'] }, { ...SSOT, facilities: null });
    expect(v.state).toBe('in_sync');
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
      'says 12,650+ facilities (canon 21,800+)',
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
    expect(line).toContain('21,800+ facilities');
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
      .toEqual(['says 88 tools (live 90)', 'says 21,200+ facilities (canon 21,800+)']);
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
    for (const key of ['pulsemcp', 'mcpservers_org', 'glama_server', 'glama_duplicate', 'mcp_so', 'mcp_so_secondary']) {
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
      .toEqual(['says 20,000+ facilities (canon 21,800+)', 'card says 15 tools (live 90)']);
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

describe('a true floor on a hosted listing is not drift (2026-09-25: 24,500+ vs canon 24,600+)', () => {
  const CANON = { ...SSOT, facilities: '24,600+' };
  const hosted = (floors) => judge({ read: true, floors }, CANON, { kind: 'manual' });

  it('passes a floor below canon but within tolerance, and says so in notes', () => {
    const v = hosted(['24,500+']);
    expect(v.state).toBe('in_sync');
    expect(v.reasons).toEqual([]);
    expect(v.notes.join(' ')).toMatch(/conservative floor 24,500\+, still true against canon 24,600\+/);
  });

  it('holds at the tolerance edge and fails one facility under it', () => {
    const edge = Math.ceil(24600 * FLOOR_TOLERANCE);
    expect(hosted([`${edge.toLocaleString('en-US')}+`]).state).toBe('in_sync');
    expect(hosted([`${(edge - 1).toLocaleString('en-US')}+`]).state).toBe('drift');
  });

  it('still flags a floor far below canon', () => {
    const v = hosted(['21,800+']);
    expect(v.state).toBe('drift');
    expect(v.reasons.join(' ')).toMatch(/says 21,800\+ facilities \(canon 24,600\+\)/);
  });

  it('still flags a floor ABOVE canon: that one is false', () => {
    expect(hosted(['24,700+']).state).toBe('drift');
  });

  it('still flags two floors on one listing, even when both are within tolerance', () => {
    const v = hosted(['24,500+', '24,600+']);
    expect(v.state).toBe('drift');
    expect(v.reasons.join(' ')).toMatch(/dual floor/);
  });

  it('keeps our own surfaces, the ones we publish to, and an unstated kind exact', () => {
    for (const opts of [{ kind: 'ours' }, { kind: 'push' }, {}]) {
      expect(judge({ read: true, floors: ['24,500+'] }, CANON, opts).state).toBe('drift');
    }
    expect(judge({ read: true, floors: ['24,500+'] }, CANON).state).toBe('drift');
  });

  it('applies to every hosted kind: pull, watch and manual', () => {
    for (const kind of ['pull', 'watch', 'manual']) {
      expect(judge({ read: true, floors: ['24,500+'] }, CANON, { kind }).state).toBe('in_sync');
    }
  });

  it('prints the conservative floor next to the label in the In sync list', () => {
    const results = [{ key: 'mcphive', kind: 'manual', label: 'MCP Hive', fix: 'f', verdict: hosted(['24,500+']) }];
    const body = renderIssue({ ssot: CANON, results, stuck: [], plan: planActions({ healDrift: [], runs: null, openHealPrs: [], now: NOW }), generatedAt: 't', scope: 'full' });
    expect(body).toMatch(/### In sync\nMCP Hive \(conservative floor 24,500\+, still true against canon 24,600\+\)/);
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
  const CLEAN_CARD = 'AI agents call 92 tools across 24,600+ facilities for land+power, grid and fiber. Pro $99/mo.';
  const head = (card) => `<head><meta content="${card}" name="description"/>`
    + `<meta property="og:description" content="${card}"/>`
    + '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@graph': [
      { '@type': 'Organization', name: 'Glama', description: 'Host org: 10,000+ data centers' },
      { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: { name: 'Other server', description: '5,000+ facilities' } }] },
      { '@type': 'SoftwareApplication', name: 'DC Hub', description: card },
    ] }) + '</script></head>';
  const body = '<body><p>DC Hub: 24,600+ facilities</p><div id="tools"><h2 class="x">Available Tools</h2><span>92<!-- --> tool<!-- -->s</span></div></body>';

  it('the body-only read cannot see the card (the defect)', () => {
    expect(facilityFloors(visibleText(head(STALE_CARD) + body))).toEqual(['24,600+']);
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
  it('the paste-line header states the $99 price without quoting a banned figure', () => {
    const results = [{ key: 'mcphive', kind: 'manual', label: 'MCP Hive', fix: 'f', verdict: { state: 'drift', reasons: ['says 88 tools (live 90)'] } }];
    const body = renderIssue({ ssot: SSOT, results, stuck: ['mcphive'], plan: planActions({ healDrift: [], runs: null, openHealPrs: [], now: NOW }), generatedAt: 't', scope: 'full' });
    const header = body.split('\n').find((l) => l.startsWith('Paste-ready line'));
    expect(header).toContain('Pro is $99/mo');
    expect(bannedClaims(header)).toEqual([]);
    expect(bannedClaims(body)).toEqual([]);
  });
});
