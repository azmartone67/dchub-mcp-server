// /mcp/connect — the human sign-in page a wall can point at (owner approval 2026-11-20, wall_identity_v2).
//
// WHAT. A browser GET of https://dchub.cloud/mcp/connect shows one page with two ways in:
//   1. "Email me a sign-in link": one email field. It posts to the backend's existing email door,
//      POST /api/v1/dev-signup (dchub-backend flask_mcp_endpoints.dev_signup). That door is
//      enumeration-safe: every valid address gets the same 200, a key is minted only when nothing is
//      bound to the address (otherwise the existing key is re-sent through /keys/recover), and the
//      key only ever travels to the inbox, never in the response. This page never sees or shows a key.
//   2. "Sign in with your MCP client": the OAuth server URL https://dchub.cloud/mcp/oauth (the live
//      AuthKit-backed path, lib/mcp-oauth-path.mjs). Nothing new is registered for it.
//   With ?client=<name> (claude, cursor, chatgpt, windsurf, vscode, ...) the page leads with that
//   client's paste-ready config, taken from claim_free_key's own snippets (server.mjs _persistConfig,
//   resolved by _clientKeyFromNames) with YOUR_API_KEY where the emailed key goes.
//
// WHEN. Behind DCHUB_WALL_IDENTITY_V2 (lib/wall-identity-v2.mjs wallIdentityV2On: on for 1/true/yes/on),
// and only for a GET or HEAD that a browser makes (connectPageWanted). Flag off, a POST, or a request
// that does not accept HTML: server.mjs calls next() and the request is answered exactly as before.
//
// PAGE RULES. No price, no plan or tier name, no allowance figure, no emoji. The email never goes into
// a URL: the form posts a JSON body (and, without a script, a POST body). One inline script, allowed
// by hash; no site nav script (its menu is not ours to vet for these rules).

import { createHash } from 'node:crypto';
import { SIGNIN_URL } from './wall-identity-v2.mjs';

export const CONNECT_PATH = '/mcp/connect';
export const SIGNUP_API = '/api/v1/dev-signup';
export const OAUTH_URL = SIGNIN_URL;
export const KEY_PLACEHOLDER = 'YOUR_API_KEY';
const SITE = 'https://dchub.cloud';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const hdr = (req, name) => {
  const h = (req && req.headers) || {};
  const v = h[name] ?? h[name.toLowerCase()];
  return String(Array.isArray(v) ? v.join(',') : (v ?? '')).toLowerCase();
};

// A browser asking for a page: GET or HEAD, and either Accept names text/html or the fetch metadata
// says it is a top-level document. Never an event-stream GET (an MCP client's stream channel).
export function connectPageWanted(req) {
  const m = String((req && req.method) || '').toUpperCase();
  if (m !== 'GET' && m !== 'HEAD') return false;
  const accept = hdr(req, 'accept');
  if (accept.includes('text/event-stream')) return false;
  if (accept.includes('text/html') || hdr(req, 'sec-fetch-dest') === 'document') return true;
  // A browser navigation that sends Accept: */* (outside test 2026-11-21): a browser user agent AND the fetch
  // metadata of a top-level navigation. An MCP client sends neither Sec-Fetch-Mode: navigate nor a Mozilla UA.
  return hdr(req, 'sec-fetch-mode') === 'navigate' && browserUa(hdr(req, 'user-agent'));
}

// A browser's User-Agent: the Mozilla/5.0 token every current browser sends, and none of the agent / HTTP library
// names an MCP client or a script carries.
export function browserUa(ua) {
  const s = String(ua || '').toLowerCase();
  if (!/^mozilla\/5\.0 /.test(s)) return false;
  return !/\b(?:bot|crawler|spider|curl|wget|python|node-fetch|undici|axios|go-http|okhttp|mcp|claude|cursor|copilot|grok|openai|chatgpt)\b/.test(s);
}

// Clients whose connector settings are a URL box (no header field): the persist_config byo_mcp entry.
const URL_BOX = new Set(['chatgpt', 'openai', 'grok', 'perplexity', 'claude.ai', 'claude-ai', 'claudeai', 'claude-web']);

// { kind, keys? } for a ?client= value, or null. kind: 'claude' (Claude.ai / Desktop connector plus
// Claude Code), 'url_box', or 'snippet' (one persist_config client). The raw value is never echoed.
export function resolveClient(raw, clientKeyFrom) {
  const s = String(raw ?? '').trim().toLowerCase().slice(0, 40);
  if (!s || !/^[a-z0-9 ._-]+$/.test(s)) return null;
  if (s === 'claude') return { kind: 'claude' };
  if (URL_BOX.has(s)) return { kind: 'url_box' };
  const k = typeof clientKeyFrom === 'function' ? clientKeyFrom(s) : null;
  return k ? { kind: 'snippet', keys: [k] } : null;
}

// The config blocks for a resolved client: [{ label, where?, text, note? }]. `persist` is server.mjs
// _persistConfig; it is called with the placeholder so no real key is ever on the page.
export function clientBlocks(resolved, persist) {
  if (!resolved || typeof persist !== 'function') return [];
  const cfg = persist(KEY_PLACEHOLDER) || {};
  const clients = cfg.clients || {};
  const one = (k) => {
    const c = clients[k];
    return c && c.snippet ? { label: c.label || k, where: c.file || '', text: c.snippet } : null;
  };
  const urlBox = (label) => [
    { label, where: 'Connector settings: the server URL field', text: OAUTH_URL,
      note: 'Paste this and sign in once in the browser window your client opens. No key to copy.' },
    ...(cfg.connect_url ? [{ label: 'Or, with the key from your email', where: 'The same server URL field',
      text: cfg.connect_url, note: 'Replace ' + KEY_PLACEHOLDER + ' with your key.' }] : []),
  ];
  if (resolved.kind === 'claude') {
    return [...urlBox('Claude.ai and Claude Desktop (Settings, Connectors, Add custom connector)'),
      one('claude_code')].filter(Boolean);
  }
  if (resolved.kind === 'url_box') {
    return urlBox((cfg.byo_mcp && cfg.byo_mcp.label) || 'Clients with a server URL box');
  }
  return (resolved.keys || []).map(one).filter(Boolean);
}

// The only script on the page. Plain DOM, no dependencies, no network call but the one form post.
export const CONNECT_SCRIPT = `
(function(){
  var f=document.getElementById('signin'),msg=document.getElementById('msg'),done=document.getElementById('done'),btn=document.getElementById('send');
  function say(t){if(msg){msg.textContent=t;msg.hidden=!t;}}
  if(f&&window.fetch){
    f.addEventListener('submit',function(e){
      e.preventDefault();say('');
      var em=String(f.elements.email.value||'').trim();
      var at=em.indexOf('@');
      if(at<1||em.indexOf('.',at)<at+2||/\\s/.test(em)){say('Enter a valid email address.');return;}
      var body={email:em},c=f.getAttribute('data-client');if(c){body.client=c;}
      btn.disabled=true;
      fetch(f.getAttribute('action'),{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)})
        .then(function(r){
          if(r.ok){f.hidden=true;done.hidden=false;done.focus();return;}
          btn.disabled=false;
          say(r.status===400?'Enter a valid email address.':'We could not send that. Please try again.');
        })
        .catch(function(){btn.disabled=false;say('We could not send that. Check your connection and try again.');});
    });
  }
  var bs=document.querySelectorAll('button[data-copy]');
  for(var i=0;i<bs.length;i++){bs[i].addEventListener('click',function(){
    var b=this,t=document.getElementById(b.getAttribute('data-copy'));
    if(!t||!navigator.clipboard)return;
    navigator.clipboard.writeText(t.textContent).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy';},1500);});
  });}
})();
`;

const scriptHash = () => "'sha256-" + createHash('sha256').update(CONNECT_SCRIPT).digest('base64') + "'";

// One inline script by hash plus Cloudflare's analytics beacon; fetch and form posts same-origin only
// (the page is served at dchub.cloud, where /api/v1/dev-signup lives); no frames, no images but data:.
export const CONNECT_CSP = () =>
  `default-src 'none'; script-src ${scriptHash()} https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; ` +
  "style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; " +
  "img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

let _copyId = 0;
const codeBlock = (text) => {
  const id = 'cfg' + (++_copyId);
  return `<div class="code"><pre id="${id}"><code>${esc(text)}</code></pre><button type="button" class="copy" data-copy="${id}">Copy</button></div>`;
};

const blockHtml = (b) => `<div class="blk"><p class="lbl">${esc(b.label)}</p>${b.where ? `<p class="where">${esc(b.where)}</p>` : ''}${codeBlock(b.text)}${b.note ? `<p class="where">${esc(b.note)}</p>` : ''}</div>`;

// renderConnectPage({ client, persist, clientKeyFrom }): client is the raw ?client= value; persist and
// clientKeyFrom are server.mjs _persistConfig and _clientKeyFromNames.
export function renderConnectPage({ client = '', persist = null, clientKeyFrom = null } = {}) {
  _copyId = 0;
  const resolved = resolveClient(client, clientKeyFrom);
  const blocks = clientBlocks(resolved, persist);
  const dataClient = resolved && resolved.kind === 'snippet' ? resolved.keys[0] : (resolved ? resolved.kind : '');
  const lead = blocks.length ? `
<section class="card" id="your-client">
  <h2>Paste-ready config for your client</h2>
  <p class="sub">Your key arrives by email. Put it where the config says ${KEY_PLACEHOLDER}.</p>
  ${blocks.map(blockHtml).join('\n  ')}
</section>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in to DC Hub | DC Hub</title>
<meta name="description" content="Connect DC Hub to your AI assistant: get a sign-in link by email, or sign in from your MCP client.">
<meta name="robots" content="noindex">
<link rel="canonical" href="${SITE}${CONNECT_PATH}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
:root{--bg:#0a0a0f;--card:#131319;--line:rgba(255,255,255,.12);--text:#fafafa;--muted:#a1a1aa;--accent:#818cf8;--err:#f87171}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 'Instrument Sans',-apple-system,system-ui,Segoe UI,Roboto,sans-serif}
code,pre{font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace}
main{max-width:640px;margin:0 auto;padding:40px 16px 56px;display:grid;gap:20px}
h1{font-size:clamp(1.6rem,4vw,2.1rem);line-height:1.2;margin:0}
h2{font-size:1.15rem;margin:0}
.sub{color:var(--muted);margin:0}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;display:grid;gap:12px}
form{display:grid;gap:12px}
label{font-weight:600;font-size:.95rem}
input[type=email]{width:100%;font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
button,summary.btn{font:inherit;font-weight:700;color:#fff;background:linear-gradient(135deg,#6366f1 0%,#a855f7 100%);border:0;border-radius:8px;padding:12px 20px;cursor:pointer}
summary.btn{list-style:none;display:inline-block}
summary.btn::-webkit-details-marker{display:none}
button:disabled{opacity:.6;cursor:default}
#msg{color:var(--err);margin:0}
.blk{display:grid;gap:4px}
.lbl{font-weight:600;margin:0}
.where{color:var(--muted);font-size:.85rem;margin:0}
.code{position:relative}
pre{margin:0;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 64px 10px 12px;white-space:pre-wrap;word-break:break-all;font-size:.85rem}
button.copy{position:absolute;top:6px;right:6px;padding:4px 10px;font-size:.8rem;background:#27272a}
details{display:grid;gap:12px}
details[open] summary.btn{margin-bottom:12px}
ol{margin:0;padding-left:20px;display:grid;gap:6px}
a{color:var(--accent)}
.foot{color:var(--muted);font-size:.9rem;margin:0}
</style>
</head>
<body>
<main>
<h1>Sign in to DC Hub</h1>
<p class="sub">Connect DC Hub to your AI assistant once and it keeps your history across chats. Pick one way in.</p>
${lead}
<section class="card" id="email">
  <h2>Get a sign-in link by email</h2>
  <form id="signin" method="post" action="${SIGNUP_API}"${dataClient ? ` data-client="${esc(dataClient)}"` : ''} novalidate>
    <label for="email-input">Email</label>
    <input id="email-input" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@company.com">
    <p id="msg" role="alert" hidden></p>
    <button id="send" type="submit">Email me a sign-in link</button>
  </form>
  <div id="done" tabindex="-1" hidden>
    <h2>Check your inbox</h2>
    <p class="sub">If that address can receive email, a message from DC Hub is on its way. It opens your key once and says how to add it to your client. It can take a minute; check spam if it does not arrive.</p>
  </div>
</section>
<section class="card" id="oauth">
  <details>
    <summary class="btn">Sign in with your MCP client</summary>
    <p class="sub">If your AI client can sign in to an MCP server (Claude, Cursor, VS Code, Windsurf and others can), add DC Hub with this server URL. Your client opens a browser window to sign in once, and there is no key to copy.</p>
    ${codeBlock(OAUTH_URL)}
    <ol>
      <li>Open your client's MCP or connector settings and add a server.</li>
      <li>Paste the URL above as the server URL. Leave any header or key field empty.</li>
      <li>Sign in when the browser window opens, then ask your question again.</li>
    </ol>
    <p class="where">Claude Code, one command:</p>
    ${codeBlock('claude mcp add --transport http dchub ' + OAUTH_URL)}
  </details>
</section>
<p class="foot">Setup steps for every client: <a href="${SITE}/connect">dchub.cloud/connect</a>.</p>
</main>
<script>${CONNECT_SCRIPT}</script>
</body>
</html>
`;
}
