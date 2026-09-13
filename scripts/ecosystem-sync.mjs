#!/usr/bin/env node
// =============================================================================
// ecosystem-sync — tell every listing what DC Hub can do, inside one cycle.
// -----------------------------------------------------------------------------
// WHY THIS EXISTS (2026-09-13). Measured from the outside the night it was
// written, against a live server answering 90 tools / 21,800+ facilities:
//
//   /.well-known/mcp.json ........ 90 · 21,800+    (zone worker, 1h self-sync)
//   official MCP registry ........ 2.12.12 · toolCount 90
//   Smithery ..................... 90 · 21,800+    (local LaunchAgent, daily)
//   Glama server listing ......... 88 · 21,600+ -> 90 at 00:36Z, ~27h after
//                                  the registry carried 90
//   LobeHub ...................... validates 2.12.9 · 88 tools · 20,900+
//   MCP Hive ..................... "88 tools" · "21,200+ verified facilities"
//   mcp.so (two listings) ........ 79 tools · 12,650+ · "$299/mo Pro"
//   /.well-known/agent-card.json . 21,500+ — a pinned floor frozen at import
//
// Nothing that republishes ran more often than daily. The last lane that ran
// often was the rank-defense reflex, ~20 Smithery publishes a day. #355 capped
// it because it fired whether or not anything had changed, and #383 retired
// the rank chase behind it. This lane restores the cadence without that
// failure: it LOOKS every 30 minutes and ACTS only on measured drift.
//
// ONE SOURCE, three inputs, and never a second copy of any of them:
//   /api/v1/canon/phrases   quantities. Accepted only when decide() says
//                           'heal', the SAME predicate refresh-canon-phrases.mjs
//                           gates the daily heal on. A cold or pinned body is a
//                           second floor, and publishing it is how two floors
//                           end up on one page.
//   /mcp tools/list         the tool count every client actually reads.
//   /api/v1/whats-new       the MCP pack cards the owner published.
//
// WHAT IT DOES
//   observe   every sink from the outside, identity before content
//   plan      which EXISTING lane to dispatch: daily-manifest-sync (repo
//             surfaces behind canon), registry-refresh (official registry
//             behind server.json), smithery-freshness (Smithery behind live).
//             It is not a third publisher. Cooldowns come from the Actions
//             API, and a run that cannot read that API dispatches nothing.
//   escalate  listings with no API — mcp.so, PulseMCP, LobeHub, MCP Hive, the
//             curated GitHub lists — into ONE issue for prospecting.
//
// THREE STATES, never two: in_sync / drift / unreadable. A 403, a timeout, or
// a page that does not carry our identity is UNREADABLE. It is never counted
// as drift and never as clean.
//
//   node scripts/ecosystem-sync.mjs --scope full --out ecosystem-sync
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decide, sourceMarker } from './refresh-canon-phrases.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = (process.env.DCHUB_ORIGIN || 'https://dchub.cloud').replace(/\/+$/, '');
const REPO = process.env.GITHUB_REPOSITORY || 'azmartone67/dchub-mcp-server';
const PR_AUTHOR = process.env.ECOSYSTEM_PR_AUTHOR || 'azmartone67';

// Our own probe. `dchub` and `probe` both satisfy server.mjs _INTERNAL_SELF_TAG,
// and the tag rides x-mcp-platform on EVERY request, not only on initialize: a
// clientInfo-only tag is lost on any replica that never saw the handshake, and
// the call is then published as external demand (r-ci-selftag, 2026-08-18).
export const SELF_TAG = 'dchub-ecosystem-sync-probe';
const SELF_UA = `${SELF_TAG}/1.0 (+https://github.com/${REPO})`;
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126 Safari/537.36';

export const ISSUE_TITLE = 'Ecosystem sync: listings behind what DC Hub serves';
export const WORKFLOWS = {
  heal: 'daily-manifest-sync.yml',
  registry: 'registry-refresh.yml',
  smithery: 'smithery-freshness.yml',
};
export const COOLDOWN_MIN = { heal: 45, registry: 45, smithery: 120 };
// A lane that just FAILED is not retried every cycle. Its log names the fix.
export const FAILURE_BACKOFF_H = { heal: 6, registry: 6, smithery: 24 };
// Pull listings re-crawl on their own clock. Glama took ~27h on 2026-09-12.
export const PULL_GRACE_H = Number(process.env.ECOSYSTEM_PULL_GRACE_HOURS || 36);
// A "N tools" claim is a stale TOTAL only near the live count. Pack sizes
// (2..18) and other servers' counts on an aggregator page are not claims about
// the whole catalogue, and flagging them would make this lane cry wolf daily.
export const STALE_TOTAL_BELOW = 30;
export const STALE_TOTAL_ABOVE = 10;
const CONFIRM_DELAY_MS = Number(process.env.ECOSYSTEM_CONFIRM_DELAY_MS || 40000);

// kind: push   — an API we drive; the dispatched lane fixes it
//       pull   — re-crawls us on its own clock; stuck only past PULL_GRACE_H
//       manual — nothing re-crawls it; a person has to edit it
//       ours   — a DC Hub surface; fixed in a repo or the worker, never by
//                prospecting
export const SINKS = {
  official: { label: 'Official MCP registry', kind: 'push', scope: 'core',
    fix: 'registry-refresh.yml publishes server.json; dispatched automatically when the registry is behind' },
  smithery: { label: 'Smithery', kind: 'push', scope: 'core',
    fix: 'smithery-freshness.yml republishes the live catalogue; dispatched automatically on drift. The description write needs a SMITHERY_API_KEY with servers:write' },
  mcp_json: { label: '/.well-known/mcp.json', kind: 'ours', scope: 'core', path: '/.well-known/mcp.json',
    fix: 'tools[] self-syncs from live tools/list within 1h; the top-level card is the Cloudflare zone worker (owner paste)' },
  server_card: { label: 'MCP server card', kind: 'ours', scope: 'core', path: '/.well-known/mcp/server-card.json',
    fix: 'dchub-backend ai_discovery_routes (canon_text)' },
  llms_txt: { label: '/llms.txt', kind: 'ours', scope: 'core', path: '/llms.txt',
    fix: 'dchub-frontend canon heal' },
  agents_md: { label: '/AGENTS.md', kind: 'ours', scope: 'core', path: '/AGENTS.md',
    fix: 'dchub-backend routes/agents_md_fallback.py' },
  agent_card: { label: '/.well-known/agent-card.json', kind: 'ours', scope: 'core', path: '/.well-known/agent-card.json',
    fix: 'dchub-backend routes/agent_a2a.py' },
  openapi: { label: '/openapi.json', kind: 'ours', scope: 'core', path: '/openapi.json',
    fix: 'dchub-backend ai_discovery_routes (canon_text)' },
  connect: { label: '/connect', kind: 'ours', scope: 'core', path: '/connect',
    fix: 'dchub-backend connect template (canon placeholders)' },
  integrations: { label: '/integrations', kind: 'ours', scope: 'core', path: '/integrations',
    fix: 'dchub-backend integrations landing' },
  mcp_standing: { label: '/mcp-standing', kind: 'ours', scope: 'core', path: '/mcp-standing',
    fix: 'dchub-backend routes/mcp_standing.py' },
  readme: { label: 'GitHub README (main)', kind: 'ours', scope: 'core',
    fix: 'daily-manifest-sync heals README.md; dispatched automatically when canon moves' },
  gh_description: { label: 'GitHub repo description', kind: 'ours', scope: 'core',
    fix: 'daily-manifest-sync pushes canonical/github_description.txt' },
  glama_connector: { label: 'Glama connector', kind: 'pull', scope: 'full',
    url: 'https://glama.ai/mcp/connectors/cloud.dchub/mcp-server',
    fix: 'mirrors the official registry and re-tests the live server on Glama\'s own clock' },
  glama_server: { label: 'Glama server listing', kind: 'pull', scope: 'full',
    url: 'https://glama.ai/mcp/servers/azmartone67/dchub-mcp-server',
    fix: 'owner, in Glama admin: Repository tab, Sync Server, THEN Deploy. A deploy alone rebuilds the old commit' },
  pulsemcp: { label: 'PulseMCP', kind: 'manual', scope: 'full',
    url: 'https://www.pulsemcp.com/servers/dchub',
    fix: 'the blurb is written by PulseMCP. Ask them to refresh it (pulsemcp.com server submit form or hello@pulsemcp.com)' },
  lobehub: { label: 'LobeHub', kind: 'manual', scope: 'full',
    url: 'https://market.lobehub.com/api/v1/plugins/azmartone67-dchub-mcp-server',
    page: 'https://market.lobehub.com/s/plugins/azmartone67-dchub-mcp-server',
    fix: 'claimed listing that still validates an old version. Owner republishes it on LobeHub Market' },
  mcphive: { label: 'MCP Hive', kind: 'manual', scope: 'full',
    url: 'https://mcp-hive.com/explore?provider=0f32e358-d410-4e19-9e77-e6dd91150386',
    fix: 'provider-authored description. Edit it in the mcp-hive.com provider dashboard' },
  mcp_so: { label: 'mcp.so', kind: 'manual', scope: 'full',
    url: 'https://mcp.so/servers/dchub-mcp-server',
    fix: 'login-gated edit on mcp.so, whose edit form is broken. Needs a person' },
  mcp_so_secondary: { label: 'mcp.so (second listing)', kind: 'manual', scope: 'full',
    url: 'https://mcp.so/servers/dchub-backend',
    fix: 'same form. Ask mcp.so to merge it into the primary listing rather than keep two' },
};

const IDENTITY_RE = /dc ?hub|dchub/i;

// ── pure helpers (exported for test/ecosystem-sync.test.mjs) ───────────────

const ENTITY = { '&amp;': '&', '&#x27;': "'", '&#39;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };

/** What a reader sees: no scripts, no styles, no tags, entities decoded. */
export function visibleText(html) {
  return String(html || '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|#x27|#39|quot|lt|gt|nbsp);/g, (m) => ENTITY[m])
    .replace(/\s+/g, ' ')
    .trim();
}

/** Glama prints each release's PREVIOUS tool text beside the new one
 *  ("Previous value: ...88 tools... New value: ...90 tools..."). The old half is
 *  history, not a claim the listing makes today. */
export function stripChangelogDiffs(text) {
  return String(text || '').replace(/Previous value:[\s\S]*?New value:/g, ' ');
}

const FLOOR_RE = /\b(\d{1,3}(?:,\d{3})+|\d{1,3}(?:\.\d)?\s?[kK])\+\s+(?:(?:distinct|discovered|verified|tracked|mapped|global)\s+)?(?:data[- ]cent(?:er|re)\s+)?(?:facilit(?:y|ies)|data[- ]cent(?:er|re)s)\b/g;

/** "21,800+" -> 21800 · "20K+" -> 20000 · anything else -> null */
export function parseFloor(phrase) {
  const s = String(phrase ?? '').trim().replace(/\+$/, '');
  const k = s.match(/^(\d{1,3}(?:\.\d)?)\s?[kK]$/);
  if (k) return Math.round(Number(k[1]) * 1000);
  if (/^\d{1,3}(?:,\d{3})+$/.test(s) || /^\d+$/.test(s)) return Number(s.replace(/,/g, ''));
  return null;
}

/** Every facility floor a text states, as written ("21,800+", "20K+"). */
export function facilityFloors(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(FLOOR_RE)) out.add(`${m[1].replace(/\s/g, '')}+`);
  return [...out];
}

const TOOL_CLAIM_RE = /\b(\d{2,3})\s+(?:live\s+)?(?:read-only\s+)?(?:MCP\s+)?tools\b/gi;

/** Every "N tools" a text states, as numbers. */
export function toolClaims(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(TOOL_CLAIM_RE)) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
}

/** A stale whole-catalogue count: near the live one but not it. */
export function isStaleTotal(n, live) {
  return Number.isInteger(n) && Number.isInteger(live) && n !== live
    && n >= live - STALE_TOTAL_BELOW && n <= live + STALE_TOTAL_ABOVE;
}

const BANNED_RE = /\$\s?(?:299|199)(?:\.00)?(?![\d,])|\bFounding\b/g;

/** Pricing copy that must not appear anywhere: Pro is $99 only, no Founding. */
export function bannedClaims(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(BANNED_RE)) out.add(m[0].replace(/\s/g, ''));
  return [...out];
}

export function semverCmp(a, b) {
  const p = (v) => String(v || '').split(/[.+-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0);
  const A = p(a);
  const B = p(b);
  for (let i = 0; i < 3; i += 1) if (A[i] !== B[i]) return A[i] < B[i] ? -1 : 1;
  return 0;
}

/** Our isLatest entry, plus any OTHER name in our namespace that is still
 *  isLatest. The search returns every historical version, and the first N rows
 *  are the OLDEST — never slice them (2026-07-27 retraction). */
export function pickOfficial(body, name) {
  const OFFICIAL = 'io.modelcontextprotocol.registry/official';
  const PUB = 'io.modelcontextprotocol.registry/publisher-provided';
  const ns = String(name || '').split('/')[0];
  const latest = (Array.isArray(body?.servers) ? body.servers : [])
    .filter((s) => s?._meta?.[OFFICIAL]?.isLatest === true && typeof s?.server?.name === 'string');
  const ours = latest.find((s) => s.server.name === name) || null;
  const others = latest
    .filter((s) => s.server.name !== name && s.server.name.startsWith(`${ns}/`))
    .map((s) => ({ name: s.server.name, version: s.server.version, status: s._meta[OFFICIAL].status || null }));
  if (!ours) return { found: false, others };
  const meta = ours._meta[OFFICIAL];
  const pp = ours.server._meta?.[PUB] || {};
  return {
    found: true,
    version: ours.server.version || null,
    status: meta.status || null,
    publishedAt: meta.publishedAt || null,
    toolCount: Number.isInteger(pp.toolCount) ? pp.toolCount : null,
    description: String(ours.server.description || ''),
    others,
  };
}

/** The "Available Tools" badge Glama renders from its own introspection. Its
 *  React markup splits the text ("90<!-- --> tool<!-- -->s"), and the page also
 *  carries an AI review ("With 82 tools...") and changelog diffs, so a loose
 *  "N tools" scan reads three different numbers off a page whose answer is one. */
export function glamaBadge(html) {
  const s = String(html || '');
  const i = s.indexOf('Available Tools</h2>');
  if (i < 0) return null;
  const m = s.slice(i, i + 800).match(/>\s*(\d{1,3})(?:<!-- -->)?\s*tool(?:<!-- -->)?s?\s*</);
  return m ? Number(m[1]) : null;
}

/** Newest Glama release on the page. INFORMATIONAL ONLY: Glama numbers its
 *  releases on its own counter, so it is never compared to server.json. */
export function glamaLatestRelease(html) {
  const rel = [...String(html || '').matchAll(/v(?:<!-- -->)?(\d+\.\d+\.\d+)<\/code><\/span><time[^>]*dateTime="([^"]+)"/g)]
    .map((m) => ({ version: m[1], at: m[2] }));
  rel.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return rel[0] || null;
}

/** MCP Hive's provider page lists servers as schema.org ItemList JSON-LD. Our
 *  record is the item that names us; other providers' counts are not ours. */
export function hiveItem(html) {
  for (const m of String(html || '').matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let doc;
    try { doc = JSON.parse(m[1]); } catch { continue; }
    const items = Array.isArray(doc?.itemListElement) ? doc.itemListElement : [];
    for (const it of items) {
      const x = it?.item || it;
      const txt = `${x?.name || ''} ${x?.description || ''}`;
      if (IDENTITY_RE.test(txt)) return { name: String(x?.name || ''), description: String(x?.description || '') };
    }
  }
  return null;
}

/** Pack names from the What's New MCP pack cards ("/mcp/grid" -> "grid"). */
export function packCodes(body) {
  const cards = Array.isArray(body?.platform) ? body.platform : [];
  return [...new Set(cards
    .filter((c) => /mcp pack/i.test(String(c?.tag || '')) && /^\/mcp\/[a-z0-9-]+$/.test(String(c?.code || '')))
    .map((c) => c.code.slice('/mcp/'.length)))].sort();
}

/** The canon body, only if the daily heal would accept it. */
export function usableCanon(body) {
  const verdict = decide(body);
  if (verdict !== 'heal') return { canon: null, verdict, marker: sourceMarker(body?.source) };
  const tools = Number(body.tools);
  if (!Number.isInteger(tools) || parseFloor(body.facilities) == null) {
    return { canon: null, verdict: 'keep', marker: sourceMarker(body?.source) };
  }
  return {
    canon: {
      tools, facilities: body.facilities, deals: body.deals, markets: body.markets,
      countries: body.countries, substations: body.substations, source: body.source,
    },
    verdict,
    marker: 'live',
  };
}

export const SNAPSHOT_FIELDS = ['tools', 'facilities', 'deals', 'markets', 'countries', 'substations'];

/** What a heal would change: the committed snapshot and server.json vs live. */
export function repoDrift({ snapshot, canon, serverJson, liveTools }) {
  const out = [];
  if (canon) {
    for (const k of SNAPSHOT_FIELDS) {
      if (canon[k] != null && snapshot?.[k] != null && String(snapshot[k]) !== String(canon[k])) {
        out.push(`canon_phrases.json ${k} ${snapshot[k]} -> ${canon[k]}`);
      }
    }
  }
  const tc = serverJson?._meta?.['io.modelcontextprotocol.registry/publisher-provided']?.toolCount;
  if (Number.isInteger(liveTools) && Number.isInteger(tc) && tc !== liveTools) {
    out.push(`server.json toolCount ${tc} -> ${liveTools}`);
  }
  return out;
}

/** in_sync / drift / unreadable for one observation against the single source. */
export function judge(obs, ssot) {
  if (!obs || obs.read !== true) return { state: 'unreadable', reasons: [obs?.error || 'not read'] };
  const reasons = [];
  const liveTools = Number.isInteger(ssot?.tools) ? ssot.tools : null;
  if (liveTools != null) {
    if (Number.isInteger(obs.tools) && obs.tools !== liveTools) {
      reasons.push(`serves ${obs.tools} tools (live ${liveTools})`);
    }
    const stale = (obs.toolClaims || []).filter((n) => isStaleTotal(n, liveTools));
    if (stale.length) reasons.push(`says ${stale.join('/')} tools (live ${liveTools})`);
  }
  const canonFloor = ssot?.facilities ? parseFloor(ssot.facilities) : null;
  if (canonFloor != null) {
    const floors = [...new Set(obs.floors || [])];
    const off = floors.filter((f) => parseFloor(f) !== canonFloor);
    if (off.length) reasons.push(`says ${off.join(' / ')} facilities (canon ${ssot.facilities})`);
    if (new Set(floors.map(parseFloor)).size > 1) reasons.push(`dual floor on one surface: ${floors.join(' + ')}`);
  }
  if (obs.version && ssot?.version && semverCmp(obs.version, ssot.version) < 0) {
    reasons.push(`version ${obs.version} (server.json ${ssot.version})`);
  }
  if (obs.banned?.length) reasons.push(`banned pricing copy: ${obs.banned.join(', ')}`);
  for (const r of obs.extra || []) reasons.push(r);
  return { state: reasons.length ? 'drift' : 'in_sync', reasons };
}

const ageMin = (run, now) => (run?.created_at ? (now - Date.parse(run.created_at)) / 60000 : Infinity);

/** One lane's gate: may we dispatch it right now? Never blind, never twice. */
export function gate(lane, runs, now) {
  if (runs == null) return { ok: false, why: 'cannot read Actions runs, so nothing is dispatched blind' };
  const list = Array.isArray(runs[lane]) ? runs[lane] : [];
  const active = list.find((r) => r.status && r.status !== 'completed');
  if (active) return { ok: false, why: `a ${WORKFLOWS[lane]} run is already ${active.status}` };
  const last = list[0];
  const mins = ageMin(last, now);
  if (last?.conclusion === 'failure' && mins < FAILURE_BACKOFF_H[lane] * 60) {
    return { ok: false, failing: true, why: `last ${WORKFLOWS[lane]} run FAILED ${Math.round(mins)} min ago; its log names the fix (${last.html_url || 'see Actions'})` };
  }
  if (mins < COOLDOWN_MIN[lane]) {
    return { ok: false, why: `${WORKFLOWS[lane]} ran ${Math.round(mins)} min ago (cooldown ${COOLDOWN_MIN[lane]} min)` };
  }
  return { ok: true, why: '' };
}

/** Which existing lanes to dispatch this cycle, and why each one is held. */
export function planActions({ healDrift, registryBehind, smitheryReasons, runs, openHealPrs, now = Date.now() }) {
  const plan = {};
  if (!healDrift?.length) {
    plan.heal = { dispatch: false, why: 'repo snapshot and server.json match the live source' };
  } else if (openHealPrs == null) {
    plan.heal = { dispatch: false, why: 'cannot read open PRs, so no heal is dispatched blind' };
  } else if (openHealPrs.length) {
    plan.heal = { dispatch: false, why: `heal PR #${openHealPrs[0].number} is already open, waiting for it to merge` };
  } else {
    const g = gate('heal', runs, now);
    plan.heal = { dispatch: g.ok, why: g.ok ? healDrift.join('; ') : g.why, failing: !!g.failing };
  }
  if (!registryBehind) {
    plan.registry = { dispatch: false, why: 'official registry is not behind server.json' };
  } else {
    const g = gate('registry', runs, now);
    plan.registry = { dispatch: g.ok, why: g.ok ? registryBehind : g.why, failing: !!g.failing };
  }
  if (!smitheryReasons?.length) {
    plan.smithery = { dispatch: false, why: 'Smithery serves the live catalogue' };
  } else {
    const g = gate('smithery', runs, now);
    plan.smithery = { dispatch: g.ok, why: g.ok ? smitheryReasons.join('; ') : g.why, failing: !!g.failing };
  }
  return plan;
}

/** Listings that need a person: manual ones on any drift, pull ones only once
 *  the re-crawl window has passed. An unknown change time pages: unknown must
 *  not buy silence. */
export function stuckKeys(results, { hoursSinceChange }) {
  return results
    .filter((r) => r.verdict.state === 'drift')
    .filter((r) => r.kind === 'manual'
      || (r.kind === 'pull' && (hoursSinceChange == null || hoursSinceChange >= PULL_GRACE_H)))
    .map((r) => r.key)
    .sort();
}

export function stuckMarker(body) {
  const m = String(body || '').match(/<!-- ecosystem-sync:stuck=([^>]*?) -->/);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean).sort() : null;
}

/** Keys that were not stuck last time. A previous body we could not read
 *  yields nothing, so a blind run never spams a comment. */
export function newlyStuck(previous, current) {
  if (previous == null) return [];
  return current.filter((k) => !previous.includes(k));
}

export function resolveScope(scope, now = new Date()) {
  if (scope === 'core' || scope === 'full') return scope;
  return now.getUTCHours() % 2 === 0 && now.getUTCMinutes() < 30 ? 'full' : 'core';
}

// ── network ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const bust = (u) => `${u}${u.includes('?') ? '&' : '?'}_=${Date.now()}`;

// Some listing hosts sit behind a bot wall that refuses Node's TLS client and
// answers the same request from Python's urllib. Measured 2026-09-13 on
// PulseMCP: fetch 403, curl 403, urllib 200 with the page intact. The retry is
// a second READ of the same URL, never a different claim, and a 403 there too
// stays UNREADABLE.
const PY_FETCH = [
  'import sys, json, urllib.request',
  'req = urllib.request.Request(sys.argv[1], headers={"User-Agent": sys.argv[2], "Accept": "text/html,application/json"})',
  'try:',
  '    r = urllib.request.urlopen(req, timeout=30)',
  '    print(json.dumps({"status": r.status, "text": r.read().decode("utf-8", "replace")}))',
  'except urllib.error.HTTPError as e:',
  '    print(json.dumps({"status": e.code, "text": ""}))',
].join('\n');

function pyFetch(url, ua) {
  return new Promise((resolve) => {
    execFile('python3', ['-c', PY_FETCH, url, ua], { timeout: 45000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, status: 0, text: '', error: `python read failed: ${String(err.message || err).slice(0, 120)}` });
        return;
      }
      try {
        const j = JSON.parse(stdout);
        resolve({ ok: j.status >= 200 && j.status < 300, status: j.status, text: j.text || '' });
      } catch {
        resolve({ ok: false, status: 0, text: '', error: 'python read returned no JSON' });
      }
    });
  });
}

async function fetchText(url, { ua = BROWSER_UA, accept = 'text/html,application/json;q=0.9,*/*;q=0.8', timeoutMs = 30000, headers = {} } = {}) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': ua, Accept: accept, ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const res = { ok: r.ok, status: r.status, text: await r.text() };
    if (res.status === 403 && !new URL(url).hostname.endsWith('dchub.cloud')) {
      const py = await pyFetch(url, ua);
      if (py.ok) return py;
    }
    return res;
  } catch (e) {
    return { ok: false, status: 0, text: '', error: String(e?.message || e) };
  }
}

function lastJsonFrame(text) {
  const t = String(text || '').trim();
  if (t.startsWith('{')) { try { return JSON.parse(t); } catch { return null; } }
  let last = null;
  for (let ln of t.split('\n')) {
    ln = ln.trim();
    if (ln.startsWith('data:')) ln = ln.slice(5).trim();
    if (ln.startsWith('{')) { try { last = JSON.parse(ln); } catch { /* not a frame */ } }
  }
  return last;
}

async function mcpToolList(url) {
  const hdrs = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'user-agent': SELF_UA,
    'x-mcp-platform': SELF_TAG,
  };
  try {
    const init = await fetch(url, {
      method: 'POST', headers: hdrs, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: SELF_TAG, version: '1' } } }),
    });
    const initBody = lastJsonFrame(await init.text());
    const sid = init.headers.get('mcp-session-id');
    const h2 = sid ? { ...hdrs, 'mcp-session-id': sid } : hdrs;
    await fetch(url, { method: 'POST', headers: h2, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
      .then((r) => r.text()).catch(() => {});
    const tl = await fetch(url, { method: 'POST', headers: h2, signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
    const body = lastJsonFrame(await tl.text());
    const tools = body?.result?.tools;
    if (!Array.isArray(tools)) return { read: false, error: `tools/list returned no tools (HTTP ${tl.status})` };
    return {
      read: true,
      count: tools.length,
      names: tools.map((t) => t.name).sort(),
      blob: JSON.stringify(tools),
      serverVersion: initBody?.result?.serverInfo?.version || null,
    };
  } catch (e) {
    return { read: false, error: String(e?.message || e) };
  }
}

async function gh(pathname) {
  const token = (process.env.GITHUB_TOKEN || '').trim();
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': SELF_UA, 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const r = await fetch(`https://api.github.com${pathname}`, { headers, signal: AbortSignal.timeout(20000) });
    const json = r.ok ? await r.json() : null;
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: null, error: String(e?.message || e) };
  }
}

// ── readers: each returns an observation for judge() ───────────────────────

async function readCanon() {
  let lastBody = null;
  let lastErr = '';
  for (let i = 0; i < 4; i += 1) {
    const r = await fetchText(bust(`${ORIGIN}/api/v1/canon/phrases`), { ua: SELF_UA, accept: 'application/json' });
    if (r.ok) {
      try {
        lastBody = JSON.parse(r.text);
        const u = usableCanon(lastBody);
        if (u.canon) return { read: true, canon: u.canon, attempts: i + 1 };
        if (u.verdict === 'fail') {
          return { read: false, error: `canon source marker "(${u.marker})" is not one refresh-canon-phrases.mjs knows. Teach KNOWN_MARKERS before trusting it` };
        }
      } catch (e) {
        lastErr = `not JSON (${String(e?.message || e)})`;
      }
    } else {
      lastErr = `HTTP ${r.status}${r.error ? ` ${r.error}` : ''}`;
    }
    if (i < 3) await sleep(5000);
  }
  return {
    read: false,
    error: lastBody ? `canon never answered live in 4 reads (last source "${lastBody.source}")` : `canon unreachable: ${lastErr}`,
  };
}

async function readOurPage(key) {
  const s = SINKS[key];
  const r = await fetchText(bust(`${ORIGIN}${s.path}`), { ua: SELF_UA });
  if (!r.ok) return { read: false, error: `HTTP ${r.status}${r.error ? ` ${r.error}` : ''}` };
  const text = s.path.endsWith('.json') ? r.text : visibleText(r.text);
  if (!IDENTITY_RE.test(text)) return { read: false, error: 'no DC Hub identity on the page' };
  return { read: true, floors: facilityFloors(text), toolClaims: toolClaims(text), banned: bannedClaims(text) };
}

async function readMcpJson() {
  const r = await fetchText(bust(`${ORIGIN}/.well-known/mcp.json`), { ua: SELF_UA, accept: 'application/json' });
  if (!r.ok) return { read: false, error: `HTTP ${r.status}${r.error ? ` ${r.error}` : ''}` };
  let j;
  try { j = JSON.parse(r.text); } catch { return { read: false, error: 'not JSON' }; }
  const n = Array.isArray(j.tools) ? j.tools.length : null;
  const extra = [];
  if (Number.isInteger(j.tools_count) && n != null && n !== j.tools_count) extra.push(`tools_count ${j.tools_count} but tools[] lists ${n}`);
  return {
    read: true,
    tools: Number.isInteger(j.tools_count) ? j.tools_count : n,
    version: j.version || null,
    floors: facilityFloors(r.text),
    toolClaims: toolClaims(r.text),
    banned: bannedClaims(r.text),
    extra,
  };
}

async function readReadme() {
  const r = await fetchText(bust(`https://raw.githubusercontent.com/${REPO}/main/README.md`), { ua: SELF_UA, accept: 'text/plain' });
  if (!r.ok) return { read: false, error: `HTTP ${r.status}` };
  return { read: true, floors: facilityFloors(r.text), toolClaims: toolClaims(r.text), banned: bannedClaims(r.text) };
}

async function readGhDescription() {
  const r = await gh(`/repos/${REPO}`);
  if (!r.ok) return { read: false, error: `GitHub API HTTP ${r.status}` };
  const d = String(r.json?.description || '');
  return { read: true, floors: facilityFloors(d), toolClaims: toolClaims(d), banned: bannedClaims(d) };
}

async function readOfficial(ssot) {
  const ns = String(ssot.serverName || '').split('/')[0];
  const r = await fetchText(
    `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(ns)}&version=latest&limit=100`,
    { ua: SELF_UA, accept: 'application/json' },
  );
  if (!r.ok) return { read: false, error: `HTTP ${r.status}${r.error ? ` ${r.error}` : ''}` };
  let body;
  try { body = JSON.parse(r.text); } catch { return { read: false, error: 'not JSON' }; }
  const o = pickOfficial(body, ssot.serverName);
  if (!o.found) return { read: false, error: `${ssot.serverName} has no isLatest entry in the search response` };
  const extra = [];
  if (o.status && o.status !== 'active') extra.push(`status ${o.status}`);
  for (const other of o.others) {
    if (other.status === 'active') extra.push(`second ACTIVE name ${other.name}@${other.version}: two canonical entries`);
  }
  return {
    read: true, tools: o.toolCount, version: o.version, publishedAt: o.publishedAt,
    floors: facilityFloors(o.description), banned: bannedClaims(o.description), extra,
    info: o.others.length ? `other names: ${o.others.map((x) => `${x.name}@${x.version} (${x.status})`).join(', ')}` : '',
  };
}

async function readSmithery(ssot) {
  const r = await fetchText(bust('https://registry.smithery.ai/servers/azmartone67/dchub'), { accept: 'application/json' });
  if (!r.ok) return { read: false, error: `HTTP ${r.status}${r.error ? ` ${r.error}` : ''}` };
  let j;
  try { j = JSON.parse(r.text); } catch { return { read: false, error: 'not JSON' }; }
  if (!Array.isArray(j.tools)) return { read: false, error: 'registry record has no tools array' };
  const desc = String(j.description || '');
  const blob = `${JSON.stringify(j.tools)}\n${desc}`;
  const extra = [];
  if (Array.isArray(ssot.toolNames)) {
    const got = new Set(j.tools.map((t) => t?.name));
    const missing = ssot.toolNames.filter((n) => !got.has(n));
    const retired = [...got].filter((n) => !ssot.toolNames.includes(n));
    if (missing.length) extra.push(`missing live tool(s): ${missing.slice(0, 6).join(', ')}`);
    if (retired.length) extra.push(`still lists tool(s) live no longer serves: ${retired.slice(0, 6).join(', ')}`);
  }
  return {
    read: true, tools: j.tools.length, floors: facilityFloors(blob),
    toolClaims: toolClaims(desc), banned: bannedClaims(blob), extra,
  };
}

async function readGlama(key) {
  const r = await fetchText(bust(SINKS[key].url));
  if (!r.ok) return { read: false, error: `HTTP ${r.status}${r.error ? ` ${r.error}` : ''}` };
  if (!/dchub/i.test(r.text)) return { read: false, error: 'no DC Hub identity on the page' };
  const badge = glamaBadge(r.text);
  const text = stripChangelogDiffs(visibleText(r.text));
  const rel = glamaLatestRelease(r.text);
  return {
    read: true, tools: badge, floors: facilityFloors(text), banned: bannedClaims(text),
    extra: badge == null ? ['no "Available Tools" badge: Glama has not introspected a build'] : [],
    info: rel ? `newest Glama release ${rel.version} at ${rel.at} (Glama's own counter)` : '',
  };
}

async function readPulse() {
  const r = await fetchText(bust(SINKS.pulsemcp.url));
  if (!r.ok) return { read: false, error: `HTTP ${r.status}${r.error ? ` ${r.error}` : ''}` };
  const text = visibleText(r.text);
  if (!/cloud\.dchub\/mcp-server|DC Hub/.test(text)) return { read: false, error: 'no DC Hub identity (bot wall?)' };
  return { read: true, floors: facilityFloors(text), toolClaims: toolClaims(text), banned: bannedClaims(text) };
}

async function readLobe() {
  const r = await fetchText(bust(SINKS.lobehub.url), { accept: 'application/json' });
  if (!r.ok) return { read: false, error: `HTTP ${r.status}${r.error ? ` ${r.error}` : ''}` };
  let j;
  try { j = JSON.parse(r.text); } catch { return { read: false, error: 'not JSON' }; }
  if (!IDENTITY_RE.test(String(j.identifier || j.name || ''))) return { read: false, error: 'record is not ours' };
  const prose = `${j.description || ''}\n${j.overview || ''}`;
  return {
    read: true,
    tools: Number.isInteger(j.toolsCount) ? j.toolsCount : null,
    version: j.version || null,
    floors: facilityFloors(`${prose}\n${JSON.stringify(j.tools || [])}`),
    toolClaims: toolClaims(prose),
    banned: bannedClaims(prose),
  };
}

async function readHive() {
  const r = await fetchText(bust(SINKS.mcphive.url));
  if (!r.ok) return { read: false, error: `HTTP ${r.status}${r.error ? ` ${r.error}` : ''}` };
  const item = hiveItem(r.text);
  if (!item) return { read: false, error: 'DC Hub is not in the provider page item list' };
  return {
    read: true, floors: facilityFloors(item.description), toolClaims: toolClaims(item.description),
    banned: bannedClaims(item.description),
  };
}

async function readMcpSo(key) {
  const r = await fetchText(bust(SINKS[key].url));
  if (!r.ok) return { read: false, error: `HTTP ${r.status}${r.error ? ` ${r.error}` : ''}` };
  const text = visibleText(r.text);
  if (!IDENTITY_RE.test(text)) return { read: false, error: 'no DC Hub identity on the page' };
  return { read: true, floors: facilityFloors(text), toolClaims: toolClaims(text), banned: bannedClaims(text) };
}

/** Our open listing PRs on other people's curated lists. Prospecting babysits
 *  them; this only says which ones now carry stale numbers in their diff. */
async function readListingPrs() {
  const q = encodeURIComponent(`is:pr is:open author:${PR_AUTHOR} -user:${PR_AUTHOR}`);
  const s = await gh(`/search/issues?q=${q}&per_page=50`);
  if (!s.ok) return { read: false, error: `GitHub search HTTP ${s.status}` };
  const prs = [];
  for (const it of s.json?.items || []) {
    const repo = String(it.repository_url || '').split('/repos/')[1];
    if (!repo) continue;
    const f = await gh(`/repos/${repo}/pulls/${it.number}/files?per_page=30`);
    const added = f.ok
      ? (f.json || []).map((x) => String(x.patch || '').split('\n')
        .filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n')).join('\n')
      : '';
    const text = `${it.title}\n${added}`;
    // ★ No "owner/repo#N" anywhere this lands. GitHub turns that spelling, in
    // an issue body or comment, into a cross-reference on the OTHER repo's PR,
    // so every refresh would post "mentioned this" on a maintainer's queue.
    prs.push({
      key: `pr:${repo}/${it.number}`, label: `${repo} PR ${it.number}`, url: it.html_url,
      obs: f.ok
        ? { read: true, floors: facilityFloors(text), toolClaims: toolClaims(text), banned: bannedClaims(text) }
        : { read: false, error: `files HTTP ${f.status}` },
    });
  }
  return { read: true, prs };
}

async function readRunContext() {
  const runs = {};
  for (const [lane, file] of Object.entries(WORKFLOWS)) {
    const r = await gh(`/repos/${REPO}/actions/workflows/${file}/runs?per_page=5`);
    if (!r.ok) return { runs: null, openHealPrs: null, error: `${file}: HTTP ${r.status}` };
    runs[lane] = (r.json?.workflow_runs || []).map((w) => ({
      created_at: w.created_at, status: w.status, conclusion: w.conclusion, event: w.event, html_url: w.html_url,
    }));
  }
  const p = await gh(`/repos/${REPO}/pulls?state=open&per_page=100`);
  const openHealPrs = p.ok
    ? (p.json || []).filter((x) => String(x?.head?.ref || '').startsWith('bot/canon-sync-'))
      .map((x) => ({ number: x.number, created_at: x.created_at, url: x.html_url }))
    : null;
  return { runs, openHealPrs };
}

async function readIssue() {
  const r = await gh(`/repos/${REPO}/issues?state=open&per_page=100`);
  if (!r.ok) return null;
  const it = (r.json || []).find((i) => i.title === ISSUE_TITLE && !i.pull_request);
  return it ? { number: it.number, body: it.body || '' } : { number: null, body: null };
}

// ── rendering ──────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function pasteLine(ssot) {
  const parts = [
    `${ssot.tools} MCP tools`,
    ssot.facilities ? `${ssot.facilities} facilities` : null,
    ssot.markets ? `${ssot.markets} markets` : null,
    ssot.deals ? `${ssot.deals} tracked deals` : null,
  ].filter(Boolean);
  return `DC Hub: live data-center, power-grid, fiber and gas infrastructure data for AI agents. ${parts.join(', ')}. Remote MCP: https://dchub.cloud/mcp`;
}

export function renderIssue({ ssot, results, stuck, plan, generatedAt, scope }) {
  const byKey = new Map(results.map((r) => [r.key, r]));
  // A GitHub PR URL is rendered as code, never as a link, for the same
  // cross-reference reason given in readListingPrs().
  const where = (r) => {
    if (!r.url) return esc(r.label);
    return r.key.startsWith('pr:') ? `${esc(r.label)} \`${r.url}\`` : `[${esc(r.label)}](${r.url})`;
  };
  const line = (r) => `| ${where(r)} | ${esc(r.verdict.reasons.join('; '))} | ${esc(r.fix)} |`;
  const out = [];
  out.push(`<!-- ecosystem-sync:stuck=${stuck.join(',')} -->`);
  out.push('## What the listings say, against what DC Hub serves');
  out.push('');
  out.push(`**Single source, read ${generatedAt} (${scope} sweep):** ${ssot.tools ?? 'UNREAD'} tools from live \`tools/list\` · `
    + `${ssot.facilities ?? 'UNREAD'} facilities from \`/api/v1/canon/phrases\` (live only) · server.json ${ssot.version} · `
    + `MCP packs from What's New: ${ssot.packs?.length ? ssot.packs.join(', ') : 'UNREAD'}`);
  if (ssot.notes?.length) out.push(`\n> ${ssot.notes.join('\n> ')}`);
  out.push('');
  out.push('### Stuck on a manual step (prospecting)');
  const manual = stuck.map((k) => byKey.get(k)).filter(Boolean);
  if (manual.length) {
    out.push('| listing | what it says now | what fixes it |', '|---|---|---|');
    for (const r of manual) out.push(line(r));
    out.push('', 'Paste-ready line, generated from the single source (Pro is $99/mo, never $299, no Founding offer):', '', '```', pasteLine(ssot), '```');
    out.push('', 'For an open PR on a curated list, update THAT PR in place. A second PR reads as a duplicate to those bots.');
  } else {
    out.push('Nothing. Every listing a person has to edit matches the live source.');
  }
  const ours = results.filter((r) => r.kind === 'ours' && r.verdict.state === 'drift');
  out.push('', '### DC Hub surfaces behind the source (ours to fix, not prospecting)');
  if (ours.length) {
    out.push('| surface | what it says now | where it is fixed |', '|---|---|---|');
    for (const r of ours) out.push(line(r));
  } else {
    out.push('None.');
  }
  const waiting = results.filter((r) => r.verdict.state === 'drift' && !stuck.includes(r.key) && r.kind !== 'ours');
  if (waiting.length) {
    out.push('', '### Catching up on their own (inside the re-crawl or publish window)');
    for (const r of waiting) out.push(`- ${esc(r.label)}: ${esc(r.verdict.reasons.join('; '))}`);
  }
  const unread = results.filter((r) => r.verdict.state === 'unreadable');
  if (unread.length) {
    out.push('', '### Could not read this sweep (not counted as drift, not counted as clean)');
    for (const r of unread) out.push(`- ${esc(r.label)}: ${esc(r.verdict.reasons.join('; '))}`);
  }
  const ok = results.filter((r) => r.verdict.state === 'in_sync').map((r) => r.label);
  if (ok.length) out.push('', `### In sync\n${ok.join(' · ')}`);
  out.push('', '### Lanes this cycle');
  for (const [lane, p] of Object.entries(plan)) {
    out.push(`- **${WORKFLOWS[lane]}**: ${p.dispatch ? 'DISPATCHED' : 'held'}. ${esc(p.why)}`);
  }
  out.push('', '_Maintained by `.github/workflows/ecosystem-sync.yml`: a core check every 30 minutes and a full listing sweep every 2 hours. '
    + 'Listings with an API are republished by the lanes above. This issue lists only what needs a person, comments only when that list grows, and closes itself when nothing is left._');
  return `${out.join('\n')}\n`;
}

// ── main ───────────────────────────────────────────────────────────────────

function readJson(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return null; }
}

function setOutput(k, v) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${String(v ?? '').replace(/\r?\n/g, ' ')}\n`);
  }
}

function parseArgs(argv) {
  const a = { scope: 'auto', out: 'ecosystem-sync' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--scope') a.scope = argv[++i];
    else if (argv[i] === '--out') a.out = argv[++i];
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const started = new Date();
  const scope = resolveScope(args.scope, started);
  const serverJson = readJson('server.json') || {};
  const snapshot = readJson('canonical/canon_phrases.json');
  let repoPacks = [];
  try {
    repoPacks = fs.readdirSync(path.join(ROOT, 'integrations', 'packs'))
      .filter((f) => f.endsWith('.json') && !f.endsWith('.managed-agent.json'))
      .map((f) => f.replace(/\.json$/, '')).sort();
  } catch { /* no packs dir */ }

  // 1. the single source
  const [canonR, liveR, wnR] = await Promise.all([
    readCanon(),
    mcpToolList(`${ORIGIN}/mcp`),
    fetchText(bust(`${ORIGIN}/api/v1/whats-new`), { ua: SELF_UA, accept: 'application/json' }),
  ]);
  let packs = null;
  if (wnR.ok) { try { packs = packCodes(JSON.parse(wnR.text)); } catch { packs = null; } }
  const c = canonR.read ? canonR.canon : {};
  const ssot = {
    tools: liveR.read ? liveR.count : null,
    toolNames: liveR.read ? liveR.names : null,
    facilities: c.facilities || null,
    deals: c.deals || null,
    markets: c.markets || null,
    version: serverJson.version || null,
    serverName: serverJson.name || 'cloud.dchub/mcp-server',
    packs,
    notes: [],
  };
  if (!canonR.read) ssot.notes.push(`canon not usable: ${canonR.error}. Floors are UNMEASURED this cycle, so no floor is judged and no heal is planned from them.`);
  if (!liveR.read) ssot.notes.push(`live tools/list unreadable: ${liveR.error}. Tool counts are UNMEASURED this cycle.`);
  if (canonR.read && liveR.read && canonR.canon.tools !== liveR.count) {
    ssot.notes.push(`canon says ${canonR.canon.tools} tools while live tools/list serves ${liveR.count}.`);
  }
  if (liveR.read && liveR.serverVersion && ssot.version && liveR.serverVersion !== ssot.version) {
    ssot.notes.push(`live serverInfo ${liveR.serverVersion} differs from server.json ${ssot.version}.`);
  }
  if (packs && repoPacks.length && packs.join(',') !== repoPacks.join(',')) {
    ssot.notes.push(`What's New announces packs [${packs.join(', ')}] but integrations/packs carries [${repoPacks.join(', ')}].`);
  }

  // 2. the sinks
  const readers = {
    official: () => readOfficial(ssot),
    smithery: () => readSmithery(ssot),
    mcp_json: () => readMcpJson(),
    server_card: () => readOurPage('server_card'),
    llms_txt: () => readOurPage('llms_txt'),
    agents_md: () => readOurPage('agents_md'),
    agent_card: () => readOurPage('agent_card'),
    openapi: () => readOurPage('openapi'),
    connect: () => readOurPage('connect'),
    integrations: () => readOurPage('integrations'),
    mcp_standing: () => readOurPage('mcp_standing'),
    readme: () => readReadme(),
    gh_description: () => readGhDescription(),
    glama_connector: () => readGlama('glama_connector'),
    glama_server: () => readGlama('glama_server'),
    pulsemcp: () => readPulse(),
    lobehub: () => readLobe(),
    mcphive: () => readHive(),
    mcp_so: () => readMcpSo('mcp_so'),
    mcp_so_secondary: () => readMcpSo('mcp_so_secondary'),
  };
  const keys = Object.keys(readers).filter((k) => scope === 'full' || SINKS[k].scope === 'core');
  const observe = async (k) => {
    const obs = await readers[k]();
    return {
      key: k, label: SINKS[k].label, kind: SINKS[k].kind, fix: SINKS[k].fix,
      url: SINKS[k].page || SINKS[k].url || (SINKS[k].path ? `${ORIGIN}${SINKS[k].path}` : null),
      obs, verdict: judge(obs, ssot),
    };
  };
  let results = await Promise.all(keys.map(observe));

  // A single read is not a verdict for a surface that can flap: registry
  // projections lag their own writes, and a backend replica answers from a cold
  // cache for its first minutes. Re-read once before anything acts on drift.
  const toConfirm = results.filter((r) => r.verdict.state === 'drift' && (r.kind === 'ours' || r.kind === 'push'));
  if (toConfirm.length) {
    await sleep(CONFIRM_DELAY_MS);
    const again = new Map((await Promise.all(toConfirm.map((r) => observe(r.key)))).map((r) => [r.key, r]));
    results = results.map((r) => again.get(r.key) || r);
  }

  if (scope === 'full') {
    const prs = await readListingPrs();
    if (prs.read) {
      for (const p of prs.prs) {
        results.push({
          key: p.key, label: p.label, kind: 'manual', url: p.url,
          fix: 'our open PR on a curated list. Refresh it in place with the paste-ready line',
          obs: p.obs, verdict: judge(p.obs, ssot),
        });
      }
    } else {
      results.push({ key: 'listing_prs', label: 'open listing PRs', kind: 'manual', fix: '', obs: prs, verdict: judge(prs, ssot) });
    }
  }

  // 3. plan
  const official = results.find((r) => r.key === 'official');
  const smithery = results.find((r) => r.key === 'smithery');
  const healDrift = canonR.read || liveR.read
    ? repoDrift({ snapshot, canon: canonR.read ? canonR.canon : null, serverJson, liveTools: ssot.tools })
    : [];
  const registryBehind = official?.verdict.state !== 'unreadable' && official?.obs.version && ssot.version
    && semverCmp(official.obs.version, ssot.version) < 0
    ? `registry serves ${official.obs.version}, server.json on main is ${ssot.version}` : '';
  const smitheryReasons = smithery?.verdict.state === 'drift' ? smithery.verdict.reasons : [];
  const ctx = await readRunContext();
  const plan = planActions({
    healDrift, registryBehind, smitheryReasons, runs: ctx.runs, openHealPrs: ctx.openHealPrs, now: Date.now(),
  });

  // 4. escalate
  const changeTimes = [official?.obs?.publishedAt, snapshot?.retrieved_at].map((t) => Date.parse(t || '')).filter(Number.isFinite);
  const hoursSinceChange = changeTimes.length ? (Date.now() - Math.max(...changeTimes)) / 3600000 : null;
  const stuck = scope === 'full' ? stuckKeys(results, { hoursSinceChange }) : [];
  const issue = scope === 'full' ? await readIssue() : null;
  const fresh = issue ? newlyStuck(stuckMarker(issue.body), stuck) : [];
  const labelOf = new Map(results.map((r) => [r.key, r.label]));

  const unobserved = !canonR.read && !liveR.read;
  const drift = results.filter((r) => r.verdict.state === 'drift');
  const oursDrift = drift.filter((r) => r.kind === 'ours');
  const generatedAt = started.toISOString().replace(/\.\d+Z$/, 'Z');
  const report = {
    generated_at: generatedAt, scope, ssot, hours_since_change: hoursSinceChange,
    heal_drift: healDrift, registry_behind: registryBehind, plan,
    stuck, newly_stuck: fresh, run_context_error: ctx.error || null,
    results: results.map((r) => ({ key: r.key, label: r.label, kind: r.kind, state: r.verdict.state, reasons: r.verdict.reasons, info: r.obs?.info || '' })),
  };
  const issueBody = renderIssue({ ssot, results, stuck, plan, generatedAt, scope });
  fs.writeFileSync(`${args.out}.json`, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(`${args.out}.issue.md`, issueBody);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, issueBody);

  // 5. say it
  console.log(`ecosystem-sync ${generatedAt} scope=${scope}`);
  console.log(`  source: ${ssot.tools ?? 'UNREAD'} tools · ${ssot.facilities ?? 'UNREAD'} facilities · server.json ${ssot.version} · packs ${ssot.packs ? ssot.packs.join(',') : 'UNREAD'}`);
  for (const n of ssot.notes) console.log(`  ! ${n}`);
  for (const r of results) {
    const mark = { in_sync: 'ok   ', drift: 'DRIFT', unreadable: '??   ' }[r.verdict.state];
    console.log(`  ${mark} ${r.label.padEnd(34)} ${r.verdict.state === 'in_sync' ? (r.obs?.info || '') : r.verdict.reasons.join('; ')}`);
    if (r.verdict.state === 'drift' && process.env.GITHUB_ACTIONS) {
      console.log(`::warning title=${r.label}::${r.verdict.reasons.join('; ')}`);
    }
  }
  for (const [lane, p] of Object.entries(plan)) console.log(`  ${p.dispatch ? 'DISPATCH' : 'hold    '} ${WORKFLOWS[lane]}: ${p.why}`);
  if (scope === 'full') console.log(`  stuck (needs a person): ${stuck.length ? stuck.join(', ') : 'none'}${fresh.length ? ` · NEW: ${fresh.join(', ')}` : ''}`);

  setOutput('scope', scope);
  setOutput('state', unobserved ? 'unobserved' : (drift.length ? 'drift' : 'ok'));
  setOutput('dispatch_heal', plan.heal.dispatch ? 'yes' : 'no');
  setOutput('dispatch_registry', plan.registry.dispatch ? 'yes' : 'no');
  setOutput('dispatch_smithery', plan.smithery.dispatch ? 'yes' : 'no');
  setOutput('heal_why', plan.heal.why);
  setOutput('registry_why', plan.registry.why);
  setOutput('smithery_why', plan.smithery.why);
  setOutput('stuck_count', stuck.length);
  setOutput('ours_drift_count', oursDrift.length);
  setOutput('newly_stuck', fresh.map((k) => labelOf.get(k) || k).join(', '));
  setOutput('issue_number', issue?.number || '');
  setOutput('issue_title', ISSUE_TITLE);
  setOutput('beat_status', unobserved ? 'awaiting_upstream' : 'success');
  setOutput('beat_note', `${ssot.tools ?? '?'} tools · ${ssot.facilities ?? '?'} · drift ${drift.length} · stuck ${stuck.length} · `
    + `dispatched ${Object.entries(plan).filter(([, p]) => p.dispatch).map(([k]) => k).join('+') || 'none'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`ecosystem-sync crashed: ${e?.stack || e}`);
    process.exit(1);
  });
}
