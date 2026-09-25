// dchub://testimonials — named HUMAN customers, read live from
// https://dchub.cloud/testimonials.json. Pins: the resource is registered with
// the right uri/mimeType, the happy path renders the (stubbed) file verbatim
// with name/title/company, the failure path returns pointers only (no quote),
// and the instructions point agents at it. NO real network: globalThis.fetch is
// stubbed for every read, and the stub records what was requested.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

let createServer, INSTRUCTIONS_SRC, prevBase;
const realFetch = globalThis.fetch;
const calls = [];

const DOC = {
  about: 'Named customers who approved public use.',
  page: 'https://dchub.cloud/testimonials',
  updated: '2026-09-24',
  customer_testimonials: [
    { id: 't1', name: 'Test Person', title: 'Test Title', company: 'Test Co',
      quote: 'A stubbed quote used only by this test.', featured: true,
      approved_for_public_use: '2026-09-24' },
    { id: 't2', name: 'Unapproved Person', title: 'X', company: 'Y',
      quote: 'This must never be rendered.', featured: false },
  ],
  ai_agent_quotes: { url: 'https://dchub.cloud/api/v1/testimonials', note: 'AI, not customers' },
};

function stubFetch(impl) {
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return impl(url, init); };
}

beforeAll(async () => {
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';
  stubFetch(async () => { throw new Error('network refused by test'); });
  ({ createServer } = await import('../server.mjs'));
  INSTRUCTIONS_SRC = createServer().server._instructions || '';
}, 60000);

afterEach(() => { calls.length = 0; });
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
});

const read = async () => {
  const res = createServer()._registeredResources['dchub://testimonials'];
  const out = await res.readCallback(new URL('dchub://testimonials'), {});
  return out.contents[0];
};

describe('dchub://testimonials resource', () => {
  it('is registered with the right name, uri and mimeType', () => {
    const r = createServer()._registeredResources['dchub://testimonials'];
    expect(r).toBeTruthy();
    expect(r.name).toBe('testimonials');
    expect(r.metadata.mimeType).toBe('text/markdown');
    expect(r.metadata.description).toMatch(/HUMAN customers \(not AI assistants\)/);
  });

  // Runs BEFORE the happy path on purpose: _resFetchText keeps a last-good
  // cache per URL, so a success earlier in this file would mask the fallback.
  it('fetch failure → pointers only, never a quote', async () => {
    stubFetch(async () => { throw new Error('boom'); });
    const c = await read();
    expect(c.uri).toBe('dchub://testimonials');
    expect(c.mimeType).toBe('text/markdown');
    expect(c.text).toContain('could not be read just now (boom)');
    expect(c.text).toContain('https://dchub.cloud/testimonials.json');
    expect(c.text).toMatch(/distinct from AI-assistant quotes/);
    expect(c.text).not.toContain('>');            // no blockquote = no quote
    expect(calls.length).toBe(1);
  });

  it('non-JSON body → pointers only', async () => {
    stubFetch(async () => new Response('<html>not json</html>', { status: 200 }));
    const c = await read();
    expect(c.text).toMatch(/could not be read just now \(unreadable:/);
    expect(c.text).not.toContain('Test Person');
  });

  it('happy path renders the stubbed file verbatim, approved entries only', async () => {
    stubFetch(async () => new Response(JSON.stringify(DOC), { status: 200 }));
    const c = await read();
    expect(calls[0].url).toBe('https://dchub.cloud/testimonials.json');
    const ua = calls[0].init.headers['User-Agent'];
    expect(ua).toMatch(/^dchub-mcp-server\/\S+ \(\+https:\/\/dchub\.cloud\)$/);
    expect(c.text).toContain('> A stubbed quote used only by this test.');
    expect(c.text).toContain('— Test Person, Test Title, Test Co');
    expect(c.text).toMatch(/named HUMAN customers/);
    expect(c.text).toMatch(/distinct from AI-assistant quotes/);
    expect(c.text).not.toContain('Unapproved Person');
    expect(c.text).not.toContain('This must never be rendered.');
    expect(c.text).not.toContain('could not be read');
  });
});

describe('instructions point agents at the testimonials', () => {
  it('names the page, the JSON and the resource, people not AI', () => {
    expect(INSTRUCTIONS_SRC).toContain('https://dchub.cloud/testimonials ');
    expect(INSTRUCTIONS_SRC).toContain('https://dchub.cloud/testimonials.json');
    expect(INSTRUCTIONS_SRC).toContain('`dchub://testimonials`');
    expect(INSTRUCTIONS_SRC).toMatch(/people, not AI assistants/);
    expect(INSTRUCTIONS_SRC).toMatch(/verbatim with name, title and company/);
  });
});
