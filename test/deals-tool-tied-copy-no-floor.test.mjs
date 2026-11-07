// Copy that ties a deal count to a deals TOOL states none (2026-11-06).
//
// Measured live: keyed list_transactions answers total_count = 453 (rows with a named buyer
// AND seller), while the canon `deals` floor counts DISTINCT deals with one-party records
// included (/transactions: 1,807). Both are right; a count printed next to the tool reads as
// what the tool returns, and it is not. mcp#1299 drops it from the served description; these
// are the two copies outside that PR:
//   - sdk/python/dchub/manifest.py  list_transactions said "2,000+ deals" (above canon too)
//   - integrations/chatgpt/openapi.json  /api/v1/hyperscaler-deals said its rows came "from
//     DC Hub's N+ tracked M&A deals"; that feed is the hyperscaler news tracker, not the
//     deals table.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// Any "N+ deals" / "N+ tracked M&A deals" / "(N+ deals)" count.
const DEAL_FLOOR = /\d[\d,]*\+\s+(?:tracked\s+)?(?:M&A\s+)?(?:deals|transactions)\b/i;

function sdkListTransactions() {
  const src = read('sdk/python/dchub/manifest.py');
  const m = src.match(/"list_transactions":\s*\(([\s\S]*?)\),/);
  expect(m, 'list_transactions entry missing from sdk/python/dchub/manifest.py').toBeTruthy();
  return m[1];
}

function hyperscalerDealsDescription() {
  const spec = JSON.parse(read('integrations/chatgpt/openapi.json'));
  const op = spec.paths?.['/api/v1/hyperscaler-deals']?.get;
  expect(op, '/api/v1/hyperscaler-deals GET missing from the ChatGPT actions spec').toBeTruthy();
  return op.description;
}

describe('deal-tool copy states no deal floor', () => {
  it('the pattern reads every shape the claim took (control)', () => {
    for (const c of ['(2,000+ deals)', "from DC Hub's 1,800+ tracked M&A deals",
      '1,800+ tracked deals', '1,600+ tracked transactions']) {
      expect(DEAL_FLOOR.test(c), c).toBe(true);
    }
  });

  it('sdk manifest: list_transactions points at total_count, not a floor', () => {
    const d = sdkListTransactions();
    expect(d).not.toMatch(DEAL_FLOOR);
    expect(d).toMatch(/total_count/);
  });

  it('ChatGPT actions spec: hyperscaler-deals claims no deals-table floor', () => {
    const d = hyperscalerDealsDescription();
    expect(d).toMatch(/hyperscaler/i);
    expect(d).not.toMatch(DEAL_FLOOR);
  });
});
