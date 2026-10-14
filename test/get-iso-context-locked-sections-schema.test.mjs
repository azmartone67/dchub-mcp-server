// get_iso_context's outputSchema accepts locked_sections as the backend sends it: section NAMES
// (strings). #854 typed it as objects only, so every keyless call (the free preview) failed MCP
// output validation with -32602 from 2026-10-09 (found by the 2026-10-14 anonymous wall audit).
import { describe, it, expect } from 'vitest';
import { _TOOL_OUTPUT_SCHEMAS } from '../server.mjs';

const schema = _TOOL_OUTPUT_SCHEMAS.get_iso_context;
const base = { ok: true, iso: 'PJM', tier: 'anonymous', max_tokens: 800, used_tokens: 640 };

describe('get_iso_context outputSchema', () => {
  it('accepts locked_sections as strings (what the backend sends)', () => {
    const r = schema.safeParse({ ...base, sections: [{ id: 'overview' }],
      locked_sections: ['interconnection_queue', 'capacity_market', 'tariffs'] });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
  it('still accepts object items and an absent / null field', () => {
    expect(schema.safeParse({ ...base, locked_sections: [{ id: 'tariffs' }] }).success).toBe(true);
    expect(schema.safeParse({ ...base }).success).toBe(true);
    expect(schema.safeParse({ ...base, locked_sections: null }).success).toBe(true);
  });
  it('still rejects a non-array', () => {
    expect(schema.safeParse({ ...base, locked_sections: 'tariffs' }).success).toBe(false);
  });
});
