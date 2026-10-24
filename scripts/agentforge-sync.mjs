#!/usr/bin/env node
// =============================================================================
// agentforge-sync — keep DC Hub's AgentForge listing equal to what we serve.
// -----------------------------------------------------------------------------
// WHY (2026-10-23). AgentForge (agentforge.community, the EU MCP marketplace)
// imports ~23,000 servers from Glama and the awesome lists, and DC Hub is not
// one of them: discover?q=dchub returned 0 on 2026-10-23. Unlike most
// directories it has a publish API (POST /api/v1/servers, PUT
// /api/v1/servers/{id}, X-API-Key), so it can be kept current with no person
// in the loop, the way smithery-freshness keeps Smithery.
//
// ONE SOURCE, never a second copy:
//   canonical/listing-copy.json   name, short and long description (owner copy)
//   live https://dchub.cloud/mcp  tools/list: every tool name, description, schema
//
// WHAT IT DOES
//   1. builds the listing from those two reads
//   2. finds our listing: AGENTFORGE_SERVER_ID if set, else GET /agents/me with
//      the key, else a public discover search matched on endpoint_url
//   3. no listing -> POST; listing differs -> PUT; same -> nothing
//   4. re-reads the public listing and fails unless it now matches
//
// SAFE BY DEFAULT: without AGENTFORGE_API_KEY it is a dry run. It prints the
// body it would send and what the public listing says, and writes nothing.
// The key is a dashboard user key (af_<64 hex>), created by the owner and
// stored as the repo secret AGENTFORGE_API_KEY; nothing here mints one.
//
//   node scripts/agentforge-sync.mjs            # dry run unless the key is set
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadListingCopy, copyRuleViolations, MCP_URL } from './listing-copy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AF_API = (process.env.AGENTFORGE_API_BASE || 'https://agentforge.community/api/v1').replace(/\/+$/, '');
const ORIGIN = (process.env.DCHUB_ORIGIN || 'https://dchub.cloud').replace(/\/+$/, '');
// Our own probe: `dchub` + `probe` satisfy server.mjs _INTERNAL_SELF_TAG, so
// this read is never counted as external demand.
export const SELF_TAG = 'dchub-agentforge-sync-probe';
const SELF_UA = `${SELF_TAG}/1.0 (+https://github.com/azmartone67/dchub-mcp-server)`;

export const LISTING_NAME = 'DC Hub';
// AgentForge categories (GET /api/v1/docs): "data" is the form's Data & Analytics.
export const CATEGORY = 'data';
export const TAGS = ['data-center', 'site-selection', 'power-grid', 'energy', 'interconnection-queue', 'fiber', 'infrastructure', 'gis'];
export const DOCS_URL = 'https://dchub.cloud/developers';
export const SOURCE_URL = 'https://github.com/azmartone67/dchub-mcp-server';

// ── pure helpers (exported for test/agentforge-sync.test.mjs) ──────────────

/** The listing we want AgentForge to hold, from the copy file and live tools. */
export function buildListing(copy, tools) {
  if (!copy?.short || !copy?.long) throw new Error('listing-copy.json has no short/long');
  if (!Array.isArray(tools) || !tools.length) throw new Error('live tools/list returned no tools');
  return {
    name: LISTING_NAME,
    description: copy.short,
    long_description: copy.long,
    category: CATEGORY,
    endpoint_url: MCP_URL,
    pricing_model: 'freemium',
    tags: TAGS,
    documentation_url: DOCS_URL,
    source_url: SOURCE_URL,
    tools: tools.map((t) => ({
      name: t.name,
      description: String(t.description || ''),
      input_schema: t.inputSchema || { type: 'object', properties: {} },
    })),
  };
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const toolNames = (tools) => (Array.isArray(tools) ? tools : [])
  .map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean).sort();

/** What differs between the public listing and the one we want. [] = in sync. */
export function listingDrift(remote, want) {
  if (!remote) return ['not listed'];
  const out = [];
  if (norm(remote.endpoint_url) !== want.endpoint_url) out.push(`endpoint ${remote.endpoint_url || 'none'} (want ${want.endpoint_url})`);
  if (norm(remote.description) !== norm(want.description)) out.push('short description differs from listing-copy.json');
  if (remote.long_description != null && norm(remote.long_description) !== norm(want.long_description)) {
    out.push('long description differs from listing-copy.json');
  }
  const have = toolNames(remote.tools);
  const wantNames = toolNames(want.tools);
  if (have.length || Number.isInteger(remote.total_tools)) {
    const missing = wantNames.filter((n) => !have.includes(n));
    const extra = have.filter((n) => !wantNames.includes(n));
    if (have.length && (missing.length || extra.length)) {
      out.push(`tools: ${have.length} listed, ${wantNames.length} live`
        + `${missing.length ? `; missing ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` +${missing.length - 5}` : ''}` : ''}`
        + `${extra.length ? `; retired ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ` +${extra.length - 5}` : ''}` : ''}`);
    } else if (!have.length && remote.total_tools !== wantNames.length) {
      out.push(`total_tools ${remote.total_tools} (live ${wantNames.length})`);
    }
  } else {
    out.push('lists no tools');
  }
  return out;
}

/** Our listing among discover results: same endpoint, never a name guess. */
export function pickOurs(servers) {
  return (Array.isArray(servers) ? servers : []).find((s) => norm(s?.endpoint_url).replace(/\/+$/, '') === MCP_URL) || null;
}

/** POST, PUT or nothing. The key is required for either write. */
export function planWrite({ remote, drift, hasKey }) {
  if (!drift.length) return { action: 'none', why: 'AgentForge listing matches the live server and listing-copy.json' };
  if (!hasKey) return { action: 'dry-run', why: `would ${remote ? 'PUT' : 'POST'}: ${drift.join('; ')}. AGENTFORGE_API_KEY is not set` };
  return remote?.id
    ? { action: 'put', why: drift.join('; ') }
    : { action: 'post', why: drift.join('; ') };
}

/** AgentForge wraps bodies as {success, data, error}; some routes answer bare. */
export function unwrap(json) {
  if (json && typeof json === 'object' && 'success' in json && 'data' in json) return json.data;
  return json;
}

// ── network ────────────────────────────────────────────────────────────────

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

async function liveTools() {
  const url = `${ORIGIN}/mcp`;
  const hdrs = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': SELF_UA, 'x-mcp-platform': SELF_TAG };
  const init = await fetch(url, { method: 'POST', headers: hdrs, signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: SELF_TAG, version: '1' } } }) });
  await init.text();
  const sid = init.headers.get('mcp-session-id');
  const h2 = sid ? { ...hdrs, 'mcp-session-id': sid } : hdrs;
  await fetch(url, { method: 'POST', headers: h2, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }).then((r) => r.text()).catch(() => {});
  const tl = await fetch(url, { method: 'POST', headers: h2, signal: AbortSignal.timeout(45000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
  const tools = lastJsonFrame(await tl.text())?.result?.tools;
  if (!Array.isArray(tools) || !tools.length) throw new Error(`live tools/list returned no tools (HTTP ${tl.status})`);
  return tools;
}

async function af(method, pathname, { key, body } = {}) {
  const headers = { Accept: 'application/json', 'User-Agent': SELF_UA };
  if (key) headers['X-API-Key'] = key;
  if (body) headers['Content-Type'] = 'application/json';
  try {
    const r = await fetch(`${AF_API}${pathname}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { ok: r.ok, status: r.status, json, text: text.slice(0, 400) };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: String(e?.message || e) };
  }
}

/** The public view of one listing, with its tools. */
async function readPublic(idOrSlug) {
  const s = await af('GET', `/server/${encodeURIComponent(idOrSlug)}`);
  if (!s.ok) return null;
  const server = unwrap(s.json);
  const srv = server?.server || server;
  if (!srv || typeof srv !== 'object') return null;
  if (!Array.isArray(srv.tools) || !srv.tools.length) {
    const t = await af('GET', `/server/${encodeURIComponent(idOrSlug)}/tools`);
    const tools = unwrap(t.json);
    if (t.ok) srv.tools = Array.isArray(tools) ? tools : (tools?.tools || srv.tools);
  }
  return srv;
}

async function findOurs(key) {
  const pinned = (process.env.AGENTFORGE_SERVER_ID || '').trim();
  if (pinned) return { remote: await readPublic(pinned), via: 'AGENTFORGE_SERVER_ID' };
  if (key) {
    const me = await af('GET', '/agents/me', { key });
    const d = unwrap(me.json);
    const mine = pickOurs(d?.servers || d?.published_servers || []);
    if (mine) return { remote: await readPublic(mine.id || mine.slug), via: '/agents/me' };
  }
  for (const q of ['DC Hub', 'dchub']) {
    const r = await af('GET', `/discover?q=${encodeURIComponent(q)}&limit=50`);
    const hit = pickOurs(unwrap(r.json)?.servers);
    if (hit) return { remote: await readPublic(hit.id || hit.slug), via: `discover?q=${q}` };
  }
  return { remote: null, via: 'not found' };
}

// ── main ───────────────────────────────────────────────────────────────────

function summary(lines) {
  const text = `${lines.join('\n')}\n`;
  process.stdout.write(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}

async function main() {
  const key = (process.env.AGENTFORGE_API_KEY || '').trim();
  const copy = loadListingCopy(ROOT);
  const bad = copy ? [...copyRuleViolations(copy.short), ...copyRuleViolations(copy.long)] : ['listing-copy.json unreadable'];
  if (bad.length) throw new Error(`listing copy breaks the copy rules, refusing to publish: ${bad.join('; ')}`);
  const want = buildListing(copy, await liveTools());
  const { remote, via } = await findOurs(key);
  const drift = listingDrift(remote, want);
  const plan = planWrite({ remote, drift, hasKey: !!key });
  const out = ['## AgentForge listing', '',
    `- live: ${want.tools.length} tools at ${want.endpoint_url}`,
    `- listing: ${remote ? `${remote.slug || remote.id} (found via ${via})` : 'none'}`,
    `- drift: ${drift.length ? drift.join('; ') : 'none'}`,
    `- action: **${plan.action}**. ${plan.why}`];

  if (plan.action === 'dry-run' || plan.action === 'none') {
    if (plan.action === 'dry-run' && process.env.AGENTFORGE_PRINT_BODY === '1') {
      out.push('', '```json', JSON.stringify({ ...want, tools: `${want.tools.length} tools` }, null, 2), '```');
    }
    summary(out);
    return;
  }

  const res = plan.action === 'post'
    ? await af('POST', '/servers', { key, body: want })
    : await af('PUT', `/servers/${encodeURIComponent(remote.id)}`, { key, body: want });
  out.push(`- ${plan.action.toUpperCase()}: HTTP ${res.status}${res.ok ? '' : ` ${res.text}`}`);
  if (!res.ok) { summary(out); process.exitCode = 1; return; }
  const written = unwrap(res.json);
  const id = written?.id || written?.server?.id || written?.slug || remote?.id;
  if (id) out.push(`- listing id: \`${id}\` (pin it as the repo variable AGENTFORGE_SERVER_ID)`);

  // Read back from the public side: a 200 on the write is not a listing.
  const after = id ? await readPublic(id) : (await findOurs(key)).remote;
  const left = listingDrift(after, want);
  out.push(`- read-back: ${left.length ? `STILL DIFFERENT: ${left.join('; ')}` : 'public listing matches'}`);
  summary(out);
  if (left.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`agentforge-sync failed: ${e?.stack || e}`);
    process.exit(1);
  });
}
