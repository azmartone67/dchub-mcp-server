// payload-diet.test.mjs — r-payload-diet + r-quota-truth (2026-08-10)
//
// WHAT THIS IS FOR
// Agents have token budgets. A tool that costs thousands of tokens to return
// one row gets quietly deprioritized — no error, no signal to us, just a
// falling call count. That is a plausible mechanical contributor to
// 5,348 → 2,091 tool calls that has nothing to do with discovery.
//
// Measured on a LIVE execute_plan (compare Dallas vs Columbus), 1 step shown:
//     total envelope            9,028 B
//     nested step _upgrade      1,167 B   (13%, duplicating the envelope's 758 B)
//     replay                    1,837 B
//       replay.note               442 B  ← static prose, byte-identical every call
//       replay.compatibility      421 B
//       replay.decisions          350 B  ← the actual auditable content
// A 3-step paid plan pays the nested upsell three times for zero added
// information.
//
// The rules this encodes:
//   - collapse only EXACT duplicates (a step that gates differently is real
//     information about which step hit which wall)
//   - never grow the payload (a pointer costs ~70 B; do not "save" 4 B with it)
//   - report NET bytes, never gross — overstating our own numbers is the same
//     class of error we refuse to make about MW
import { describe, it, expect } from 'vitest';
import { _execDedupeUpsell, _planQuery } from '../server.mjs';

const bigUpsell = () => ({
  message: 'Upgrade for full depth. '.repeat(20),
  credits_url: 'https://dchub.cloud/go/c/abc123',
  starter_url: 'https://dchub.cloud/go/c/def456',
});

describe('_execDedupeUpsell', () => {
  it('collapses an identical upsell block on later steps', () => {
    const u = bigUpsell();
    const ex = [
      { step: 1, tool: 'a', result: { data: 1, _upgrade: { ...u } } },
      { step: 2, tool: 'b', result: { data: 2, _upgrade: { ...u } } },
      { step: 3, tool: 'c', result: { data: 3, _upgrade: { ...u } } },
    ];
    const r = _execDedupeUpsell(ex);
    expect(r.collapsed).toBe(true);
    expect(r.summary.steps).toBe(2);                    // steps 2 and 3
    expect(r.summary.keys).toContain('_upgrade');
    // First copy survives in full — the offer is never removed.
    expect(typeof ex[0].result._upgrade.message).toBe('string');
    expect(ex[0].result._upgrade.credits_url).toBe('https://dchub.cloud/go/c/abc123');
    // Later copies become an explicit pointer, not a silent deletion.
    expect(ex[1].result._upgrade._same_as).toMatch(/first step that carried it/);
    expect(ex[2].result._upgrade._same_as).toMatch(/first step that carried it/);
  });

  it('KEEPS a genuinely different upsell — that difference is information', () => {
    const ex = [
      { step: 1, tool: 'a', result: { _upgrade: bigUpsell() } },
      { step: 2, tool: 'b', result: { _upgrade: { message: 'A DIFFERENT WALL ENTIRELY' } } },
    ];
    _execDedupeUpsell(ex);
    expect(ex[1].result._upgrade.message).toBe('A DIFFERENT WALL ENTIRELY');
    expect(ex[1].result._upgrade._same_as).toBeUndefined();
  });

  it('never grows the payload', () => {
    // auto_trial_key is a short string; a ~70B pointer is BIGGER than it.
    // Collapsing it would make the response worse while reporting a "saving".
    const ex = [
      { step: 1, tool: 'a', result: { auto_trial_key: 'k1' } },
      { step: 2, tool: 'b', result: { auto_trial_key: 'k1' } },
    ];
    const before = JSON.stringify(ex).length;
    _execDedupeUpsell(ex);
    const after = JSON.stringify(ex).length;
    expect(after).toBeLessThanOrEqual(before);
    expect(ex[1].result.auto_trial_key).toBe('k1');   // left alone
  });

  it('reports NET bytes that match the actual reduction exactly', () => {
    const u = bigUpsell();
    const ex = [
      { step: 1, tool: 'a', result: { data: 1, _upgrade: { ...u } } },
      { step: 2, tool: 'b', result: { data: 2, _upgrade: { ...u } } },
      { step: 3, tool: 'c', result: { data: 3, _upgrade: { ...u }, auto_trial_key: 'k1' } },
    ];
    const before = JSON.stringify(ex).length;
    const r = _execDedupeUpsell(ex);
    const actual = before - JSON.stringify(ex).length;
    expect(r.summary.bytes_saved).toBe(actual);   // exact, not approximate
  });

  it('is a no-op on a plan with nothing duplicated', () => {
    const ex = [{ step: 1, tool: 'a', result: { data: 1 } }];
    const r = _execDedupeUpsell(ex);
    expect(r.collapsed).toBe(false);
    expect(JSON.stringify(ex)).toBe('[{"step":1,"tool":"a","result":{"data":1}}]');
  });

  it('never throws on hostile or missing input', () => {
    for (const bad of [null, undefined, 'nope', 42, [], [null], [{ result: null }],
                       [{ result: 'string' }], [{ result: [] }]]) {
      expect(() => _execDedupeUpsell(bad)).not.toThrow();
    }
  });
});

describe('replay.note diet', () => {
  it('drops the static how-to-read prose but keeps the citable trail', () => {
    const p = _planQuery('rank markets for a 200 MW AI campus', {});
    const note = p.replay.note;
    expect(note.length).toBeLessThan(250);          // was 442B of boilerplate
    // The part that has actual value — how to cite a decision — stays.
    expect(note).toMatch(/Decision D2/);
    expect(note).toMatch(/dchub\.cloud\/integrations\/mcp#replay/);
  });

  it('leaves the auditable content itself untouched', () => {
    const p = _planQuery('rank markets for a 200 MW AI campus', {});
    expect(Array.isArray(p.replay.decisions)).toBe(true);
    expect(p.replay.decisions.length).toBeGreaterThan(0);
    expect(p.replay.execution_graph).toBeTruthy();
    // The published stability contract is NOT touched — it has consumers and
    // its own assertions, and shaving 200B off a stability contract is not
    // worth the churn.
    expect(p.replay.compatibility.schema_version).toBe(1);
    expect(p.replay.compatibility.schema_v1).toMatch(/additive-only/i);
  });
});

describe('quota truth (r-quota-truth)', () => {
  // A live envelope carried BOTH of these at once:
  //     quota.full_answers_remaining_today: 2
  //     _upgrade.remaining_today: 0
  // plus retry_instructions telling the agent it had "2 more full answers
  // today". Both numbers were correct. Together they were unreadable, and the
  // guidance was actively wrong — the IP cap binds first, so an agent that
  // retries on the 2 burns a call and hits the same wall.
  it('both counters declare what they count', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(src).toContain('q.full_answers_basis =');
    expect(src).toMatch(/full_answers_basis[\s\S]{0,400}PER-TOOL/);
    expect(src).toContain('remaining_today_basis:');
    expect(src).toMatch(/remaining_today_basis[\s\S]{0,400}ALL tools/);
  });

  it('names which limit is actually binding', () => {
    // The agent should not have to infer precedence from two bare integers.
    return import('node:fs').then(({ readFileSync }) => {
      const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
      expect(src).toContain("binding_limit: 'anon_ip_daily'");
      expect(src).toMatch(/do not retry until you claim a key/);
    });
  });
});
