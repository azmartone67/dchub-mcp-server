// plan-report-1122.test.mjs — the shareable report link on execute_plan answers (lib/plan-report.mjs, server.mjs
// _planReportStep, lib/core-profile.mjs keep). Flag DCHUB_PLAN_REPORT_LINK, default OFF.
//   * off: the result comes back by reference and the mint is never called;
//   * on: report_url (https://dchub.cloud/r/a/<24 random chars>) in structuredContent + one closing text line;
//   * the mint body is the whitelist of what the caller saw: no step bodies, no withheld fields, no key;
//   * a slow, failed or mismatched mint attaches nothing; a plan with no data gets no report;
//   * /mcp/chatgpt, /mcp/claude, a loopback step and other tools get nothing;
//   * /mcp/core keeps report_url only when it is this server's report URL and the flag is on;
//   * the step runs in the tool wrapper after every rewrite, just before the aref step.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as PR from '../lib/plan-report.mjs';
import { coreScrub } from '../lib/core-profile.mjs';
import { _planReportStep, _setPlanReportMintForTest } from '../server.mjs';

const FLAG = 'DCHUB_PLAN_REPORT_LINK';
afterEach(() => { delete process.env[FLAG]; _setPlanReportMintForTest(null); });

const plan = (over = {}) => ({
  content: [{ type: 'text', text: 'ERCOT: 461.4 GW queued as of 2026-10-31.' }, { type: 'text', text: '{"_entity":"plan_execution"}' }],
  structuredContent: {
    fact_header: 'SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-11-21\nENTITY: ERCOT (ISO)',
    _entity: 'plan_execution', ok: true, intent: 'How soon can 100 MW get power in ERCOT?', intent_class: 'time_to_power',
    dcpi_verdict: { market: 'Dallas', verdict: 'CAUTION', score: 61.2, as_of: '2026-11-21' },
    executed: [
      { step: 1, tool: 'get_grid_intelligence', status: 'gated_preview', args: { api_key: 'dch_live_SECRET123456' },
        result: { headroom_mw_withheld: true, rows: [{ secret_row: 1 }], citation: { cite_as: 'DC Hub (dchub.cloud), as of 2026-11-21' } } },
      { step: 2, tool: 'get_interconnection_queue', status: 'executed', depth: 'preview', result: { rows: [1, 2, 3] } },
    ],
    facts: [{ text: 'ERCOT queue 461.4 GW', as_of: '2026-10-31', tool: 'get_interconnection_queue' }],
    citations: [{ step: 1, tool: 'get_grid_intelligence', cite_as: 'DC Hub (dchub.cloud), as of 2026-11-21', as_of: '2026-11-21' }],
    _upgrade: { url: 'https://dchub.cloud/connect' },
    ...over,
  },
});

const okMint = () => {
  const calls = [];
  const fn = async (body) => { calls.push(body); return { report_url: 'https://dchub.cloud/r/a/' + body.id }; };
  fn.calls = calls;
  return fn;
};

describe('lib/plan-report', () => {
  it('flag off: the result by reference, no mint', async () => {
    const r = plan();
    const m = okMint();
    expect(await PR.planReportStep(r, 'execute_plan', { mint: m })).toBe(r);
    process.env[FLAG] = '0';
    expect(await PR.planReportStep(r, 'execute_plan', { mint: m })).toBe(r);
    expect(m.calls.length).toBe(0);
  });

  it('flag on: report_url + one closing line, from an unguessable id', async () => {
    process.env[FLAG] = '1';
    const m = okMint();
    const r = plan();
    const out = await PR.planReportStep(r, 'execute_plan', { mint: m, client: 'claude', callerClass: 'keyless' });
    const url = out.structuredContent.report_url;
    expect(url).toMatch(/^https:\/\/dchub\.cloud\/r\/a\/[A-Za-z0-9_-]{24}$/);
    expect(out.content.length).toBe(r.content.length + 1);
    expect(out.content.at(-1).text).toContain(url);
    expect(out.content.slice(0, 2)).toEqual(r.content);
    expect(r.structuredContent.report_url).toBeUndefined();   // the input is not mutated
    const ids = new Set(Array.from({ length: 200 }, () => PR.newReportId()));
    expect(ids.size).toBe(200);
  });

  it('the mint body is the whitelist of what the caller saw', async () => {
    process.env[FLAG] = '1';
    const m = okMint();
    await PR.planReportStep(plan(), 'execute_plan', { mint: m, client: 'grok', callerClass: 'keyless', isQa: true });
    const b = m.calls[0];
    expect(Object.keys(b).sort()).toEqual(['caller_class', 'client', 'id', 'is_qa', 'payload']);
    const blob = JSON.stringify(b);
    for (const leak of ['dch_live_', 'secret_row', 'headroom_mw_withheld', 'rows', '_upgrade', 'dchub.cloud/connect']) expect(blob).not.toContain(leak);
    const p = b.payload;
    expect(p.question).toBe('How soon can 100 MW get power in ERCOT?');
    expect(p.lead).toBe('ERCOT: 461.4 GW queued as of 2026-10-31.');
    expect(p.as_of).toBe('2026-11-21');
    expect(p.verdict).toEqual({ verdict: 'CAUTION', market: 'Dallas', score: 61.2, as_of: '2026-11-21' });
    expect(p.steps).toEqual([{ tool: 'get_grid_intelligence', status: 'gated_preview' },
      { tool: 'get_interconnection_queue', status: 'executed', depth: 'preview' }]);
    expect(p.held_back).toBe(true);
    expect(p.facts[0].text).toBe('ERCOT queue 461.4 GW');
    expect(b.is_qa).toBe(true);
  });

  it('a slow, failed or mismatched mint attaches nothing', async () => {
    process.env[FLAG] = '1';
    const r = plan();
    expect(await PR.planReportStep(r, 'execute_plan', { mint: () => new Promise(() => {}), timeoutMs: 20 })).toBe(r);
    expect(await PR.planReportStep(r, 'execute_plan', { mint: async () => null })).toBe(r);
    expect(await PR.planReportStep(r, 'execute_plan', { mint: async () => { throw new Error('x'); } })).toBe(r);
    expect(await PR.planReportStep(r, 'execute_plan', { mint: async () => ({ report_url: 'https://dchub.cloud/r/a/' + 'Z'.repeat(24) }) })).toBe(r);
    expect(await PR.planReportStep(r, 'execute_plan', { mint: async (b) => ({ report_url: 'https://evil.example/r/a/' + b.id }) })).toBe(r);
  });

  it('no data, another tool, skip, an error: nothing', async () => {
    process.env[FLAG] = '1';
    const m = okMint();
    const none = plan({ executed: [{ step: 1, tool: 'get_grid_intelligence', status: 'failed' }] });
    expect(await PR.planReportStep(none, 'execute_plan', { mint: m })).toBe(none);
    const r = plan();
    expect(await PR.planReportStep(r, 'get_grid_intelligence', { mint: m })).toBe(r);
    expect(await PR.planReportStep(r, 'execute_plan', { mint: m, skip: true })).toBe(r);
    const err = { ...plan(), isError: true };
    expect(await PR.planReportStep(err, 'execute_plan', { mint: m })).toBe(err);
    expect(m.calls.length).toBe(0);
  });
});

describe('server _planReportStep', () => {
  it('skips /mcp/chatgpt, /mcp/claude and loopback steps; runs on canonical /mcp', async () => {
    process.env[FLAG] = '1';
    const m = okMint();
    _setPlanReportMintForTest(m);
    const r = plan();
    for (const c of [{ profile: 'chatgpt_directory' }, { profile: 'claude_directory' }, { loopback_step: true }]) {
      expect(await _planReportStep(r, 'execute_plan', c)).toBe(r);
    }
    const out = await _planReportStep(r, 'execute_plan', { platform: 'claude', api_key: null });
    expect(out.structuredContent.report_url).toMatch(PR.PLAN_REPORT_URL_RE);
    expect(m.calls.at(-1).caller_class).toBe('keyless');
    delete process.env[FLAG];
    expect(await _planReportStep(r, 'execute_plan', { platform: 'claude' })).toBe(r);
  });

  it('is wired after every rewrite, right before the aref step', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const i = src.indexOf('      _final = await _planReportStep(_final, name, c);\n');
    const j = src.indexOf('      _final = _arefLinksStep(_final, name, c);\n      return _final;');
    const k = src.indexOf('      _final = await _commercialWallStep(_final, name, args, c);');
    expect(i).toBeGreaterThan(k);
    expect(j).toBeGreaterThan(i);
    expect(src).toMatch(/c\.profile === DIRECTORY_PROFILE \|\| c\.profile === CLAUDE_PROFILE \|\| _isCleanPlatform\(\)/);
  });
});

describe('core profile keeps only this server\'s report_url', () => {
  const url = 'https://dchub.cloud/r/a/' + 'A'.repeat(24);
  it('flag on: kept; another report_url and the flag off: dropped', () => {
    process.env[FLAG] = '1';
    expect(coreScrub({ report_url: url }).report_url).toBe(url);
    expect(coreScrub({ report_url: 'https://dchub.cloud/reports/x.pdf' }).report_url).toBeUndefined();
    expect(coreScrub({ nested: { report_url: 'https://dchub.cloud/r/a/short' } }).nested.report_url).toBeUndefined();
    delete process.env[FLAG];
    expect(coreScrub({ report_url: url }).report_url).toBeUndefined();
  });
});
