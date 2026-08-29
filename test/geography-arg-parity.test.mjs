// ── the geography argument an agent guesses must be the one the tool declares ─
//
// THE DEFECT (measured live 2026-08-29, free tier, server 2.12.0)
// `site_selection_canvas` declared `region` and NOTHING else, while its backend
// (dchub-backend routes/site_selection_canvas.py) has always resolved
// `region = _arg("region") or _arg("state") or _arg("iso")`. The MCP SDK's zod
// validation STRIPS undeclared arguments before the handler runs, so the two
// aliases the backend accepts could never reach it.
//
// Ohio, asked two ways, same tier, seconds apart:
//
//   {state:"OH",  capacity_mw:100} -> matched 104. Shortlist: TX MI ND KS WY MO
//                                     AZ AZ AZ AZ QC AZ. The paid synthesis
//                                     names Midland-Odessa, Texas, by name.
//   {region:"OH", capacity_mw:100} -> matched 0 + the CORRECT `empty_result`
//                                     ("9 tracked markets in region, all AVOID
//                                      — a real answer, not missing data").
//
// The first is the dangerous one: a confident, well-formed, completely
// wrong-geography answer. `request_interpretation` does name `state` in
// `unsupported_arguments` — that is how this was found — but the wrong answer
// ships in the SAME response, and an agent composing prose from the result
// publishes Texas as the answer to a question about Ohio.
//
// ★ WHY THE GUESS IS REASONABLE, AND WHY THIS TEST IS CROSS-TOOL.
// The suite disagreed with itself about the name of a US state:
//   get_power_availability_timeline  REQUIRES `state`
//   get_composite_site_score         declares `state`
//   site_selection_canvas            declared neither `state` nor `iso`
// An agent that learned `state` from one tool got it silently deleted by the
// next. Pinning only the canvas would leave the class open, so this asserts the
// parity rule: if a tool takes a US-state-shaped geography at all, `state` must
// be a name it answers to.
//
// ★ WHAT THIS TEST DELIBERATELY DOES NOT DO. It does not mark any of these
// required. `region`/`state`/`iso` are an ALIAS GROUP — JSON Schema `required`
// cannot express "one of these", and marking one arm breaks the others. See
// test/required-args.test.mjs for that fence.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let S, PORT, httpServer, TOOLS;

beforeAll(async () => {
  // server.mjs captures API_BASE once at module evaluation; point it at an
  // unroutable host so no test in this worker can reach the network, then
  // restore immediately so sibling live-network tests are unaffected.
  const prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';
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
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  TOOLS = ((JSON.parse(json).result) || {}).tools || [];
}, 60000);

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
});

const byName  = (n) => TOOLS.find((t) => t.name === n);
const propsOf = (n) => Object.keys(((byName(n) || {}).inputSchema || {}).properties || {});

// Tools whose backend resolves a US state, under whatever name. Each entry was
// established by reading the backend handler, not by guessing from the schema.
//   site_selection_canvas -> routes/site_selection_canvas.py
//                            region = _arg("region") or _arg("state") or _arg("iso")
const STATE_AWARE = ['site_selection_canvas', 'get_power_availability_timeline',
                     'get_composite_site_score'];

describe('geography argument parity', () => {
  it('every state-aware tool answers to the name `state`', () => {
    const missing = STATE_AWARE.filter((t) => byName(t) && !propsOf(t).includes('state'));
    expect(missing).toEqual([]);
  });

  it('site_selection_canvas declares the full alias group its backend accepts', () => {
    const p = propsOf('site_selection_canvas');
    // The backend reads all three off the query string; any one of them
    // undeclared is silently stripped before the handler ever runs.
    expect(p).toContain('region');
    expect(p).toContain('state');
    expect(p).toContain('iso');
  });

  it('the alias group stays OPTIONAL — required[] cannot express "one of these"', () => {
    const req = ((byName('site_selection_canvas') || {}).inputSchema || {}).required || [];
    for (const alias of ['region', 'state', 'iso']) expect(req).not.toContain(alias);
  });

  it('the aliases are documented as aliases, so a model does not send all three', () => {
    const props = (((byName('site_selection_canvas') || {}).inputSchema || {}).properties) || {};
    for (const alias of ['state', 'iso']) {
      expect(String(props[alias]?.description || '').toLowerCase()).toContain('alias');
    }
  });

  // The verdict default is what turns a correct scoring result into a bare
  // matched:0. The backend answers that with `empty_result`; the schema has to
  // tell the caller the escape hatch exists, or the next call is a guess.
  it('the verdict filter names its default and the ALL escape hatch', () => {
    const d = String(((((byName('site_selection_canvas') || {}).inputSchema || {})
      .properties) || {}).verdict?.description || '');
    expect(d).toMatch(/\bALL\b/);
    expect(d.toLowerCase()).toContain('empty_result');
  });
});
