// Publishing the one-of, 2026-09-20.
//
// `get_grid_intelligence {}` is a SCHEMA-VALID call: its inputSchema declares no
// `required` array, so "(required)" survives only inside a property DESCRIPTION,
// which a validator ignores. The handler rejects it loudly, but the model had no
// machine-readable reason not to try — and until #469 that rejection cost a
// metered trial answer and had its own `valid_regions` list trimmed 7 -> 3.
//
// These tests VALIDATE the emitted schema with ajv rather than asserting on its
// shape: a structural check would pass on an anyOf that accepts everything.
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import { applyOneOfAnyOf, ONE_OF_REQUIRED, ONE_OF_PUBLISHED } from '../server.mjs';

// The real get_grid_intelligence shape, trimmed to what matters here.
const GRID_SCHEMA = {
  type: 'object',
  properties: {
    region_id: { type: 'string', description: 'Grid region (required): one of the 7 US ISOs…' },
    iso:       { type: 'string', description: 'Alias for region_id' },
    region:    { type: 'string', description: 'Alias for region_id' },
    market:    { type: 'string', description: 'Market NAME or metro slug' },
    mpp_pay:   { type: 'boolean' },
  },
};
const ajv = new Ajv({ strict: false, allErrors: true });
const validate = (schema, args) => ajv.validate(schema, args);

describe('the emitted contract rejects the call that returns nothing', () => {
  const out = applyOneOfAnyOf(GRID_SCHEMA, 'get_grid_intelligence');

  it('{} no longer validates', () => {
    expect(validate(GRID_SCHEMA, {})).toBe(true);      // the bug, pinned
    expect(validate(out, {})).toBe(false);             // the fix
  });

  it('every documented way of naming a grid still validates', () => {
    for (const args of [{ region_id: 'PJM' }, { iso: 'ERCOT' }, { region: 'CAISO' },
                        { market: 'Ashburn' }, { region_id: 'PJM', mpp_pay: true }]) {
      expect(validate(out, args), `${JSON.stringify(args)} must stay valid`).toBe(true);
    }
  });

  it('an unrelated argument alone does not satisfy it', () => {
    expect(validate(out, { mpp_pay: true })).toBe(false);
  });
});

describe('applyOneOfAnyOf is conservative', () => {
  it('leaves tools that declare no one-of alone', () => {
    const s = { type: 'object', properties: { q: { type: 'string' } } };
    expect(applyOneOfAnyOf(s, 'semantic_search')).toBe(s);
  });

  it('only publishes branches the schema actually DECLARES', () => {
    // Zod strips an undeclared argument before the handler runs, so a branch
    // requiring one would be a rule no caller could satisfy by obeying it.
    const partial = { type: 'object', properties: { region_id: { type: 'string' } } };
    const out = applyOneOfAnyOf(partial, 'get_grid_intelligence');
    expect(out.anyOf.map((b) => b.required)).toEqual([['region_id']]);
    expect(validate(out, { market: 'Ashburn' })).toBe(false);
  });

  it('never clobbers an existing anyOf, and survives junk', () => {
    const existing = { type: 'object', properties: { region_id: {} }, anyOf: [{ required: ['x'] }] };
    expect(applyOneOfAnyOf(existing, 'get_grid_intelligence')).toBe(existing);
    for (const junk of [null, undefined, 'str', 42, []]) {
      expect(applyOneOfAnyOf(junk, 'get_grid_intelligence')).toBe(junk);
    }
    expect(applyOneOfAnyOf({ type: 'object' }, 'get_grid_intelligence')).toEqual({ type: 'object' });
  });
});

describe('each branch is Ajv-2020-12-strict clean', () => {
  it('re-declares the property it requires', () => {
    // A bare {required:['region_id']} raises strictRequired — the property must
    // be defined in the SAME subschema. test/schema-dialect-neutral.test.mjs
    // compiles every served schema that way because the Claude client does.
    const out = applyOneOfAnyOf(GRID_SCHEMA, 'get_grid_intelligence');
    for (const b of out.anyOf) {
      const [k] = b.required;
      expect(Object.prototype.hasOwnProperty.call(b.properties, k),
             `anyOf branch for ${k} must declare it`).toBe(true);
    }
    const strict = new Ajv({ strict: true, allErrors: true });
    expect(() => strict.compile(out)).not.toThrow();
  });
});

describe('the two tables cannot drift', () => {
  it('every runtime one-of is also published, with the same args', () => {
    for (const [tool, args] of Object.entries(ONE_OF_REQUIRED)) {
      expect(ONE_OF_PUBLISHED[tool], `${tool} missing from ONE_OF_PUBLISHED`).toEqual(args);
    }
  });

  it('get_grid_intelligence is published but NOT on the generic runtime check', () => {
    // It already fails loudly with valid_regions + both examples + a BA hint.
    // ONE_OF_REQUIRED would replace that with missing_identifier prose pointing
    // at search_facilities — wrong for an ISO. Publishing the contract must not
    // cost the better error.
    expect(ONE_OF_PUBLISHED.get_grid_intelligence).toBeTruthy();
    expect(ONE_OF_REQUIRED.get_grid_intelligence).toBeUndefined();
  });
});

describe('it is wired into the emitted schema, not just exported', () => {
  it('tools/list applies it alongside the dialect strip', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('../server.mjs', import.meta.url)), 'utf8');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).toContain('t.inputSchema = applyOneOfAnyOf(stripSchemaDialect(t.inputSchema), t.name);');
    expect(code).not.toContain('t.inputSchema = stripSchemaDialect(t.inputSchema);');
  });
});
