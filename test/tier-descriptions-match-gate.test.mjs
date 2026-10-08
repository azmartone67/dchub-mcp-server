// A3 tier-gating (owner 2026-10-03): a tool description may not promise a
// keyless caller data the gate does not serve.
//
// compare_sites said "keyless gets at most each site's band" while the Land &
// Power gate (_lpAccessFor) answers a keyless caller with the wall: no
// verdict, band, name or figure. The description is read from the
// served tools/list (not grepped), and the keyless state from the gate itself,
// so if compare_sites ever opens a keyless headline this test goes red and
// must be flipped together with the copy.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';

let S, PORT, httpServer, stub, TOOLS;

beforeAll(async () => {
  stub = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  TOOLS = (JSON.parse(json).result || {}).tools || [];
}, 60000);

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
});

const descOf = (n) => (TOOLS.find((t) => t.name === n) || {}).description || '';
// A sentence that hands a keyless caller something: "keyless gets/returns ...
// verdict/band/weakest/score", but not "keyless returns no site data".
const KEYLESS_CLAIM = /keyless (?:gets|returns|receives)(?! no )[^.;]*\b(verdict|band|weakest|score|factor)/i;

describe('Land & Power descriptions match the keyless wall', () => {
  it('serves the full catalog (non-vacuous)', () => {
    expect(TOOLS.length).toBe(94);
  });

  // analyze_site left this list when B2 (#707) opened its keyless headline;
  // test/b2-analyze-site-keyless-headline.test.mjs owns its copy now. D6
  // (owner 17:05Z): compare_sites keeps the keyless wall.
  for (const name of ['compare_sites']) {
    it(`${name}: no keyless data claim while keyless is walled`, async () => {
      expect(S.LP_TOOLS.has(name)).toBe(true);
      const keyless = await S._lpAccessFor({}, 'anonymous');
      const d = descOf(name);
      expect(d.length, `${name} missing from tools/list`).toBeGreaterThan(50);
      if (keyless === 'wall') {
        // compare_sites stays walled (D6 remainder, owner 17:05Z: no keyless
        // headline). If it ever opens one, the else branch makes the copy move too.
        expect(d, `${name} promises keyless data the wall withholds`).not.toMatch(KEYLESS_CLAIM);
        expect(d).toContain('Keyless returns no site data');
      } else {
        expect(d).not.toContain('Keyless returns no site data');
      }
      expect(d).toMatch(/scores and figures are Pro/);
    });
  }

  it('the claim pattern catches the old copy (must-fail control)', () => {
    expect('Scores need Pro: a free key gets verdict bands and factor names, keyless at most the verdict band and weakest factor.')
      .not.toMatch(/Keyless returns no site data/);
    expect("keyless gets at most each site's band.").toMatch(KEYLESS_CLAIM);
    expect('Keyless returns no site data; a free key returns verdict bands').not.toMatch(KEYLESS_CLAIM);
  });
});

describe('approved wording (spec A3)', () => {
  it('get_grid_intelligence states the free-key and keyless split', () => {
    expect(descOf('get_grid_intelligence'))
      .toContain('With a free key, a few full briefs a day; keyless gets a trimmed preview.');
  });
  it('get_market_dcpi_rank: verdict and composite free, sub-scores and narrative paid', () => {
    expect(descOf('get_market_dcpi_rank')).toContain(
      'Verdict and composite score are free; numeric sub-scores and the narrative are on paid plans or a credit pack.');
  });
  it('no new copy carries a price or an em dash', () => {
    for (const n of ['compare_sites', 'get_grid_intelligence', 'get_market_dcpi_rank']) {
      const d = descOf(n);
      for (const s of ['Keyless returns no site data', 'With a free key, a few full briefs', 'Verdict and composite score are free']) {
        const i = d.indexOf(s);
        if (i < 0) continue;
        const sent = d.slice(i, d.indexOf('.', i) + 1);
        expect(sent).not.toMatch(/\$\s?\d|—/);
      }
    }
  });
});
