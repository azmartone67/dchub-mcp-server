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
  COOLDOWN_MIN, FAILURE_BACKOFF_H, PULL_GRACE_H, SELF_TAG, WORKFLOWS,
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
