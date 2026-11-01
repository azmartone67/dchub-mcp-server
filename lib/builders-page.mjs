// /mcp/builders — "Compose DC Hub inside your gateway, aggregator or agent"
// (owner 2026-10-20, ecosystem strategy item 8: the upstream program).
//
// Audience: builders of MCP gateways, aggregators and toolkits (Pipeworx,
// AnythingMCP, Arcade, Composio, Klavis, ...). The page says how to compose DC
// Hub, what keyless callers get, how rate limits behave behind a shared IP, the
// attribution convention (?via=<name> / X-DCHub-Via) and how to get a partner key.
//
// Page rules: neutral (DC Hub is an upstream for other servers, not a rival to
// them), no plan names, no prices, no facility count, no emoji, one column on a
// phone. The free-tier sentence is passed in from the server's own published
// rule, so this page can never state a limit the gate does not enforce.
//
// Rendered on every request from constants plus the passed-in values; a JSON
// twin at /mcp/builders.json carries the same facts for machines.

export const BUILDERS_PATH = '/mcp/builders';
export const BUILDERS_JSON_PATH = '/mcp/builders.json';
export const BUILDERS_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export const VIA_HEADER = 'X-DCHub-Via';
export const VIA_QUERY = 'via';
export const PARTNER_CONTACT = 'partnerships@dchub.cloud';
const SITE = 'https://dchub.cloud';

// Tools a gateway most often routes to. Names only; every one is on tools/list.
export const SUGGESTED_TOOLS = Object.freeze([
  ['execute_plan', 'a multi-part data-center, power or siting question, passed through unchanged'],
  ['get_market_intel', 'one market: power verdict, grid context, recent activity'],
  ['get_grid_data', 'live ISO grid conditions'],
  ['get_interconnection_queue', 'interconnection queue depth by ISO, dated to the operator file'],
  ['search_facilities', 'facilities by place, operator or size'],
  ['source_capacity', 'available capacity, powered land and colocation space'],
  ['summarize_for_citation', 'a figure with its source and as-of date, ready to quote'],
]);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The published SDKs that compose DC Hub's tools inside another MCP server
// (sdk/COMPOSE.md). Versions are the ones on the registries; the test pins them
// to sdk/node/package.json and sdk/python/pyproject.toml. Linked from 2026-11-01,
// the day both were published.
export const COMPOSE_KIT = Object.freeze({
  docs: 'https://github.com/azmartone67/dchub-mcp-server/blob/main/sdk/COMPOSE.md',
  node: Object.freeze({
    version: '0.2.0',
    install: 'npm i dchub',
    usage: 'import { registerDCHubTools } from "dchub/compose";\nawait registerDCHubTools(server, { via: "<your-name>" });',
    package: 'https://www.npmjs.com/package/dchub',
  }),
  python: Object.freeze({
    version: '0.3.0',
    install: 'pip install "dchub>=0.3.0"',
    usage: 'from dchub.compose import dchub_tool_definitions\ndefs = dchub_tool_definitions(via="<your-name>")',
    package: 'https://pypi.org/project/dchub/',
  }),
});

// The facts both the page and the JSON twin carry. Pure.
export function buildersFacts({ tools, freeTier } = {}) {
  return {
    name: 'Compose DC Hub in your MCP gateway or aggregator',
    page: SITE + BUILDERS_PATH,
    endpoint: SITE + '/mcp',
    transport: 'streamable-http',
    slim_endpoint: SITE + '/mcp/core',
    rest_base: SITE + '/api/v1',
    openapi: SITE + '/openapi.json',
    tools: Number.isFinite(tools) && tools > 0 ? tools : null,
    suggested_tools: SUGGESTED_TOOLS.map(([name, use]) => ({ name, use })),
    keyless: {
      summary: 'Every tool answers without a key. Keyless answers are previews; a gated result carries human_url and human_message for your user.',
      free_tier_rule: freeTier || null,
    },
    rate_limits: {
      keyless: 'Keyless calls are counted per source IP. Requests you relay from many users share your IP, so use keyless calls to evaluate and a partner key for production traffic.',
      partner_key: 'A partner key carries its own allowance, agreed when it is issued, and is not tied to your IP.',
      on_limit: 'A capped call still returns a preview with a human_url; it is not an error. Do not retry in a loop.',
    },
    attribution: {
      query: `?${VIA_QUERY}=<your-name>`,
      header: `${VIA_HEADER}: <your-name>`,
      example_connector_url: SITE + '/mcp?via=<your-name>',
      format: 'lowercase letters, digits, dot, dash or underscore; 1-40 characters',
      purpose: 'DC Hub then counts traffic that arrives through your product separately from end-user clients. It changes nothing in access or results.',
    },
    citation: {
      format: 'DC Hub (dchub.cloud), as of <date>',
      rule: 'Relay each result\'s cite_as, source and as_of to your user unchanged; keep human_url and human_message when a result is partial.',
      license: 'DCPI verdicts and composite scores are CC BY 4.0; each layer states its own licence on /data-sources.',
    },
    partner_key: {
      how: `Email ${PARTNER_CONTACT} with your product, expected volume and a dedicated service address for the key (for example dchub@yourgateway.dev).`,
      rule: 'Partner keys are issued to a dedicated service address, never to a personal login.',
      header: 'X-API-Key: <partner key>',
    },
    compose_kit: {
      summary: 'Register DC Hub tools in your own MCP server with the dchub SDK. Each tool keeps its name and schema, its description is prefixed "From DC Hub (dchub.cloud):", results pass through unchanged, and your via name rides every call.',
      docs: COMPOSE_KIT.docs,
      node: { ...COMPOSE_KIT.node },
      python: { ...COMPOSE_KIT.python },
    },
    partner_kit: SITE + '/partners',
    contact: PARTNER_CONTACT,
  };
}

export function buildersJson(opts) {
  return buildersFacts(opts);
}

export function renderBuildersPage(opts = {}) {
  const f = buildersFacts(opts);
  const toolsLine = f.tools ? `${f.tools} tools over one endpoint.` : 'One endpoint for every tool.';
  const rows = f.suggested_tools
    .map((t) => `<li><code>${esc(t.name)}</code>: ${esc(t.use)}</li>`).join('\n');
  const freeTier = f.keyless.free_tier_rule
    ? `<p class="note">The published free-tier rule, verbatim: ${esc(f.keyless.free_tier_rule)}</p>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Compose DC Hub in your MCP gateway | DC Hub</title>
<meta name="description" content="For MCP gateway and aggregator builders: compose DC Hub's data-center, power and grid tools, keyless previews, rate limits, the ?via= attribution convention and partner keys.">
<link rel="canonical" href="${SITE}${BUILDERS_PATH}">
<link rel="alternate" type="application/json" href="${SITE}${BUILDERS_JSON_PATH}">
<style>
:root{--bg:#05080f;--card:#0d1322;--line:#1f2937;--text:#e5e7eb;--muted:#9ca3af;--accent:#818cf8}
@media (prefers-color-scheme: light){:root{--bg:#f8fafc;--card:#fff;--line:#e2e8f0;--text:#0f172a;--muted:#475569;--accent:#4f46e5}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 'Instrument Sans',system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:40px 16px 64px}
.pill{display:inline-block;padding:5px 12px;border-radius:99px;border:1px solid var(--accent);color:var(--accent);font:700 .72rem/1.3 ui-monospace,Menlo,monospace;letter-spacing:.06em}
h1{font-size:clamp(1.8rem,4.6vw,2.7rem);line-height:1.12;font-weight:800;letter-spacing:-.025em;margin:14px 0 10px}
.grad{background:linear-gradient(90deg,#818cf8,#c084fc 55%,#f472b6);-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:var(--muted);font-size:1.08rem;margin:0 0 26px;max-width:72ch}
h2{font-size:1.3rem;margin:36px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:10px 0}
code,pre{font:.88rem/1.5 ui-monospace,Menlo,Consolas,monospace}
pre{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
ul{padding-left:20px}li{margin:4px 0}
a{color:var(--accent)}
.note{color:var(--muted);font-size:.92rem}
.foot{margin-top:36px;color:var(--muted);font-size:.9rem;border-top:1px solid var(--line);padding-top:14px}
</style>
</head>
<body>
<main>
<span class="pill">FOR GATEWAY AND AGGREGATOR BUILDERS</span>
<h1>Compose DC Hub in your gateway<br><span class="grad">as the data-center and power upstream.</span></h1>
<p class="sub">Your users ask about data centers, power, grid queues and sites. Route those questions to DC Hub and keep your own tools for everything else. ${esc(toolsLine)} Public, cited data; every answer carries its source and as-of date.</p>

<h2>1. Connect</h2>
<div class="card">
<p>MCP (streamable HTTP): <code>${esc(f.endpoint)}</code>. A slim read-only profile: <code>${esc(f.slim_endpoint)}</code>.</p>
<p>REST: <code>${esc(f.rest_base)}</code>, described in <a href="${esc(f.openapi)}">openapi.json</a>.</p>
</div>
<p>Tools gateways route to most often:</p>
<ul>
${rows}
</ul>

<h2>2. Keyless previews</h2>
<p>${esc(f.keyless.summary)} Show your user the <code>human_message</code> and its link when a result is partial; do not invent withheld numbers.</p>
${freeTier}

<h2>3. Rate limits behind a shared IP</h2>
<ul>
<li>${esc(f.rate_limits.keyless)}</li>
<li>${esc(f.rate_limits.partner_key)}</li>
<li>${esc(f.rate_limits.on_limit)}</li>
</ul>

<h2>4. Attribution: tell us it came through you</h2>
<p>Add your name to the connector URL, or send it as a header. ${esc(f.attribution.purpose)}</p>
<pre>${esc(f.attribution.example_connector_url)}
${esc(f.attribution.header)}</pre>
<p class="note">Name format: ${esc(f.attribution.format)}.</p>

<h2>5. Cite what you relay</h2>
<p>${esc(f.citation.rule)} Citation format: <code>${esc(f.citation.format)}</code>. ${esc(f.citation.license)}</p>

<h2>6. Get a partner key</h2>
<p>${esc(f.partner_key.how)} ${esc(f.partner_key.rule)} Send it as <code>${esc(f.partner_key.header)}</code>.</p>

<h2>7. Building an MCP server? Compose DC Hub in code</h2>
<p>${esc(f.compose_kit.summary)}</p>
<div class="card">
<p>Node (<a href="${esc(f.compose_kit.node.package)}">npm dchub ${esc(f.compose_kit.node.version)}</a>):</p>
<pre>${esc(f.compose_kit.node.install)}
${esc(f.compose_kit.node.usage)}</pre>
<p>Python (<a href="${esc(f.compose_kit.python.package)}">PyPI dchub ${esc(f.compose_kit.python.version)}</a>):</p>
<pre>${esc(f.compose_kit.python.install)}
${esc(f.compose_kit.python.usage)}</pre>
<p class="note">Options, starter tools and the rules that come with the data: <a href="${esc(f.compose_kit.docs)}">COMPOSE.md</a>.</p>
</div>

<p class="foot">More for partners (embed cards, evidence receipts, methodology): <a href="${esc(f.partner_kit)}">dchub.cloud/partners</a>. Machine-readable: <a href="${SITE}${BUILDERS_JSON_PATH}">builders.json</a>. Contact: <a href="mailto:${esc(f.contact)}">${esc(f.contact)}</a>.</p>
</main>
</body>
</html>
`;
}

// ── via attribution (request side) ───────────────────────────────────────────
const _VIA_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const _VIA_INTERNAL = /^(dchub|dc-hub|qa|test|probe|internal)([._-]|$)/;

// A well-formed via name, or null. Pure. Same rule as the backend's
// routes/via_attribution.normalize_via, so the gateway never forwards a name the
// backend would drop.
export function normalizeVia(raw) {
  if (raw === undefined || raw === null) return null;
  const v = String(Array.isArray(raw) ? raw[0] : raw).trim().toLowerCase();
  if (!v || !_VIA_RE.test(v) || _VIA_INTERNAL.test(v)) return null;
  return v;
}

// 2026-10-21: Smithery stops proxying MCP traffic on 2026-10-31 (run.tools /
// server.smithery.ai). A call whose forwarded host is one of its proxy hosts is
// tagged `smithery_proxy`, so the installs that break on 11-01 show up in the
// existing via counter (/api/v1/ops/via-weekly). The edge forwards the caller's
// X-Forwarded-Host untouched on /mcp; Host itself is the origin's. A declared via
// always wins. Count only, never access.
export const SMITHERY_PROXY_VIA = 'smithery_proxy';
const _SMITHERY_PROXY_HOST = /(^|\.)(run\.tools|smithery\.ai)$/;

function _hostsFrom(req) {
  const h = req?.headers || {};
  const out = [];
  for (const name of ['x-forwarded-host', 'x-original-host', 'host']) {
    const v = h[name];
    for (const part of String(Array.isArray(v) ? v.join(',') : (v ?? '')).split(',')) out.push(part);
  }
  const fwd = h.forwarded;
  for (const m of String(Array.isArray(fwd) ? fwd.join(',') : (fwd ?? '')).matchAll(/host="?([^;,"\s]+)/gi)) out.push(m[1]);
  return out
    .map((x) => x.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, ''))
    .filter(Boolean);
}

// `smithery_proxy` when a host header names Smithery's proxy, else null. Pure.
export function smitheryProxyVia(req) {
  try {
    return _hostsFrom(req).some((x) => _SMITHERY_PROXY_HOST.test(x)) ? SMITHERY_PROXY_VIA : null;
  } catch {
    return null;
  }
}

// The via an Express request declares: header wins over ?via=; with neither,
// a Smithery proxy host tags it `smithery_proxy`. Pure.
export function viaFromRequest(req) {
  try {
    const h = req?.headers?.[VIA_HEADER.toLowerCase()];
    return normalizeVia(h) || normalizeVia(req?.query?.[VIA_QUERY]) || smitheryProxyVia(req);
  } catch {
    return null;
  }
}
