// site-context-cite-1127.test.mjs — Grok fix-all 2026-11-27 item 8 (owner-approved): get_site_context is cited with
// the execute_plan owner line, and a full-depth answer says completeness "full", never "unknown".
import { it, expect } from 'vitest';
import { stampSiteContextCite } from '../lib/site-context-cite.mjs';
import { PLAN_CITE_RE } from '../lib/plan-cite-line.mjs';

const NOW = Date.parse('2026-11-28T02:30:00Z');   // 19:30 on 2026-11-27 in Phoenix
const out = (completeness) => ({ cite_as: 'DC Hub (dchub.cloud), as of 2026-11-27',
  citation: { cite_as: 'DC Hub, dchub.cloud', completeness }, provenance: { cite_as: 'DC Hub, dchub.cloud', completeness } });

it('full view: owner line everywhere, completeness full', () => {
  const r = stampSiteContextCite(out('unknown'), { view: 'full', as_of: '2026-11-27' }, NOW,
    { priorCite: 'DC Hub (dchub.cloud), as of 2026-11-27' });
  expect(r.cite_as).toBe('Source: DC Hub (dchub.cloud), as of 2026-11-27');
  expect(r.cite_as).toMatch(PLAN_CITE_RE);
  expect(r.citation.cite_as).toBe(r.cite_as);
  expect(r.provenance.cite_as).toBe(r.cite_as);
  expect(r.provenance.completeness).toBe('full');
  expect(r.citation.completeness).toBe('full');
});

it('never replaces a completeness the attribution step already set', () => {
  const r = stampSiteContextCite(out('unrestricted'), { view: 'full' }, NOW);
  expect(r.provenance.completeness).toBe('unrestricted');
});

it('preview view: owner line, completeness left as attribution gave it', () => {
  const r = stampSiteContextCite(out('unknown'), { view: 'preview', blocks: [] }, NOW);
  expect(r.cite_as).toMatch(PLAN_CITE_RE);
  expect(r.provenance.completeness).toBe('unknown');
});

it('never throws on junk', () => {
  expect(stampSiteContextCite(null, null)).toBe(null);
  expect(stampSiteContextCite({}, 'x', NOW).cite_as).toMatch(PLAN_CITE_RE);
});
