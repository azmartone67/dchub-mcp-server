// cite-report-link-1125.test.mjs — the report page as the answer's citation link (lib/plan-report.mjs,
// flag DCHUB_CITE_REPORT_LINK, default OFF; needs DCHUB_PLAN_REPORT_LINK on, which mints the page).
//   * off: byte-identical to the report-link behaviour (report_url + the separate report line, no cite_as_url change);
//   * on, answer with a "Cite as: ..." closing block: that block gains "Source link: <url>", no separate report line;
//   * on, answer without one (a partial answer): one "Source link for this answer: <url>" line;
//   * cite_as_url is the minted report URL, walled answers included; report_url stays; one distinct URL added;
//   * no mint, no link: the result comes back by reference.
import { describe, it, expect, afterEach } from 'vitest';
import * as PR from '../lib/plan-report.mjs';
import { stampOutreach } from '../lib/agent-outreach.mjs';

const REPORT = 'DCHUB_PLAN_REPORT_LINK';
const CITE = 'DCHUB_CITE_REPORT_LINK';
afterEach(() => { delete process.env[REPORT]; delete process.env[CITE]; });

const plan = (over = {}, content) => ({
  content: content || [{ type: 'text', text: 'ERCOT: 461.4 GW queued as of 2026-10-31.' }],
  structuredContent: {
    _entity: 'plan_execution', ok: true, intent: 'How soon can 100 MW get power in ERCOT?',
    executed: [{ step: 1, tool: 'get_interconnection_queue', status: 'executed', result: { rows: [1] } }],
    facts: [{ text: 'ERCOT queue 461.4 GW', as_of: '2026-10-31', tool: 'get_interconnection_queue' }],
    cite_as: 'DC Hub (dchub.cloud), as of 2026-11-24',
    ...over,
  },
});
const mint = async (body) => ({ report_url: 'https://dchub.cloud/r/a/' + body.id });
const texts = (r) => r.content.map((b) => b.text);
const urlsIn = (r) => new Set(JSON.stringify([r.content, r.structuredContent]).match(/https:\/\/dchub\.cloud\/r\/a\/[A-Za-z0-9_-]+/g) || []);

describe('report page as the citation link', () => {
  it('flag off: the report-link behaviour, unchanged', async () => {
    process.env[REPORT] = '1';
    const r = plan({ cite_as_url: 'https://dchub.cloud/?via=agent-cite' }, [{ type: 'text', text: 'lead' }, { type: 'text', text: 'Cite as: DC Hub (dchub.cloud), as of 2026-11-24.' }]);
    const out = await PR.planReportStep(r, 'execute_plan', { mint });
    expect(out.structuredContent.cite_as_url).toBe('https://dchub.cloud/?via=agent-cite');
    expect(texts(out)).toEqual(['lead', 'Cite as: DC Hub (dchub.cloud), as of 2026-11-24.', PR.REPORT_LINE(out.structuredContent.report_url)]);
    expect(PR.citeReportOn({})).toBe(false);
    expect(PR.citeReportOn({ [CITE]: '0' })).toBe(false);
  });

  it('on: the Cite as block carries the link, and no separate report line is sent', async () => {
    process.env[REPORT] = '1'; process.env[CITE] = '1';
    const stamped = stampOutreach(plan(), 'execute_plan', {}, { nextAsk: false });
    expect(texts(stamped).at(-1)).toBe('Cite as: DC Hub (dchub.cloud), as of 2026-11-24.');   // the block this step extends
    const out = await PR.planReportStep(stamped, 'execute_plan', { mint });
    const url = out.structuredContent.report_url;
    expect(url).toMatch(PR.PLAN_REPORT_URL_RE);
    expect(out.structuredContent.cite_as_url).toBe(url);
    expect(out.content.length).toBe(stamped.content.length);
    expect(texts(out).at(-1)).toBe(`Cite as: DC Hub (dchub.cloud), as of 2026-11-24. Source link: ${url}`);
    expect(texts(out).join('\n')).not.toMatch(/Shareable report/);
    expect([...urlsIn(out)]).toEqual([url]);
    expect(stamped.structuredContent.cite_as_url).not.toBe(url);   // the input is not mutated
  });

  it('on: a walled answer (no Cite as line, no cite_as_url before) gets the link and one plain line', async () => {
    process.env[REPORT] = '1'; process.env[CITE] = '1';
    const walled = stampOutreach(plan({ human_url: 'https://dchub.cloud/u/abc234', citation: { completeness: 'partial_preview' } }), 'execute_plan', {}, { nextAsk: false });
    expect(walled.structuredContent.cite_as_url).toBeUndefined();
    expect(texts(walled).some((t) => /^Cite as:/.test(t))).toBe(false);
    const out = await PR.planReportStep(walled, 'execute_plan', { mint });
    const url = out.structuredContent.report_url;
    expect(out.structuredContent.cite_as_url).toBe(url);
    expect(out.structuredContent.human_url).toBe('https://dchub.cloud/u/abc234');
    expect(texts(out).at(-1)).toBe(PR.CITE_LINK_LINE(url));
    expect(out.content.length).toBe(walled.content.length + 1);
    expect(PR.CITE_LINK_LINE(url)).not.toMatch(/\b(partial|preview|upgrade|unlock|trial|plan|free|key|email)\b/i);
  });

  it('on: only a whole Cite as block is extended, and the last one', () => {
    const url = 'https://dchub.cloud/r/a/' + 'a'.repeat(24);
    const mixed = [{ type: 'text', text: 'Cite as: X.\nmore prose' }, { type: 'text', text: 'Cite as: A.' }, { type: 'text', text: 'Cite as: B.' }];
    expect(PR.withCiteLink(mixed, url).map((b) => b.text)).toEqual(['Cite as: X.\nmore prose', 'Cite as: A.', `Cite as: B. Source link: ${url}`]);
    expect(PR.withCiteLink([mixed[0]], url).map((b) => b.text)).toEqual(['Cite as: X.\nmore prose', PR.CITE_LINK_LINE(url)]);
  });

  it('on, but the report flag off or the mint fails: nothing changes', async () => {
    process.env[CITE] = '1';
    const r = plan();
    expect(await PR.planReportStep(r, 'execute_plan', { mint })).toBe(r);
    process.env[REPORT] = '1';
    expect(await PR.planReportStep(r, 'execute_plan', { mint: async () => null })).toBe(r);
    expect(await PR.planReportStep(r, 'get_grid_data', { mint })).toBe(r);
  });
});
