// canonical/tool_maturity.json is served on /mcp tools/list, and /mcp tools/list
// is byte-frozen until 2026-10-02 (frz-claude-relay-wording). A daily rewrite
// of the snapshot failed daily-manifest-sync's verify step on 2026-09-28 (runs
// 36431329208, 36497724727), which then refused to push the whole heal.
// scripts/refresh-tool-maturity.mjs now HOLDS the snapshot until the freeze
// ends. Hermetic: no network, no writes.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCP_BYTE_FREEZE_ENDS, heldByMcpByteFreeze, writeDecision } from '../scripts/refresh-tool-maturity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BEFORE = Date.parse('2026-09-29T13:41:00Z');
const AFTER = Date.parse('2026-10-02T13:41:00Z');

const PREV = {
  retrieved_at: '2026-09-21T13:45:37.892Z', contract_hash: 'a4f6fc226ffb14c8',
  capture_evidence: { last_successful_execution: '2026-09-21T07:45:02Z', deferred_tools: ['plan_fiber_leadin'] },
};
const MOVED = {
  ...PREV, retrieved_at: '2026-09-29T03:38:56.186Z',
  capture_evidence: { ...PREV.capture_evidence, last_successful_execution: '2026-09-28T07:52:48Z' },
};

describe('tool_maturity refresh while /mcp is byte-frozen', () => {
  it('holds a changed snapshot before the freeze ends', () => {
    expect(writeDecision(PREV, MOVED, BEFORE)).toBe('held');
  });

  it('writes the same change once the freeze has ended', () => {
    expect(writeDecision(PREV, MOVED, AFTER)).toBe('write');
  });

  it('a retrieved_at-only difference is still "same", frozen or not', () => {
    const restamped = { ...PREV, retrieved_at: MOVED.retrieved_at };
    expect(writeDecision(PREV, restamped, BEFORE)).toBe('same');
    expect(writeDecision(PREV, restamped, AFTER)).toBe('same');
  });

  it('with no committed snapshot it still writes (nothing is served to hold)', () => {
    expect(writeDecision(null, MOVED, BEFORE)).toBe('write');
  });

  it('the hold boundary is exact', () => {
    const end = Date.parse(MCP_BYTE_FREEZE_ENDS);
    expect(heldByMcpByteFreeze(end - 1)).toBe(true);
    expect(heldByMcpByteFreeze(end)).toBe(false);
  });

  it('the hold ends at the same instant the tools/list byte comparison retires', () => {
    const src = fs.readFileSync(path.join(ROOT, 'test', 'claude-directory-catalog.test.mjs'), 'utf8');
    const m = src.match(/const FREEZE_ENDS = Date\.parse\('([^']+)'\)/);
    expect(m, 'FREEZE_ENDS not found in claude-directory-catalog.test.mjs').toBeTruthy();
    expect(Date.parse(m[1])).toBe(Date.parse(MCP_BYTE_FREEZE_ENDS));
  });
});
