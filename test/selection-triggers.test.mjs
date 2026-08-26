// selection-triggers.test.mjs — (2026-08-26)
//
// dchub-backend shell #64, lane E/schema_selection_asks, measured live:
//
//   2 of 82 tools carry a selection trigger while 26 carry a call example —
//   24 tools show an agent HOW to call them but never WHEN to pick them.
//
// That lane is READ-ONLY ("Lane C's actuator is named and deliberately not
// fired") and it names its actuator as "tool description strings in
// dchub-mcp-server". This file is that actuator, plus the guard that keeps it
// closed.
//
// ★ THE INVARIANT IS THE SHELL'S, NOT A QUOTA. From
// routes/relay_closure_master_shell.verdict_trigger_phrases:
//
//   "The floor is an INVARIANT, not a target number: a tool curated enough to
//    carry a call example should be curated enough to say when to pick it.
//    That moves with the repo and cannot rot into a stale quota."
//
// So this asserts trigger >= example rather than a hardcoded 27. A new tool
// that ships `Try:` without `Answers "` fails here, which is the whole point —
// fixing 25 descriptions once would rot in a fortnight.
//
// ★★ The markers are the SHELL'S literals. If either side edits them the two
// measurements diverge silently and the lane starts grading a rule nobody
// implements, so they are pinned here with that warning attached.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const TRIGGER_MARKER = 'Answers "';   // == routes/relay_closure_master_shell.TRIGGER_MARKER
const EXAMPLE_MARKER = 'Try: ';       // == routes/relay_closure_master_shell.EXAMPLE_MARKER

let S, PORT, httpServer, TOOLS;

beforeAll(async () => {
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';   // tools/list is built locally; keep this offline
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prev;
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
  TOOLS = (JSON.parse(json).result || {}).tools || [];
});

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
});

const has = (t, m) => (t.description || '').includes(m);

describe('lane E — every tool that says HOW also says WHEN', () => {
  it('tools/list is readable and non-empty — a failed probe is not a zero', () => {
    expect(TOOLS.length).toBeGreaterThan(50);
  });

  it('★ selection triggers >= call examples (the shell\'s invariant, not a quota)', () => {
    const trig = TOOLS.filter((t) => has(t, TRIGGER_MARKER));
    const ex   = TOOLS.filter((t) => has(t, EXAMPLE_MARKER));
    const gap  = ex.filter((t) => !has(t, TRIGGER_MARKER)).map((t) => t.name).sort();
    expect(gap, `these tools show an agent HOW to call them but never WHEN to pick them: ${gap.join(', ')}`)
      .toEqual([]);
    expect(trig.length).toBeGreaterThanOrEqual(ex.length);
  });

  it('a trigger is a real question, not the marker alone', () => {
    for (const t of TOOLS.filter((x) => has(x, TRIGGER_MARKER))) {
      const after = (t.description || '').split(TRIGGER_MARKER)[1] || '';
      const q = after.split('"')[0];
      expect(q.trim().length, `${t.name}: empty selection trigger`).toBeGreaterThan(12);
      expect(q.includes(t.name),
        `${t.name}: the trigger restates the tool NAME — it must be the user's question, not ours`)
        .toBe(false);
    }
  });

  it('does not regress the call examples it is measured against', () => {
    // Deleting `Try:` lines would also satisfy trigger >= example. It would
    // satisfy the lane and destroy the thing the lane was protecting.
    expect(TOOLS.filter((t) => has(t, EXAMPLE_MARKER)).length).toBeGreaterThanOrEqual(26);
  });
});
