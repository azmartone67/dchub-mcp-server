// ── summarize_for_citation — assembling the citation, and the LICENCE ────────
//
// Meta asked for the assembly (2026-08-30): "Pieces now in place [cite_as,
// license, as_of, completeness, profile_url] but not assembled."
//
// ★ THE LICENCE HALF IS THE ONE THAT MATTERS, and it is what these tests are
// mostly about. Assembly is a convenience — every piece already rides on every
// response. What an agent gets WRONG, and what #261 had to retire from our own
// registry manifest on 2026-08-29, is a flat "CC-BY-4.0" over the whole
// service. Parts of the facility inventory are OpenStreetMap (ODbL 1.0,
// share-alike) and ODbL forbids re-licensing derived data as CC-BY. DCPI
// scores and DC Hub's own grid analysis ARE ours to grant. Nothing else is.
//
// A tool that formats a citation and gets the licence wrong is worse than no
// tool: it launders the over-claim into a human's document, at scale, with our
// name on it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { _citationBlock, _CITE_LAYERS, _CITE_GRANTED_LAYERS } from '../server.mjs';

const CC = /CC-BY-4\.0/;

describe('summarize_for_citation — the licence is per layer', () => {
  it('grants CC-BY only on the layers that are DC Hub derived work', () => {
    for (const layer of _CITE_GRANTED_LAYERS) {
      const b = _citationBlock({ subject: 'x', layer });
      expect(b.license, layer).toMatch(CC);
      expect(b.license_basis, layer).toBe('granted_layer');
      expect(b.license_url, layer).toContain('creativecommons.org');
    }
    expect(_CITE_GRANTED_LAYERS).toEqual(['dcpi', 'grid_analysis']);
  });

  it('NEVER grants CC-BY on a composite layer — the retired over-claim', () => {
    const composites = _CITE_LAYERS.filter((l) => !_CITE_GRANTED_LAYERS.includes(l));
    expect(composites.length).toBeGreaterThan(2);
    for (const layer of composites) {
      const b = _citationBlock({ subject: 'Equinix DC1 capacity', layer });
      expect(b.license, `${layer} granted CC-BY`).not.toMatch(CC);
      expect(b.citation_text, `${layer} granted CC-BY in the TEXT`).not.toMatch(CC);
      expect(b.license, layer).toMatch(/data-sources/);
      expect(b.license, layer).toMatch(/OpenStreetMap|ODbL/);
    }
  });

  it('an ABSENT or UNKNOWN layer falls through to composite, never to a grant', () => {
    // The dangerous default. A tool that grants when it does not know what it
    // is citing is the over-claim with extra steps.
    for (const arg of [{}, { layer: '' }, { layer: 'made_up_layer' }, { layer: 'DCPI ' }]) {
      const b = _citationBlock({ subject: 'x', ...arg });
      if (b.license_basis === 'granted_layer') continue;   // 'DCPI ' normalises, fine
      expect(b.license, JSON.stringify(arg)).not.toMatch(CC);
      expect(b.license_basis, JSON.stringify(arg)).toBe('composite_or_unspecified_layer');
    }
    // and an unrecognised layer is NAMED, not silently swallowed
    const named = _citationBlock({ subject: 'x', layer: 'made_up_layer' });
    expect(named.omitted.map((o) => o.field)).toContain('layer');
  });
});

describe('summarize_for_citation — it never claims a date it was not given', () => {
  it('with as_of, the line states when the DATA was true', () => {
    const b = _citationBlock({ subject: 'Ashburn DCPI verdict', as_of: '2026-08-28', layer: 'dcpi' });
    expect(b.as_of_basis).toBe('caller_supplied');
    expect(b.citation_text).toContain('as of 2026-08-28');
    expect(b.to_improve).toBeUndefined();
  });

  it('without as_of, it says RETRIEVED and does not imply a data date', () => {
    // Stamping today as the data's as_of is the exact lie this tool exists to
    // prevent — the figure may have been built days earlier.
    const b = _citationBlock({ subject: 'Ashburn DCPI verdict', layer: 'dcpi' });
    expect(b.as_of).toBeNull();
    expect(b.as_of_basis).toBe('not_supplied');
    expect(b.citation_text).toMatch(/retrieved/i);
    expect(b.citation_text).not.toMatch(/\bas of\b/i);
    expect(b.to_improve).toMatch(/as_of/);
  });
});

describe('summarize_for_citation — it will not launder a foreign URL', () => {
  it('keeps a dchub.cloud URL', () => {
    const url = 'https://dchub.cloud/dcpi/ashburn';
    const b = _citationBlock({ subject: 'x', url, layer: 'dcpi' });
    expect(b.url).toBe(url);
    expect(b.citation_text).toContain(url);
    expect(b.omitted).toEqual([]);
  });

  it('DROPS and NAMES anything else — attribution is not a redirect service', () => {
    for (const url of ['https://evil.example/dchub.cloud', 'http://dchub.cloud.attacker.io/x',
                       'javascript:alert(1)', 'not-a-url', 'https://notdchub.cloud/x']) {
      const b = _citationBlock({ subject: 'x', url, layer: 'dcpi' });
      expect(b.url, url).toBeNull();
      expect(b.citation_text, url).not.toContain(url);
      expect(b.omitted.map((o) => o.field), url).toContain('url');
    }
  });
});

describe('summarize_for_citation — the assembled line', () => {
  it('carries the attribution Meta asked for, in one pasteable sentence', () => {
    const b = _citationBlock({
      subject: 'Ashburn DCPI verdict', as_of: '2026-08-28',
      url: 'https://dchub.cloud/dcpi/ashburn', completeness: 'full', layer: 'dcpi',
    });
    expect(b.citation_text).toContain('Ashburn DCPI verdict');
    expect(b.citation_text).toContain('DC Hub, dchub.cloud');
    expect(b.citation_text).toContain('2026-08-28');
    expect(b.citation_text).toContain('https://dchub.cloud/dcpi/ashburn');
    expect(b.citation_text).toContain('full');
    expect(b.citation_text).toMatch(CC);
    expect(b.cite_as).toBe('DC Hub, dchub.cloud');
  });

  it('degrades to something still quotable when given nothing at all', () => {
    const b = _citationBlock({});
    expect(b.citation_text).toContain('DC Hub, dchub.cloud');
    expect(b.citation_text).not.toMatch(CC);      // still no unearned grant
  });
});

// ★★★ THE WIRING, not the helper. A guard that only calls the exported function
// cannot prove the tool is reachable — Stage 0a shipped inert for eight days on
// exactly that mistake.
describe('summarize_for_citation is a real, reachable tool', () => {
  let S, PORT, httpServer;
  beforeAll(async () => {
    const prev = process.env.DCHUB_API_BASE;
    process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';
    S = await import('../server.mjs');
    if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
    await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
    PORT = httpServer.address().port;
  }, 60000);
  afterAll(async () => { await new Promise((r) => (httpServer ? httpServer.close(r) : r())); });

  const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const parse = (raw) => JSON.parse(raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw);

  it('is listed in tools/list with its arguments declared', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST', headers: H,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    const t = parse(await res.text()).result.tools.find((x) => x.name === 'summarize_for_citation');
    expect(t, 'the tool is not in tools/list').toBeTruthy();
    const props = Object.keys(t.inputSchema.properties || {});
    for (const a of ['subject', 'as_of', 'url', 'completeness', 'layer']) {
      expect(props, `undeclared argument ${a} — an agent can only find it by accident`).toContain(a);
    }
  }, 30000);

  it('answers a real tools/call with the composite licence on a facility figure', async () => {
    const url = `http://127.0.0.1:${PORT}/mcp`;
    const init = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18',
        capabilities: {}, clientInfo: { name: 'dchub-verify-probe', version: '1.0' } } }) });
    const sid = init.headers.get('mcp-session-id');
    const res = await fetch(url, { method: 'POST',
      headers: { ...H, ...(sid ? { 'mcp-session-id': sid } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'summarize_for_citation', arguments: {
          subject: 'Equinix DC1 disclosed capacity', layer: 'facility_inventory',
          as_of: '2026-08-28', url: 'https://dchub.cloud/facility/equinix-dc1' } } }) });
    const out = parse(await res.text()).result;
    const sc = out.structuredContent
      ?? JSON.parse(out.content.find((c) => c.type === 'text').text);
    expect(sc.citation_text).toContain('Equinix DC1 disclosed capacity');
    expect(sc.citation_text).toContain('as of 2026-08-28');
    // THE assertion: a facility figure does not ship with a CC-BY grant.
    expect(sc.citation_text, 'over-claimed CC-BY on a composite layer').not.toMatch(CC);
    expect(sc.license).toMatch(/data-sources/);
  }, 30000);
});
