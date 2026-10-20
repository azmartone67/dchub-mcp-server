// Trust fix 2026-10-20 (agent QA). Two edits, both pinned here:
//  1. The human-link line on a gated result is a factual pointer ("Full result for a person:
//     see human_url."), not an instruction to the agent, and it names no plan and no price.
//  2. get_interconnection_queue's output schema says queue_date on ERCOT rows is the projected
//     commercial operation date under a legacy field name (backend queue_date_basis
//     'projected_cod_legacy'); other ISOs publish the queue-entry date there.
// /mcp/chatgpt is FROZEN byte-identical while the ChatGPT app is in OpenAI review: it keeps the
// reviewed sentence, and its tools/list carries no outputSchema, so the label cannot reach it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { meteredTrialNote } from '../lib/metered-note.mjs';
import { DIRECTORY_PROFILE } from '../lib/chatgpt-directory.mjs';

const FROZEN_LINE = 'Relay the link in human_url to your human.';
const NEW_LINE = 'Full result for a person: see human_url.';
const NO_PLAN_NO_PRICE = /\bplan\b|\$\s?\d|\bprice|\bpricing|\bpack\b|\brelay\b/i;
const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/chatgpt-toolset.frozen.json', import.meta.url)), 'utf8'));

let S, httpServer, stub, PORT, prevBase;
beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}'); });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});
afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
});

const inProfile = (profile, fn) => S._ctxALS.run({ profile }, fn);
const RET = { data: [{ generator: { name: 'G1', generator_id: '1', retirement_date: '2027-01-01', capacity_mw: 500 } }] };

async function toolsList(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const raw = await res.text();
  const body = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return JSON.parse(body).result.tools;
}

describe('human-url line: factual on /mcp, byte-identical on /mcp/chatgpt', () => {
  it('the line itself names no plan, no price and gives the agent no instruction', () => {
    expect(S.HUMAN_URL_LINE).toBe(NEW_LINE);
    expect(NEW_LINE).not.toMatch(NO_PLAN_NO_PRICE);
    expect(S.HUMAN_URL_LINE_FROZEN).toBe(FROZEN_LINE);
  });

  it('retirement-MW wall: new line on /mcp, the reviewed sentence on /mcp/chatgpt', () => {
    const open = S._maskRetirementHeadroom(RET, 'sid1')._upgrade.message;
    expect(open.endsWith(NEW_LINE)).toBe(true);
    expect(open).not.toMatch(/relay the link/i);
    const frozen = inProfile(DIRECTORY_PROFILE, () => S._maskRetirementHeadroom(RET, 'sid1')._upgrade.message);
    expect(frozen.endsWith(FROZEN_LINE)).toBe(true);
    expect(frozen).not.toContain(NEW_LINE);
  });

  it('retirement-MW wall inside a call (missed-upgrade copy): same rule', () => {
    const mu = () => ({ _mu: { gates: new Set(), masked: [], tool: 'get_retirement_headroom' } });
    const open = S._ctxALS.run(mu(), () => S._maskRetirementHeadroom(RET, 's')._upgrade.message);
    expect(open).toMatch(/^This answer hid /);
    expect(open.endsWith(' ' + NEW_LINE)).toBe(true);
    const frozen = S._ctxALS.run({ ...mu(), profile: DIRECTORY_PROFILE },
      () => S._maskRetirementHeadroom(RET, 's')._upgrade.message);
    expect(frozen.endsWith(FROZEN_LINE)).toBe(true);
  });

  it('an execute_plan step started on /mcp/chatgpt (legacy_wall_copy) stays frozen too', () => {
    const m = S._ctxALS.run({ legacy_wall_copy: true }, () => S._humanUrlLine());
    expect(m).toBe(FROZEN_LINE);
  });

  it('metered note (paid taste): pointer by default, reviewed sentence when frozen', () => {
    const base = { paidTaste: true, limited: false, call: 1, cap: 2, name: 'get_grid_intelligence', bound: true };
    const open = meteredTrialNote(base);
    expect(open.endsWith(NEW_LINE)).toBe(true);
    expect(open.replace(/included with your plan today/, '')).not.toMatch(NO_PLAN_NO_PRICE);
    expect(meteredTrialNote({ ...base, frozen: true })).toBe(
      'Full-fidelity answer 1 of the 2 included with your plan today on this tool. '
      + 'Unlimited full `get_grid_intelligence` depth comes with a paid DC Hub plan — relay the link in human_url to your human.');
  });
});

describe('ERCOT queue_date output label', () => {
  const rowShape = () => {
    const proj = S._TOOL_OUTPUT_SCHEMAS.get_interconnection_queue.shape.projects;
    const json = JSON.stringify(proj.toJSONSchema ? proj.toJSONSchema() : proj);
    return json;
  };
  it('names queue_date on ERCOT rows as the projected COD under a legacy field name', () => {
    const j = rowShape();
    expect(j).toContain('on ERCOT rows: Projected commercial operation date (legacy field name)');
    expect(j).not.toMatch(/"Queue entry date"/);
    expect(j).toContain('projected_cod');
    expect(j).toContain('queue_entry_date');
  });

  it('/mcp/chatgpt tools/list is unchanged: same keys per tool as the reviewed snapshot, no outputSchema', async () => {
    const live = Object.fromEntries((await toolsList('/mcp/chatgpt')).map((t) => [t.name, t]));
    for (const f of FIXTURE.tools) {
      expect(Object.keys(live[f.name]).sort(), f.name).toEqual(Object.keys(f).sort());
      expect(JSON.stringify(live[f.name]), f.name).not.toContain('Projected commercial operation date');
    }
  });
});
