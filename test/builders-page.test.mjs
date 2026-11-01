// /mcp/builders (owner 2026-10-20, ecosystem item 8): the upstream program page
// for gateway and aggregator builders, and the ?via= / X-DCHub-Via attribution
// that rides every request into /api/v1/mcp/track.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BUILDERS_PATH, BUILDERS_JSON_PATH, BUILDERS_CSP, VIA_HEADER,
  renderBuildersPage, buildersJson, normalizeVia, viaFromRequest, smitheryProxyVia, SMITHERY_PROXY_VIA, SUGGESTED_TOOLS,
  COMPOSE_KIT,
} from '../lib/builders-page.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const EMOJI = /[\p{Extended_Pictographic}️⃣]/u;
const PRICE = /\$\s?\d|\/mo\b|per month|\b(pro|developer|starter|enterprise) (plan|tier)\b/i;
const RULE = 'Anonymous: previews, no key needed. Free key: previews plus 2 full answers per tool per day.';

describe('renderBuildersPage', () => {
  const html = renderBuildersPage({ tools: 94, freeTier: RULE });

  it('covers composition, keyless previews, rate limits, attribution, citation and partner keys', () => {
    for (const must of ['https://dchub.cloud/mcp', '/mcp/core', 'openapi.json', 'human_message',
      'per source IP', 'partner key', '?via=', VIA_HEADER, 'DC Hub (dchub.cloud), as of &lt;date&gt;',
      'dedicated service address', 'partnerships@dchub.cloud', 'https://dchub.cloud/partners', '94 tools']) {
      expect(html, must).toContain(must);
    }
  });

  it('quotes the published free-tier rule it is given, verbatim, and nothing when there is none', () => {
    expect(html).toContain(RULE);
    expect(renderBuildersPage({ tools: 94 })).not.toContain('free-tier rule, verbatim');
  });

  it('names no plan or price, no facility count, and no emoji', () => {
    expect(html).not.toMatch(PRICE);
    expect(html).not.toMatch(/\d[\d,]*\+?\s+facilities/i);
    expect(html).not.toMatch(EMOJI);
  });

  it('suggests only real tool names', () => {
    const manifest = JSON.parse(readFileSync(new URL('../mcp-server.json', import.meta.url), 'utf8'));
    const names = new Set((manifest.tools || []).map((t) => t.name));
    expect(names.size).toBeGreaterThan(50);
    for (const [name] of SUGGESTED_TOOLS) expect(names.has(name), name).toBe(true);
  });

  it('links the published compose kit for both languages, at the versions in sdk/', () => {
    for (const must of ['npm i dchub', 'dchub/compose', 'registerDCHubTools', 'https://www.npmjs.com/package/dchub',
      'pip install &quot;dchub&gt;=0.3.0&quot;', 'dchub_tool_definitions', 'https://pypi.org/project/dchub/',
      'sdk/COMPOSE.md', '<h2>7. Building an MCP server? Compose DC Hub in code</h2>',
      // the call each snippet makes, not just the import line
      'await registerDCHubTools(server, { via: &quot;&lt;your-name&gt;&quot; });',
      'defs = dchub_tool_definitions(via=&quot;&lt;your-name&gt;&quot;)']) {
      expect(html, must).toContain(must);
    }
    expect(html, 'nothing on the page is commented out').not.toContain('<!--');
    const pkg = JSON.parse(readFileSync(new URL('../sdk/node/package.json', import.meta.url), 'utf8'));
    const pyproject = readFileSync(new URL('../sdk/python/pyproject.toml', import.meta.url), 'utf8');
    expect(pkg.name).toBe('dchub');
    expect(COMPOSE_KIT.node.version).toBe(pkg.version);
    expect(pyproject).toMatch(new RegExp(`^version = "${COMPOSE_KIT.python.version.replace(/\./g, '\\.')}"$`, 'm'));
    expect(html).toContain(`npm dchub ${pkg.version}`);
    expect(html).toContain(`PyPI dchub ${COMPOSE_KIT.python.version}`);
    // The names the snippets use are the ones the SDKs export.
    expect(readFileSync(new URL('../sdk/node/compose.mjs', import.meta.url), 'utf8')).toMatch(/export (async )?function registerDCHubTools\b/);
    expect(readFileSync(new URL('../sdk/python/dchub/compose.py', import.meta.url), 'utf8')).toMatch(/^def dchub_tool_definitions\(/m);
    const j = buildersJson({ tools: 94 });
    expect(j.compose_kit.node.version).toBe(pkg.version);
    expect(j.compose_kit.python.install).toBe(COMPOSE_KIT.python.install);
  });

  it('the JSON twin carries the same facts', () => {
    const j = buildersJson({ tools: 94, freeTier: RULE });
    expect(j.attribution.header).toBe(`${VIA_HEADER}: <your-name>`);
    expect(j.keyless.free_tier_rule).toBe(RULE);
    expect(j.tools).toBe(94);
    expect(JSON.stringify(j)).not.toMatch(PRICE);
  });
});

describe('server wiring', () => {
  it('serves both paths with a CSP that allows only the same-origin site nav script', () => {
    expect(SRC).toContain('app.get([BUILDERS_PATH, BUILDERS_PATH + \'/\']');
    expect(SRC).toContain('app.get(BUILDERS_JSON_PATH');
    expect(BUILDERS_PATH).toBe('/mcp/builders');
    expect(BUILDERS_JSON_PATH).toBe('/mcp/builders.json');
    expect(BUILDERS_CSP).toContain("default-src 'none'");
    const scriptSrc = BUILDERS_CSP.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toBe("script-src 'self' https://static.cloudflareinsights.com");
    expect(BUILDERS_CSP).not.toContain('unsafe-eval');
    expect(renderBuildersPage({ tools: 94 })).toContain('<script src="/js/dchub-nav.js" defer></script>');
  });

  it('the builders route is registered before the catch-all GET on MCP_PATHS', () => {
    const page = SRC.indexOf("app.get([BUILDERS_PATH, BUILDERS_PATH + '/']");
    const mcp = SRC.indexOf('app.get(MCP_PATHS, async');
    expect(page).toBeGreaterThan(0);
    expect(mcp).toBeGreaterThan(page);
  });

  it('every request runs inside the via store, and trackToolCall forwards it', () => {
    expect(SRC).toContain('app.use((req, res, next) => viaCtx.run(_viaFromRequest(req), next));');
    const track = SRC.slice(SRC.indexOf('async function trackToolCall(payload) {'));
    const body = track.slice(0, track.indexOf("fetch(new URL('/api/v1/mcp/track'"));
    expect(body).toContain('payload = { ...payload, via: v }');
  });

  it('CORS lets a browser client send X-DCHub-Via', () => {
    expect(SRC).toMatch(/Access-Control-Allow-Headers', '[^']*X-DCHub-Via/);
  });
});

describe('via attribution', () => {
  it.each([
    ['Pipeworx', 'pipeworx'], ['my-gateway_2.0', 'my-gateway_2.0'], [' arcade ', 'arcade'],
    [['composio', 'x'], 'composio'],
    ['', null], [null, null], [undefined, null], ['a'.repeat(41), null], ['x@y.com', null],
    ['https://evil', null], ['dchub', null], ['dchub-qa', null], ['test', null], ['-lead', null],
  ])('normalizeVia(%j) -> %j', (raw, want) => {
    expect(normalizeVia(raw)).toBe(want);
  });

  it('the header wins over the query; a bad header falls back to the query', () => {
    expect(viaFromRequest({ headers: { 'x-dchub-via': 'arcade' }, query: { via: 'pipeworx' } })).toBe('arcade');
    expect(viaFromRequest({ headers: { 'x-dchub-via': 'bad name' }, query: { via: 'pipeworx' } })).toBe('pipeworx');
    expect(viaFromRequest({ headers: {}, query: {} })).toBe(null);
    expect(viaFromRequest(undefined)).toBe(null);
  });

  it('tags Smithery proxy hosts smithery_proxy; a declared via still wins', () => {
    const r = (headers, query = {}) => viaFromRequest({ headers, query });
    expect(r({ 'x-forwarded-host': 'dchub--azmartone67.run.tools' })).toBe('smithery_proxy');
    expect(r({ 'x-forwarded-host': 'dchub.cloud, server.smithery.ai:443' })).toBe('smithery_proxy');
    expect(r({ host: 'run.tools' })).toBe('smithery_proxy');
    expect(r({ forwarded: 'for=1.2.3.4;host="dchub--azmartone67.run.tools";proto=https' })).toBe('smithery_proxy');
    expect(r({ 'x-original-host': 'SERVER.SMITHERY.AI.' })).toBe('smithery_proxy');
    expect(r({ 'x-forwarded-host': 'dchub.cloud' })).toBe(null);
    expect(r({ 'x-forwarded-host': 'notrun.tools' })).toBe(null);
    expect(r({ 'x-forwarded-host': 'run.tools.evil.com' })).toBe(null);
    expect(r({ referer: 'https://smithery.ai/servers/azmartone67/dchub' })).toBe(null);
    expect(r({ 'x-dchub-via': 'arcade', 'x-forwarded-host': 'x.run.tools' })).toBe('arcade');
    expect(r({ 'x-forwarded-host': 'x.run.tools' }, { via: 'pipeworx' })).toBe('pipeworx');
    expect(smitheryProxyVia(undefined)).toBe(null);
    expect(normalizeVia(SMITHERY_PROXY_VIA)).toBe('smithery_proxy');   // the backend keeps it
  });

  it('matches the backend rule (routes/via_attribution.py) character for character', () => {
    const lib = readFileSync(new URL('../lib/builders-page.mjs', import.meta.url), 'utf8');
    expect(lib).toContain("/^[a-z0-9][a-z0-9._-]{0,39}$/");
    expect(lib).toContain('/^(dchub|dc-hub|qa|test|probe|internal)([._-]|$)/');
  });
});
