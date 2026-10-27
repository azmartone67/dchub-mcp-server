// claude-directory-grid-data-installed-capacity.test.mjs — 2026-10-27
//
// mcp#1171 named PJM's new installed_capacity_mw field (EIA-860M) in the /mcp
// get_grid_data description, but /mcp/claude serves its own short line
// (CLAUDE_SEARCH_DESCRIPTIONS in lib/claude-directory.mjs). Measured live
// 2026-10-27 04:42Z: /mcp named the field, /mcp/claude did not. So Claude could
// not tell installed capacity from the withheld committed capacity.
//
// Pinned here, on the served tools/list:
//   - /mcp/claude's get_grid_data names installed_capacity_mw, EIA-860M, its
//     period field, and that committed capacity is licence_withheld;
//   - the line still opens "Use this when" and carries no injection phrasing.
// /mcp/chatgpt is frozen for OpenAI review; its own freeze test pins it.
//
// Hard-gate qualified: real server on 127.0.0.1 against a local stub, no egress.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, injectionHits } from './helpers/claude-directory-harness.mjs';

let H, fence, claude, canon;
const desc = (r) => (r.msg.result.tools.find((t) => t.name === 'get_grid_data') || {}).description || '';

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness();
  claude = desc(await H.list('/mcp/claude'));
  canon = desc(await H.list('/mcp'));
});
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
});

describe('/mcp/claude get_grid_data names PJM installed capacity', () => {
  it('names the field, its source and period, and the withheld committed capacity', () => {
    expect(claude).toMatch(/\binstalled_capacity_mw\b/);
    expect(claude).toContain('EIA-860M');
    expect(claude).toContain('installed_capacity_mw_period');
    expect(claude).toMatch(/committed capacity is listed in licence_withheld/);
  });

  it('is still a plain "Use this when" line with no injection phrasing', () => {
    expect(claude.startsWith('Use this when ')).toBe(true);
    expect(injectionHits(claude)).toEqual([]);
  });

  it('CONTROL: /mcp names the field too (the text this line summarises)', () => {
    expect(canon).toMatch(/\binstalled_capacity_mw\b/);
  });
});
