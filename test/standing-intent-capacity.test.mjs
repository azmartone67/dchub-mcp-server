// ── register/list/delete_standing_intent: kind "capacity" (2026-09-28) ───────
//
// A capacity intent is a Capacity Source standing requirement. The backend
// (dchub-backend routes/agentic_master_shell.py) registers it in the listings
// lane and returns intent_id "cap_<lead_id>"; there is no webhook. Every
// response below is a FIXTURE in that route's shape; nothing reaches a network.
//
// What this pins:
//   1. The body: kind=capacity + params in the backend's names, comma strings
//      split into arrays, no webhook_url required, terms version forwarded.
//   2. The gate: no terms / no name / no requirement never reaches the backend
//      (counted on the stubbed network, next to a control that does reach it).
//   3. The next steps: confirmation email + at most one alert email a day.
//   4. Walls: the backend's 401 identity_required comes back with next_steps,
//      not as {error:"API 401"}.
//   5. Delete routes cap_ ids with walls intact; list annotates capacity rows;
//      the webhook kinds still require webhook_url and send what they did.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const BASE = 'http://127.0.0.1:1';
let S, TOOLS, realFetch;
let calls = [];
let responder = null;

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let pathname = '';
    try { pathname = new URL(url).pathname; } catch { /* not a URL */ }
    let body;
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    const rec = { url, pathname, method: String(init.method || 'GET').toUpperCase(), body };
    calls.push(rec);
    if (pathname.startsWith('/api/v1/agentic/intents') || pathname.startsWith('/api/v1/listings')) {
      if (!responder) throw new Error(`unexpected call: ${rec.method} ${url}`);
      return responder(rec);
    }
    return json(200, {});
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);

afterAll(() => { globalThis.fetch = realFetch; });
beforeEach(() => { calls = []; responder = null; });

const intentCalls = () => calls.filter((c) => c.pathname.startsWith('/api/v1/agentic/intents'));
const seat = { api_key: 'dch_live_intent_test', tier: 'free', platform: 'claude', session_id: 'sess-intent' };
async function call(name, args) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(seat, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const firstJson = (r) => JSON.parse(r.content[0].text);

const COMPLETE = {
  kind: 'capacity', target_mw: 12, markets: 'Dallas, Phoenix', states: 'TX, AZ',
  available_by: '2027-06', delivery_type: 'powered_shell', min_chunk_kw: 2000, max_sites: 2,
  use_case: 'AI inference', notes: 'Two halls ok.', name: 'Jane Doe', company: 'Acme Capital',
  accept_terms: true, terms_version: '2026-09-11',
};
const CREATED = {
  ok: true, intent_id: 'cap_LD-3PQ8ZT2BXA', kind: 'capacity', lane: 'capacity',
  requirement_id: 'LD-3PQ8ZT2BXA', lead_id: 'LD-3PQ8ZT2BXA', requirement_kind: 'standing_requirement',
  status: 'pending_email_confirmation', duplicate: false, email_masked: 'j***@acme.com',
  confirmation: { required: true, sent: true }, matching_listings: 1,
  citation: { source: 'DC Hub Capacity Source', url: 'https://dchub.cloud/listings',
              license: 'LicenseRef-DCHub-Capacity-Source-Confidential', redistribution: 'not_permitted' },
};
const E401 = {
  ok: false, error: 'identity_required', message: 'Sign in to request an introduction …',
  reason: 'email_binding_required',
  access: { required: 'registered', granted: false, reason: 'email_binding_required',
            unlock: { web_sign_in_url: 'https://dchub.cloud/login', mcp_steps: ['bind_email'], pricing_url: null } },
};

describe('register_standing_intent kind=capacity', () => {
  it('schema: kind is still the only required argument, and capacity args are declared', () => {
    const t = S.createServer()._registeredTools.register_standing_intent;
    const shape = t.inputSchema.shape || t.inputSchema._def.shape();
    for (const k of ['target_mw', 'target_kw', 'markets', 'states', 'regions', 'countries',
                     'available_by', 'delivery_type', 'min_chunk_kw', 'max_sites', 'use_case',
                     'notes', 'name', 'company', 'accept_terms', 'terms_version']) {
      expect(shape[k], k).toBeTruthy();
    }
    expect(shape.webhook_url.isOptional()).toBe(true);
    expect(shape.kind.isOptional()).toBe(false);
  });

  it('sends kind=capacity with the backend param names and no webhook', async () => {
    responder = () => json(200, CREATED);
    const r = await call('register_standing_intent', COMPLETE);
    const sent = intentCalls();
    expect(sent.length).toBe(1);
    expect(sent[0].method).toBe('POST');
    expect(sent[0].pathname).toBe('/api/v1/agentic/intents');
    expect(sent[0].body).toEqual({ kind: 'capacity', params: {
      target_mw: 12, min_chunk_kw: 2000, max_sites: 2,
      markets: ['Dallas', 'Phoenix'], states: ['TX', 'AZ'],
      available_by: '2027-06', delivery_type: 'powered_shell', use_case: 'AI inference',
      notes: 'Two halls ok.', name: 'Jane Doe', company: 'Acme Capital',
      accept_terms: true, terms_version: '2026-09-11' } });
    expect(sent[0].body.webhook_url).toBeUndefined();
    expect(r.isError).toBeFalsy();
    const out = firstJson(r);
    expect(out.intent_id).toBe('cap_LD-3PQ8ZT2BXA');
    expect(out.next_steps).toEqual(['list_standing_intents', 'delete_standing_intent']);
    expect(out.next_steps_note).toMatch(/confirmation link was emailed to j\*\*\*@acme\.com/);
    expect(out.next_steps_note).toMatch(/at most one email a day/);
    expect(out.next_steps_note).toContain('delete_standing_intent intent_id=cap_LD-3PQ8ZT2BXA');
  });

  it('a confirmed requirement does not ask for the email link', async () => {
    responder = () => json(200, { ...CREATED, status: 'registered' });
    const out = firstJson(await call('register_standing_intent', COMPLETE));
    expect(out.next_steps_note).not.toMatch(/confirmation link/);
    expect(out.next_steps_note).toMatch(/at most one email a day/);
  });

  it.each([
    ['no terms', { accept_terms: undefined }, 'terms_not_accepted', 'accept_terms'],
    ['no name', { name: undefined }, 'invalid_request', 'name'],
    ['no company', { company: '  ' }, 'invalid_request', 'company'],
    ['no size or place', { target_mw: undefined, markets: undefined, states: undefined },
     'invalid_request', 'target_mw|target_kw|markets|states|regions|countries'],
  ])('%s never reaches the backend', async (_label, over, code, missing) => {
    responder = () => json(200, CREATED);
    const args = { ...COMPLETE, ...over };
    for (const k of Object.keys(args)) if (args[k] === undefined) delete args[k];
    const r = await call('register_standing_intent', args);
    expect(intentCalls().length).toBe(0);
    const out = firstJson(r);
    expect(out.sent).toBe(false);
    expect(out.error).toBe(code);
    expect(out.missing).toContain(missing);
    expect(r.isError).toBe(false);
  });

  it('the backend 401 comes back as a wall with next_steps, not an API error string', async () => {
    responder = () => json(401, E401);
    const r = await call('register_standing_intent', COMPLETE);
    expect(intentCalls().length).toBe(1);
    const out = firstJson(r);
    expect(out.error).toBe('identity_required');
    expect(out.http_status).toBe(401);
    expect(out.next_steps).toEqual(['bind_email', 'register_standing_intent']);
    expect(r.isError).toBe(false);
  });

  it('omitting terms_version sends the currently published one', async () => {
    responder = (rec) => (rec.pathname === '/api/v1/listings/terms'
      ? json(200, { ok: true, terms: { version: '2026-09-20' } }) : json(200, CREATED));
    const args = { ...COMPLETE };
    delete args.terms_version;
    await call('register_standing_intent', args);
    expect(intentCalls()[0].body.params.terms_version).toBe('2026-09-20');
  });
});

describe('the webhook kinds are unchanged', () => {
  it('still refuse without webhook_url, before any network', async () => {
    responder = () => json(201, { ok: true, intent_id: 'abc', secret: 's' });
    const r = await call('register_standing_intent', { kind: 'news_keyword', q: 'moratorium' });
    expect(intentCalls().length).toBe(0);
    expect(firstJson(r).error).toBe('missing_required_argument');
    expect(r.isError).toBe(true);
  });

  it('send exactly kind + params + webhook_url', async () => {
    responder = () => json(201, { ok: true, intent_id: 'abc', secret: 's' });
    await call('register_standing_intent', { kind: 'news_keyword', q: 'moratorium',
      webhook_url: 'https://hooks.example.com/d', target_mw: 5, name: 'ignored' });
    expect(intentCalls()[0].body).toEqual({ kind: 'news_keyword', params: { q: 'moratorium' },
      webhook_url: 'https://hooks.example.com/d' });
  });
});

describe('list and delete', () => {
  it('list annotates capacity rows and only then', async () => {
    responder = () => json(200, { ok: true, intents: [
      { intent_id: 'aa11', kind: 'news_keyword' },
      { intent_id: 'cap_LD-3PQ8ZT2BXA', kind: 'capacity', status: 'active' }] });
    const out = firstJson(await call('list_standing_intents', {}));
    expect(out.intents.length).toBe(2);
    expect(out.capacity_note).toMatch(/at most one email a day/);
    responder = () => json(200, { ok: true, intents: [{ intent_id: 'aa11', kind: 'news_keyword' }] });
    expect(firstJson(await call('list_standing_intents', {})).capacity_note).toBeUndefined();
  });

  it('delete routes a cap_ id and keeps the 404 as a readable error', async () => {
    responder = (rec) => json(rec.pathname.endsWith('cap_LD-3PQ8ZT2BXA') ? 200 : 404,
      rec.pathname.endsWith('cap_LD-3PQ8ZT2BXA')
        ? { ok: true, deleted: 'cap_LD-3PQ8ZT2BXA', kind: 'capacity' }
        : { ok: false, error: 'not_found', message: 'No such requirement.' });
    const ok = await call('delete_standing_intent', { intent_id: 'cap_LD-3PQ8ZT2BXA' });
    expect(intentCalls()[0]).toMatchObject({ method: 'DELETE',
      pathname: '/api/v1/agentic/intents/cap_LD-3PQ8ZT2BXA' });
    expect(firstJson(ok).deleted).toBe('cap_LD-3PQ8ZT2BXA');
    const miss = await call('delete_standing_intent', { intent_id: 'cap_LD-0000000000' });
    expect(miss.isError).toBe(true);
    expect(firstJson(miss).error).toBe('not_found');
  });

  it('delete of a cap_ id without a bound email is a wall with next_steps', async () => {
    responder = () => json(401, E401);
    const out = firstJson(await call('delete_standing_intent', { intent_id: 'cap_LD-3PQ8ZT2BXA' }));
    expect(out.next_steps).toEqual(['bind_email', 'delete_standing_intent']);
  });

  it('isCapacityIntentId only matches the cap_ prefix', () => {
    expect(S.isCapacityIntentId('cap_LD-1')).toBe(true);
    expect(S.isCapacityIntentId(' CAP_LD-1')).toBe(true);
    expect(S.isCapacityIntentId('a1b2c3')).toBe(false);
    expect(S.isCapacityIntentId('capacity')).toBe(false);
  });
});
