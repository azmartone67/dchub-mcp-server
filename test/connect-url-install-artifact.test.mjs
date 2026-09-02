// r-connect-url (2026-08-18) — the install artifact is the URL, not the key.
//
// THE GAP THIS PINS. On every bring-your-own-MCP surface (Grok connectors,
// Claude.ai web, ChatGPT, Perplexity) the human pastes a connector URL once and
// the client then runs MCP server-side, minting a FRESH SESSION PER TOOL CALL.
// A key returned inside a tool result therefore lives in a context that is gone
// by the next call, and the agent cannot rewrite its own connector config
// mid-conversation. Measured on platform='connectors-manager' (Grok): three
// claim_free_key calls all issued a real key; two of those keys made exactly ONE
// call ever — the claim itself — and 95 of 98 calls on the channel are anonymous.
//
// The fix is not new auth. Key-in-URL was already live (?apiKey= / ?api_key= /
// ?key= on POST /mcp, precedence header > Bearer > query > inline); nothing told
// anyone to install that way. These tests pin the artifact so a copy edit cannot
// quietly take it back out and leave the whole client class unreachable again.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { _connectUrl, _connectRelay, _BYO_MCP_PLATFORMS, _claimVia, _VIA_TRANSPORT_TAGS } from '../server.mjs';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs'), 'utf8');

const KEY = 'dch_live_0123456789abcdef0123456789abcdef';

describe('connect_url — the paste-ready install artifact', () => {
  it('embeds the key in a query param the live gateway actually reads', () => {
    const u = new URL(_connectUrl(KEY));
    expect(u.origin + u.pathname).toBe('https://dchub.cloud/mcp');
    // ★ MUST be one of the three names POST /mcp reads off the query string.
    // Any other name and the URL is a decoration that authenticates nobody.
    expect(['apiKey', 'api_key', 'key']).toContain([...u.searchParams.keys()][0]);
    expect(u.searchParams.get('apiKey')).toBe(KEY);
  });

  it('the param name is still one the request path parses', () => {
    // Source pin on the reader, so renaming it there fails HERE rather than in
    // production silence. This is the line that makes the URL work at all.
    expect(SRC).toContain("_sp.get('apiKey') || _sp.get('api_key') || _sp.get('key')");
    const name = [...new URL(_connectUrl(KEY)).searchParams.keys()][0];
    expect(SRC).toContain(`_sp.get('${name}')`);
  });

  it('carries via when the platform is known and omits it when it is not', () => {
    expect(_connectUrl(KEY, 'grok')).toContain('&via=grok');
    expect(_connectUrl(KEY, '')).not.toContain('via=');
    expect(_connectUrl(KEY, undefined)).not.toContain('via=');
  });

  it('url-encodes both values (a key or tag with & would truncate the URL)', () => {
    expect(_connectUrl('a&b=c', 'x y')).toBe(
      'https://dchub.cloud/mcp?apiKey=a%26b%3Dc&via=x%20y');
  });
});

describe('_claimVia — never mints an attribution tag from an absence', () => {
  // No ctx store in tests, so getCtx() is {} — the honest no-platform case.
  it('an absent platform yields no via tag', () => {
    expect(_claimVia()).toBe('');
  });

  it('the generic/self-tag exclusions are the ones detectPlatformFromInit uses', () => {
    // 'mcp' is detectPlatform's OWN default sentinel for "the UA named nothing",
    // 'mcp-generic-client' is the explicit absence bucket, and anything carrying
    // 'dchub' is our own harness. None of those may become a via= tag, or our
    // own probes would show up as an install channel — the 88e20dac class.
    for (const bad of ['mcp', 'mcp-generic-client', 'dchub-internal', 'dchub-selfheal']) {
      expect(_BYO_MCP_PLATFORMS.has(bad)).toBe(false);
    }
    expect(SRC).toContain('_VIA_TRANSPORT_TAGS.has(p)');
    expect(SRC).toContain("p.includes('dchub')");
  });

  // ★★★ r-gateway-identity (2026-08-26): the class this set exists for was
  // missing the platform that IS the traffic. Measured that day:
  // distinct_platforms = 1 and it is Smithery; Smithery is 50% of paywall hits
  // (348/7d, largest external segment) at 0% conversion; its listing is an
  // `external_shttp` proxy whose live page payload carries `configSchema: {}`,
  // so no user can supply a key at install and every install is anonymous by
  // construction. That is the re-mint loop (~22 re-mints/agent, 36% of keys
  // never call) this whole branch exists to break — and it never fired for them.
  it('every hosted-gateway / URL-box platform is in the BYO class', () => {
    for (const p of ['smithery', 'chatgpt', 'grok', 'perplexity', 'connectors-manager']) {
      expect(_BYO_MCP_PLATFORMS.has(p), `${p} must get the connector-URL lead`).toBe(true);
    }
  });

  it('the agent-facing copy names the gateway class it now covers', () => {
    // A platform in the set but absent from the prose gets the branch and no
    // instruction — the copy and the set have to move together.
    // BOTH copy sites, counted — the phrase appears in the claim response's
    // save-line AND in the tool description an agent reads before calling.
    // Asserting mere presence let a mutation strip one of the two and still
    // pass (caught by mutation, 2026-08-26).
    const sites = SRC.split('Perplexity, Smithery — a URL box, no header field').length - 1;
    expect(sites, 'both the save-line and the tool description must name it').toBe(2);
    expect(SRC).toMatch(/Smithery[^.]*runs behind their proxy/);
  });

  // r-via-transport (2026-08-19): observed live — a curl probe minted via=curl.
  it('a bare HTTP client name is a TRANSPORT, not an install channel', () => {
    // "which install channel sent this agent" must never answer "curl".
    // Assert the SET, not a substring of the file — 'curl' appears in unrelated
    // copy elsewhere in server.mjs, so a toContain pin here is vacuous and
    // survives deleting the tag (verified: it did).
    for (const t of ['curl', 'node', 'python-requests', 'wget', 'unknown']) {
      expect(_VIA_TRANSPORT_TAGS.has(t)).toBe(true);
      expect(_BYO_MCP_PLATFORMS.has(t)).toBe(false);
    }
  });
});

describe('for_your_human — the relay carries the URL, not the bare key', () => {
  const relay = _connectRelay(KEY, 'grok');

  it('uses the same verbatim-render contract as the paywall relay', () => {
    expect(relay.render).toBe('verbatim_link_required');
    expect(relay.url).toBe(_connectUrl(KEY, 'grok'));
    expect(relay.markdown).toContain(_connectUrl(KEY, 'grok'));
  });

  it('tells the human to PASTE, never to click (GET /mcp is not a page)', () => {
    expect(relay.message.toLowerCase()).toContain('paste');
    expect(relay.message.toLowerCase()).toContain('do not click');
  });

  it('the markdown is a code span, not a clickable link', () => {
    // A markdown link would send a curious human to an API endpoint and render
    // the copy-paste useless on clients that strip the href.
    expect(relay.markdown).toContain('`' + relay.url + '`');
    expect(relay.markdown).not.toContain('](' + relay.url + ')');
  });
});

describe('claim_free_key wiring — every keyed branch ships the artifact', () => {
  it('all three response branches pass via into persist_config', () => {
    // _persistConfig(key) with no via would silently drop attribution from the
    // minted URL while still looking correct.
    expect(SRC).not.toMatch(/_persistConfig\((?:_held|key)\)/);
    expect((SRC.match(/_persistConfig\((?:_held|key), _via\)/g) || []).length).toBe(3);
  });

  // r-validate-artifact (2026-08-19)
  it('the idempotent branch validates the held key before issuing an install URL', () => {
    // Pre-existing: the branch echoed whatever key was presented. Harmless as
    // prose; NOT harmless once a permanent connector URL is built from it.
    expect(SRC).toContain('_heldOk = !!(await validateKey(_held)).valid');
    expect(SRC).toContain('key_confirmed:  _heldOk');
    expect(SRC).toContain('connect_url_withheld');
  });

  it('an unconfirmed key must NOT get connect_url or for_your_human', () => {
    // The emission has to be inside the _heldOk branch, not unconditional.
    const idx = SRC.indexOf('...(_heldOk ? {');
    expect(idx).toBeGreaterThan(-1);
    const block = SRC.slice(idx, idx + 400);
    expect(block).toContain('connect_url:    _connectUrl(_held, _via)');
    expect(block).toContain('for_your_human: _connectRelay(_held, _via)');
  });

  it('does NOT fall through to a mint on !valid (backend flap would re-mint)', () => {
    // validateKey returns valid:false for a transient backend failure too, so
    // minting on it would re-mint a real holder's identity on every blip.
    expect(SRC).toContain('We deliberately do NOT fall through to a mint on !valid');
    expect(SRC).toContain('_CONNECT_URL_NOTES');
  });

  it('the three key-issuing branches emit for_your_human with the connect URL', () => {
    // The bind-gate branch deliberately does NOT (its human ask is an email,
    // and a second human CTA is the r-cta-collapse failure mode) — so exactly
    // three (presented key, held-by-fingerprint key — r-held-key 2026-09-02 —
    // and fresh mint), and the gate branch must still carry connect_url
    // machine-readably.
    expect((SRC.match(/for_your_human:\s+_connectRelay\(/g) || []).length).toBe(3);
    expect(SRC).toContain('connect_url:             _connectUrl(key, _via)');
  });

  it('the BYO-MCP lead replaced the email-bind lead for that whole class', () => {
    // Binding makes a key RECOVERABLE; it does not make it PRESENT on the next
    // call, which is the only thing that matters on a per-call-session client.
    expect(SRC).toContain('const _headerlessLead = (_isByo && CLAIM_CAROT_COPY)');
    expect(SRC).toContain('const _bindDefault    = _bindDefaultOn && !a.email && !_isByo');
  });

  it('the tool description names connect_url in its Returns contract', () => {
    // The description is what a model reads BEFORE calling. If connect_url is
    // not named there, an agent has no reason to look for it in the response.
    expect(SRC).toContain('Returns {api_key, connect_url, for_your_human, header, daily_limit, upgrade_url}.');
  });

  it('claude is NOT in the BYO lead set (the tag collapses two client classes)', () => {
    // detectPlatformFromInit maps Claude.ai web (BYO-MCP) and Claude Code /
    // Desktop (header-capable) to the same 'claude' tag. Leading with the URL
    // there would mis-advise the header-capable majority.
    expect(_BYO_MCP_PLATFORMS.has('claude')).toBe(false);
    expect(_BYO_MCP_PLATFORMS.has('connectors-manager')).toBe(true);
    expect(_BYO_MCP_PLATFORMS.has('chatgpt')).toBe(true);
  });
});
