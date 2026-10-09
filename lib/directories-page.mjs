// /mcp/directories — "Find DC Hub in your MCP directory" (Grok -> brain, 2026-10-09).
//
// canonical/directories.json is the ONE source of truth. Grok's hourly presence
// routine edits that file when a listing goes live or drifts; this module only
// reads it. Nothing here hardcodes a directory.
//
// Page rules (owner brief): no prices, no facility count, no emoji, one column on
// a phone. Only status "live" entries render; "pending" entries stay in the file
// (so the routine can flip them) and never reach the page or the JSON twin.
//
// Every value from the file is escaped, and only https URLs are emitted, so a bad
// edit to the JSON cannot inject markup or a javascript: link into a dchub.cloud
// page.

import { readFileSync } from 'node:fs';

export const DIRECTORIES_PATH = '/mcp/directories';
export const DIRECTORIES_JSON_PATH = '/mcp/directories.json';
export const DIRECTORIES_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
export const DIRECTORIES_FILE = new URL('../canonical/directories.json', import.meta.url);

export function loadDirectories(file = DIRECTORIES_FILE) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function httpsUrl(u) {
  if (typeof u !== 'string' || !u) return null;
  try {
    const p = new URL(u);
    return p.protocol === 'https:' ? p.href : null;
  } catch { return null; }
}

// A directory is shown only when it is live AND has a usable https listing URL.
// A live row without one is a data error; it is dropped rather than rendered as a
// dead card.
export function liveDirectories(data) {
  const rows = Array.isArray(data?.directories) ? data.directories : [];
  return rows
    .filter((d) => d && d.status === 'live' && httpsUrl(d.listing_url))
    .map((d) => ({
      id: String(d.id || ''),
      name: String(d.name || d.id || ''),
      listing_url: httpsUrl(d.listing_url),
      badge_url: httpsUrl(d.badge_url),
      badge_alt: d.badge_alt ? String(d.badge_alt) : null,
      logo_url: httpsUrl(d.logo_url),
    }));
}

// The public JSON twin: live rows only, same fields the page uses.
export function directoriesJson(data, { tools } = {}) {
  return {
    name: 'DC Hub MCP directory listings',
    endpoint: 'https://dchub.cloud/mcp',
    tools: tools ?? null,
    updated_at: data?.updated_at ?? null,
    directories: liveDirectories(data),
  };
}

function monogram(name) {
  const words = String(name).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const m = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2);
  return m.toUpperCase();
}

function card(d) {
  const logo = d.logo_url
    ? `<img class="logo" src="${esc(d.logo_url)}" alt="" width="40" height="40" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="logo mono" aria-hidden="true">${esc(monogram(d.name))}</span>`;
  const badge = d.badge_url
    ? `<img class="badge" src="${esc(d.badge_url)}" alt="${esc(d.badge_alt || `${d.name} listing badge`)}" loading="lazy" referrerpolicy="no-referrer">`
    : '';
  return `<li class="card" data-id="${esc(d.id)}">
  <div class="head">${logo}<h2>${esc(d.name)}</h2></div>
  ${badge}
  <a class="view" href="${esc(d.listing_url)}" rel="noopener" target="_blank">View listing<span class="sr"> on ${esc(d.name)}</span></a>
</li>`;
}

export function renderDirectoriesPage(data, { tools } = {}) {
  const rows = liveDirectories(data);
  const toolsLine = Number.isFinite(tools) && tools > 0 ? `Same ${tools} tools everywhere.` : 'Same tools everywhere.';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Find DC Hub in your MCP directory | DC Hub</title>
<meta name="description" content="DC Hub's MCP server is listed in the directories agents use. One server, one endpoint: https://dchub.cloud/mcp.">
<link rel="canonical" href="https://dchub.cloud/mcp/directories">
<link rel="alternate" type="application/json" href="https://dchub.cloud/mcp/directories.json">
<style>
:root{--bg:#0b0f17;--card:#121826;--line:#1f2937;--text:#e5e7eb;--muted:#9ca3af;--accent:#60a5fa}
@media (prefers-color-scheme: light){:root{--bg:#f8fafc;--card:#fff;--line:#e2e8f0;--text:#0f172a;--muted:#475569;--accent:#1d4ed8}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1040px;margin:0 auto;padding:40px 16px 56px}
h1{font-size:clamp(1.6rem,4vw,2.2rem);line-height:1.2;margin:0 0 8px}
.sub{color:var(--muted);margin:0 0 8px;font-size:1.05rem}
.endpoint{color:var(--muted);margin:0 0 28px;font-size:.95rem}
.endpoint code{color:var(--text)}
ul.grid{list-style:none;margin:0;padding:0;display:grid;gap:14px;grid-template-columns:1fr}
@media (min-width:640px){ul.grid{grid-template-columns:repeat(2,1fr)}}
@media (min-width:960px){ul.grid{grid-template-columns:repeat(3,1fr)}}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px}
.head{display:flex;align-items:center;gap:12px}
.head h2{font-size:1.05rem;margin:0}
.logo{width:40px;height:40px;border-radius:8px;flex:none;object-fit:contain}
.mono{display:inline-flex;align-items:center;justify-content:center;background:var(--line);color:var(--text);font-weight:700;font-size:.9rem}
.badge{max-width:100%;height:auto;align-self:flex-start}
.view{margin-top:auto;color:var(--accent);font-weight:600;text-decoration:none}
.view:hover,.view:focus{text-decoration:underline}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.foot{margin-top:28px;color:var(--muted);font-size:.9rem}
.foot a{color:var(--accent)}
</style>
</head>
<body>
<main>
<h1>Find DC Hub in your MCP directory</h1>
<p class="sub">One server, listed wherever agents look. ${esc(toolsLine)}</p>
<p class="endpoint">Endpoint: <code>https://dchub.cloud/mcp</code></p>
<ul class="grid">
${rows.map(card).join('\n')}
</ul>
<p class="foot">Not using a directory? <a href="https://dchub.cloud/connect">Connect directly</a>. Machine-readable list: <a href="https://dchub.cloud/mcp/directories.json">directories.json</a>.</p>
</main>
</body>
</html>
`;
}
