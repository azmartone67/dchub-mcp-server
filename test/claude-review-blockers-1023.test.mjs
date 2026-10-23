// Claude Connectors Directory self-test, 2026-10-23 (all 67 /mcp/claude tools run with the
// enterprise reviewer key). Two defects a reviewer would hit:
//   1. search -> fetch: search on /mcp and /mcp/claude returns slug and hex ids
//      ("equinix-llc-ashburn-ashburn", "6364c613b80ae2b5"); fetch asked only
//      /api/v1/facility/<id>, which resolves numeric ids, so every such id failed.
//   2. "This result is partial: some fields are not included at this access level" on
//      execute_plan and get_infra_projects for a FULL-access caller: the only reason was
//      "step result truncated" (a size trim), with an empty withheld list.
import { describe, it, expect } from 'vitest';
import { _facilityFetch } from '../server.mjs';
import { isGated } from '../lib/chatgpt-directory.mjs';
import { claudeIsGated, CLAUDE_DIRECTORY } from '../lib/claude-directory.mjs';

const REC = { name: 'Equinix Ashburn DC21', operator: 'Equinix', city: 'Ashburn', state: 'VA', country: 'US' };

describe('1: fetch resolves the ids search returns', () => {
  it('a hex/slug id that misses the numeric route is read from /api/v1/facilities/<id>', async () => {
    const calls = [];
    const api = async (path) => {
      calls.push(path);
      if (path.startsWith('/api/v1/facility/')) return { success: false, error: 'not found' };
      if (path === '/api/v1/facilities/6364c613b80ae2b5') return { success: true, data: REC };
      return {};
    };
    const r = await _facilityFetch('6364c613b80ae2b5', api);
    expect(r.isError).toBeFalsy();
    expect(JSON.stringify(r.content)).toMatch(/Equinix Ashburn DC21/);
    expect(calls).toEqual(['/api/v1/facility/6364c613b80ae2b5', '/api/v1/facilities/6364c613b80ae2b5']);
  });

  it('CONTROL: a numeric id (the /mcp/chatgpt case) never touches the plural route', async () => {
    const calls = [];
    const api = async (path) => {
      calls.push(path);
      if (path === '/api/v1/facility/296') return { success: true, data: { ...REC, name: 'Equinix DC1' } };
      return {};
    };
    const r = await _facilityFetch('296', api);
    expect(r.isError).toBeFalsy();
    expect(calls.some((p) => p.startsWith('/api/v1/facilities/'))).toBe(false);
  });

  it('an id neither route knows is still the same error', async () => {
    const r = await _facilityFetch('no-such-facility-zzz-000', async () => ({ success: false }));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/No DC Hub facility has that id/);
  });
});

const block = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
const SIZE_ONLY = block({ rows: [1], citation: { completeness: 'partial_preview' },
  preview: { reasons: ['step result truncated'], withheld_fields: [], withholding_proven: true } });

describe('2: a size trim is not "partial at this access level" on /mcp/claude', () => {
  it('size-only partial does not gate', () => {
    expect(claudeIsGated(SIZE_ONLY)).toBe(false);
  });

  it('a real lock still gates (decision layer, _in_pro field, mixed reasons)', () => {
    expect(claudeIsGated(block({ citation: { completeness: 'partial_preview' },
      preview: { reasons: ['decision layer locked'] } }))).toBe(true);
    expect(claudeIsGated(block({ capacity_in_pro: true, citation: { completeness: 'partial_preview' },
      preview: { reasons: ['step result truncated'] } }))).toBe(true);
    expect(claudeIsGated(block({ citation: { completeness: 'partial_preview' },
      preview: { reasons: ['step result truncated', 'rows: 10 of 132 shown'] } }))).toBe(true);
  });

  it('the Claude profile uses it: no notice appended to a size-only result', () => {
    const out = CLAUDE_DIRECTORY.scrubToolResult(SIZE_ONLY, 'execute_plan');
    expect(JSON.stringify(out)).not.toMatch(/This result is partial/);
  });

  it('CONTROL: the shared rule (/mcp/chatgpt) is unchanged and still gates a size-only result', () => {
    expect(isGated(SIZE_ONLY)).toBe(true);
  });
});
