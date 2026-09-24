// optin-cta-parity.test.mjs — the Node opt-in card must equal the backend's.
//
// Two paths build the same `optin_cta` card: mcp_gatekeeper._optin_cta_block in
// dchub-backend and _optinCtaCard here (r-optin-parity). This test lifts the
// Python definitions out of mcp_gatekeeper.py with `ast` (Tier, OPTIN_CTA_TOOLS,
// optin_cta_enabled, _optin_cta_block — no Flask, no db), RUNS them, and requires
// the same card for every tool, the same tool set, and the same flag verdicts.
//
// The backend is a separate repo, so this runs where it is on disk:
// DCHUB_BACKEND_DIR, else ../dchub-backend or ~/dchub-backend. Absent, it skips
// and says so — which is what it does in CI, where the backend is not checked
// out, so the exact strings are also pinned without the backend in
// optin-ask-on-trial-wall.test.mjs. Run it locally when either side changes.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _optinCtaCard, OPTIN_CTA_TOOLS, optinCtaEnabled } from '../server.mjs';

const here = fileURLToPath(new URL('..', import.meta.url));
const GK = [process.env.DCHUB_BACKEND_DIR, resolve(here, '../dchub-backend'), join(homedir(), 'dchub-backend')]
  .filter(Boolean).map((d) => join(d, 'mcp_gatekeeper.py')).find((p) => existsSync(p));

const PY = String.raw`
import ast, json, os, sys
src = open(sys.argv[1], encoding="utf-8").read()
tree = ast.parse(src)
want = {"Tier", "OPTIN_CTA_TOOLS", "optin_cta_enabled", "_optin_cta_block"}
parts = []
for n in tree.body:
    name = getattr(n, "name", None)
    if name is None and isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name):
        name = n.targets[0].id
    if name in want:
        parts.append(ast.get_source_segment(src, n)); want.discard(name)
if want:
    sys.exit("missing from mcp_gatekeeper.py: " + ", ".join(sorted(want)))
ns = {}
exec("import os\nfrom enum import IntEnum\nfrom typing import Any, Dict, Optional\n" + "\n\n".join(parts), ns)
out = {"tools": sorted(ns["OPTIN_CTA_TOOLS"]), "cards": {}, "flag": {}}
for v in ["", "1", "yes", "false", "true", " TRUE "]:
    os.environ["OPTIN_CTA_ENABLED"] = v
    out["flag"][v] = ns["optin_cta_enabled"]()
os.environ["OPTIN_CTA_ENABLED"] = "true"
for t in ["get_grid_intelligence", "get_fiber_intel", "rank_markets"]:
    out["cards"][t] = ns["_optin_cta_block"](t, ns["Tier"].FREE, "dch_trial_x")
out["identified"] = ns["_optin_cta_block"]("get_grid_intelligence", ns["Tier"].IDENTIFIED, None)
print(json.dumps(out, ensure_ascii=False))
`;

describe.skipIf(!GK)(`optin_cta parity with ${GK || 'mcp_gatekeeper.py (not on disk — skipped)'}`, () => {
  const py = GK ? JSON.parse(execFileSync('python3', ['-c', PY, GK], { encoding: 'utf8' })) : null;

  it('same tool set', () => {
    expect([...OPTIN_CTA_TOOLS].sort()).toEqual(py.tools);
  });

  it.each(['get_grid_intelligence', 'get_fiber_intel'])('same card for %s, key for key', (t) => {
    expect(_optinCtaCard(t)).toEqual(py.cards[t]);
  });

  it('backend shows nothing off-set or to IDENTIFIED (a trial key) — Node mirrors both', () => {
    expect(py.cards.rank_markets).toBeNull();
    expect(py.identified).toBeNull();
    expect(OPTIN_CTA_TOOLS).not.toContain('rank_markets');
  });

  it('same flag verdicts', () => {
    for (const [v, on] of Object.entries(py.flag)) expect(optinCtaEnabled({ OPTIN_CTA_ENABLED: v })).toBe(on);
  });
});
