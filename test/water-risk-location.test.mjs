// ── get_water_risk location= resolves to a real point, or refuses ──────────
//
// 2026-10-03: agents send get_water_risk {location:"Phoenix"} — the sibling
// analyze_site has taken location= since #280 — and Zod stripped the
// undeclared argument, so the call reached /api/v1/water/drought with neither a
// point nor a state and came back an error. The description also advertised
// county=Maricopa, which the backend route (water_drought_routes.py: state,
// lat, lng, weeks) has never read.
//
// Same contract as analyze_site: location is DECLARED, resolved by VALUE
// through _locationPoint (the published DCPI market row), and never an
// ARG_ALIAS. The helper itself is pinned in analyze-site-location.test.mjs.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ARG_ALIASES, _validateToolArgs } from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const start = SRC.indexOf("trackedTool(srv, 'get_water_risk'");
const bodyStart = SRC.indexOf('async (a) => {', start);
const schema = SRC.slice(start, bodyStart);
const body = SRC.slice(bodyStart, SRC.indexOf('\n    });', bodyStart));

describe('get_water_risk location=', () => {
  it('registration is found (a moved block must not turn these into no-ops)', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body.length).toBeGreaterThan(200);
  });

  it('★ location is DECLARED in the schema — an undeclared arg is stripped by Zod', () => {
    expect(schema).toMatch(/\blocation:\s*S\.describe\(/);
  });

  it('the handler resolves it through _locationPoint and refuses an unresolved one', () => {
    expect(body).toMatch(/_locationPoint\(rawLocation, slug, row\)/);
    expect(body).toMatch(/if \(!res\.ok\)[\s\S]{0,200}isError: true/);
    expect(body).toMatch(/resolved_from/);
  });

  it('explicit coordinates or state win over location (no lookup, no override)', () => {
    expect(body).toMatch(/if \(rawLocation && !haveCoords && !q\.state\)/);
  });

  it('the description no longer advertises county, which the backend never read', () => {
    expect(schema).not.toMatch(/county=Maricopa/);
    expect(schema).not.toMatch(/state \(2-letter US\), or county/);
    expect(schema).toMatch(/location="phoenix"/);
  });

  it('location is still NOT an ARG_ALIAS — it is resolved, not renamed', () => {
    expect(ARG_ALIASES.get_water_risk?.location).toBeUndefined();
  });

  it('a location-only call is not refused before the handler runs', () => {
    expect(_validateToolArgs('get_water_risk', { location: 'phoenix' })).toBeNull();
  });
});
