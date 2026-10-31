// /mcp/partner — "Building with DC Hub? Tell us" (owner approval 2026-10-30 18:17 MST,
// Grok brief). An intake form for people building agents, gateways and data products on
// DC Hub. It posts to the backend (POST /api/v1/mcp/partner-intake), which stores the
// submission, mints a key through the one claim door and emails a one-use reveal link.
// This page never sees or shows a key.
//
// Page rules (from the brief): no plan names, no prices, no counts, no emoji, one column
// on a phone. The form works without a stylesheet; the script only adds the in-page
// thank-you and error messages, and the CSP allows exactly that one script by hash.

import { createHash } from 'node:crypto';

export const PARTNER_PATH = '/mcp/partner';
export const INTAKE_API = '/api/v1/mcp/partner-intake';
const SITE = 'https://dchub.cloud';

// Values must match routes/mcp_partner_intake.py (BUILDING, CLIENTS, EXPECTED_USE).
export const BUILDING = Object.freeze([
  ['ai_agent', 'AI agent or assistant'],
  ['mcp_gateway', 'MCP gateway or marketplace'],
  ['data_platform', 'Data or energy platform'],
  ['site_selection', 'Site-selection or real estate team'],
  ['other', 'Other'],
]);
export const CLIENTS = Object.freeze([
  ['claude', 'Claude'], ['chatgpt', 'ChatGPT'], ['cursor', 'Cursor'], ['copilot', 'Copilot'],
  ['gemini', 'Gemini'], ['grok', 'Grok'], ['mistral', 'Mistral'], ['other', 'Other'],
]);
export const EXPECTED_USE = Object.freeze([
  ['testing', 'Just testing'], ['regular', 'Regular use'], ['production', 'Production integration'],
]);
export const HONEYPOT = 'website';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The only script on the page. Plain DOM, no dependencies.
export const PARTNER_SCRIPT = `
(function(){
  var f=document.getElementById('intake'),msg=document.getElementById('msg'),done=document.getElementById('done'),btn=document.getElementById('send');
  if(!f||!window.fetch)return;
  function say(t){msg.textContent=t;msg.hidden=!t;}
  f.addEventListener('submit',function(e){
    e.preventDefault();say('');
    var fd=new FormData(f),clients=fd.getAll('clients');
    var body={name:fd.get('name'),email:fd.get('email'),company:fd.get('company'),building:fd.get('building'),
      clients:clients,prompts:fd.get('prompts'),expected_use:fd.get('expected_use'),
      data_partnership:fd.get('data_partnership')==='yes',consent:fd.get('consent')==='yes',
      ${HONEYPOT}:fd.get('${HONEYPOT}')||''};
    if(!clients.length){say('Pick at least one AI client.');return;}
    btn.disabled=true;
    fetch('${INTAKE_API}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){return r.json().catch(function(){return {};}).then(function(j){return {s:r.status,j:j};});})
      .then(function(x){
        if(x.s===200&&x.j.ok){f.hidden=true;done.hidden=false;done.scrollIntoView();return;}
        btn.disabled=false;
        say(x.j&&x.j.message?x.j.message:(x.s===429?'Too many submissions from this network. Try again later.':'We could not send that. Please try again.'));
      })
      .catch(function(){btn.disabled=false;say('We could not send that. Check your connection and try again.');});
  });
})();
`;

const scriptHash = () => "'sha256-" + createHash('sha256').update(PARTNER_SCRIPT).digest('base64') + "'";

// One inline script allowed by hash, same-origin fetch only, no frames, no other forms.
export const PARTNER_CSP = () =>
  `default-src 'none'; style-src 'unsafe-inline'; script-src ${scriptHash()}; connect-src 'self'; ` +
  "img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const options = (rows) => rows.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
const checks = (name, rows) => rows.map(([v, l]) =>
  `<label class="chk"><input type="checkbox" name="${esc(name)}" value="${esc(v)}"> ${esc(l)}</label>`).join('');

export function renderPartnerPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Building with DC Hub? Tell us | DC Hub</title>
<meta name="description" content="Tell us what you are building on DC Hub and the questions you want it to answer. We will send you a key and the steps to connect.">
<link rel="canonical" href="${SITE}${PARTNER_PATH}">
<style>
:root{--bg:#0b0f17;--card:#121826;--line:#1f2937;--text:#e5e7eb;--muted:#9ca3af;--accent:#60a5fa;--err:#f87171}
@media (prefers-color-scheme: light){:root{--bg:#f8fafc;--card:#fff;--line:#cbd5e1;--text:#0f172a;--muted:#475569;--accent:#1d4ed8;--err:#b91c1c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:40px 16px 56px}
h1{font-size:clamp(1.6rem,4vw,2.2rem);line-height:1.2;margin:0 0 8px}
.sub{color:var(--muted);margin:0 0 24px}
form,.done{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;display:grid;gap:16px}
label,legend{font-weight:600;font-size:.95rem}
fieldset{border:0;margin:0;padding:0;display:grid;gap:6px}
input[type=text],input[type=email],select,textarea{width:100%;font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
textarea{min-height:120px;resize:vertical}
.hint{color:var(--muted);font-size:.85rem;font-weight:400}
.chk{font-weight:400;display:flex;gap:8px;align-items:center}
.clients{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
button{font:inherit;font-weight:700;color:#fff;background:#2563eb;border:0;border-radius:8px;padding:12px 20px;cursor:pointer}
button:disabled{opacity:.6;cursor:default}
#msg{color:var(--err);margin:0}
.hp{position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden}
.done h2{margin:0}.done ol{margin:0;padding-left:20px;display:grid;gap:6px}
a{color:var(--accent)}
.foot{margin-top:24px;color:var(--muted);font-size:.9rem}
</style>
</head>
<body>
<main>
<h1>Building with DC Hub? Tell us</h1>
<p class="sub">Tell us what you are building and the questions you want DC Hub to answer. We will email you a key and the steps to connect.</p>
<form id="intake" method="post" action="${INTAKE_API}" novalidate>
  <div><label for="name">Full name</label><input id="name" name="name" type="text" autocomplete="name" required maxlength="120"></div>
  <div><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="200"></div>
  <div><label for="company">Company</label><input id="company" name="company" type="text" autocomplete="organization" required maxlength="160"></div>
  <div><label for="building">What are you building?</label>
    <select id="building" name="building" required><option value="" disabled selected>Choose one</option>${options(BUILDING)}</select></div>
  <fieldset><legend>Which AI clients do you use?</legend><div class="clients">${checks('clients', CLIENTS)}</div></fieldset>
  <div><label for="prompts">Two or three prompts you would want DC Hub to answer</label>
    <textarea id="prompts" name="prompts" required minlength="10" maxlength="2000" placeholder="One per line"></textarea></div>
  <div><label for="expected_use">Expected use</label>
    <select id="expected_use" name="expected_use" required><option value="" disabled selected>Choose one</option>${options(EXPECTED_USE)}</select></div>
  <label class="chk"><input type="checkbox" name="data_partnership" value="yes"> I am interested in a data partnership <span class="hint">(optional)</span></label>
  <label class="chk"><input type="checkbox" name="consent" value="yes" required> I agree to be contacted about this request</label>
  <div class="hp" aria-hidden="true"><label>Leave this empty<input type="text" name="${HONEYPOT}" tabindex="-1" autocomplete="off"></label></div>
  <p id="msg" role="alert" hidden></p>
  <button id="send" type="submit">Send</button>
</form>
<div id="done" class="done" hidden>
  <h2>Thanks, we have it</h2>
  <p>Check your email for your key. It arrives as a one-use link, so open it soon. Then connect:</p>
  <ol>
    <li>Open the email and reveal your key.</li>
    <li>Add DC Hub to your AI client with the steps at <a href="${SITE}/connect">dchub.cloud/connect</a>. The server address is <code>${SITE}/mcp</code>.</li>
    <li>Ask your client one of the prompts you sent us.</li>
  </ol>
  <p>If something you asked for does not work, reply to the email. We read every one.</p>
</div>
<p class="foot">Looking for a directory listing instead? <a href="${SITE}/mcp/directories">Find DC Hub in your MCP directory</a>.</p>
</main>
<script>${PARTNER_SCRIPT}</script>
</body>
</html>
`;
}
