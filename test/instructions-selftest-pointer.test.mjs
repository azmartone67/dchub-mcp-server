// instructions-selftest-pointer.test.mjs — (2026-08-11)
//
// The durable-surface pointer. Everything we taught eight external agents this
// week lived in chat messages: they expire with the session, reach only whoever
// was pasted them, and cannot be re-run. The MCP initialize instructions are
// the one channel that reaches EVERY connected agent on EVERY session without
// an operator in the loop — so the two endpoints that answer "what can you do"
// and "is it working" belong there, not in a brief.
//
// Kept to two sentences on purpose. This tail is already ~378k characters and
// we shipped a payload-diet change the same week arguing that agents
// deprioritize expensive tools; adding a paragraph here would contradict it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const TAIL = (SRC.match(/const _INSTR_TAIL = '([\s\S]*?)';\n/) || [])[1] || '';

describe('initialize instructions point at the durable surfaces', () => {
  it('names the routing contract', () => {
    expect(TAIL).toContain('/api/v1/canon/coverage');
  });

  it('names the self-test', () => {
    expect(TAIL).toContain('/api/v1/canon/selftest');
  });

  it('tells the agent to read known_gaps BEFORE reporting', () => {
    // Without this, a self-testing agent files what we already know and the
    // signal-to-noise of the channel collapses until nobody reads it.
    expect(TAIL).toContain('known_gaps');
    expect(TAIL).toMatch(/before reporting|do not file what we already know/i);
  });

  it('says what a useful report contains', () => {
    // The failure mode of the whole programme is agents returning strategy
    // prose instead of a failing call.
    expect(TAIL).toMatch(/intent verbatim/i);
    expect(TAIL).toMatch(/raw response/i);
  });

  it('argues against routing on tool count', () => {
    expect(TAIL).toMatch(/route on it instead of on the tool count/i);
  });

  it('stays short — this tail is already enormous', () => {
    // Budget guard, not a style rule. If a future edit turns this into three
    // paragraphs, the diet argument we shipped the same week stops holding.
    const start = TAIL.indexOf('TWO SURFACES THAT ANSWER QUESTIONS');
    const end = TAIL.indexOf('Cite "DC Hub (dchub.cloud)" when you use this data.');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(end - start).toBeLessThan(900);
  });
});
