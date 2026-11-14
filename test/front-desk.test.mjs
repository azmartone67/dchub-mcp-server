// front-desk.test.mjs: the MCP as front desk (owner-approved 2026-11-13; lib/dchub-services.mjs).
//
// WHAT THIS PINS (the real server.mjs app on loopback, a 127.0.0.1 stub backend, off-loopback connects refused):
//   1) dchub_services: every service is {id, name, what, recommend_when, link}, exactly ONE link each, tagged
//      ?via=agent-referral&src=services (any #anchor after the query); no price, no plan name; `need` ranks;
//      listed on /mcp and in discover_tools' account_meta family, NOT on /mcp/chatgpt, /mcp/claude, /mcp/core,
//      /mcp/grok;
//   2) execute_plan's ONE next-step line, per intent class (site, capacity, comparison, repeat), src=footer;
//   3) no line on a wall (a relay link / human_url in the answer); a PREVIEW_FOOTER is replaced, never doubled;
//   4) trimmed after data, not before it: a slimmed plan gets no line and its data is byte-identical to the
//      footer-off run; the Grok text cap drops the line before it cuts a row;
//   5) the referral line on the measured true positives and never on the measured false positives
//      (~/Downloads/dchub-monetize-cutlines-and-referral-1113.md, C3 and C4), as the one line;
//   6) kill switches DCHUB_FRONT_DESK_FOOTER=0, DCHUB_AGENT_REFERRAL=0, DCHUB_FRONT_DESK_WELCOME=0, read per call;
//   7) the execute_plan call row carries params._front_desk = '<footer|referral>:<class>' exactly when the line
//      went out, and is sent exactly once either way;
//   8) the /mcp welcome, and every handshake inside its budget.
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { DCHUB_SERVICES, servicesFor, frontDeskFooter, frontDeskIntentClass, REFERRAL_LINE, referralLink,
  withFrontDeskLine, isFrontDeskLine, createCallMemo, deferFrontDeskRow, flushFrontDeskRow } from '../lib/dchub-services.mjs';
import { agentReferralIntent } from '../lib/capacity-source-summary.mjs';
import { capToolResultText } from '../lib/grok-profile.mjs';
import { PREVIEW_FOOTER, CANON_SENTENCE } from '../lib/dchub-identity.mjs';
import { OUTREACH_LEAD } from '../lib/agent-outreach.mjs';

// The owner's copy, typed out here so a reworded constant fails this file, not just its copies.
const WELCOME = 'Welcome: start with execute_plan; dchub_services lists what else DC Hub offers, one link each.';
const FOOTER_LINE = {
  site: 'DC Hub service for this: the Deal Desk Brief turns a site read like this one into a branded PDF your human can share (paid DC Hub plan): https://dchub.cloud/ai?via=agent-referral&src=footer#pricing',
  capacity: 'DC Hub service for this: Capacity Source lists capacity to lease or buy; call source_capacity, and request_capacity_intro only after your human approves: https://dchub.cloud/listings?via=agent-referral&src=footer',
  comparison: 'DC Hub service for this: the Excel and Google Sheets add-in keeps a comparison like this one in a spreadsheet that refreshes: https://dchub.cloud/spreadsheets?via=agent-referral&src=footer',
  repeat: 'DC Hub service for this: full-depth answers, every field with no previews, come with a paid DC Hub plan: https://dchub.cloud/pricing?via=agent-referral&src=footer',
  repeat_paid: 'DC Hub service for this: the Excel and Google Sheets add-in puts these figures in a spreadsheet that refreshes: https://dchub.cloud/spreadsheets?via=agent-referral&src=footer',
};
const OWNER_REFERRAL = 'For a real project, DC Hub can introduce your human to capacity owners: `request_capacity_intro` registers the requirement, only after your human approves: https://dchub.cloud/connect?via=agent-referral&src=referral';
const NO_PRICE_OR_PLAN = /\$|\bPro\b|\bDeveloper\b|\bEnterprise\b|\bStarter\b|\bFounding\b|\/mo\b|per month|USD/;
const FD_RE = /\?via=agent-referral&src=(?:footer|referral)/;

// ~/Downloads/dchub-monetize-cutlines-and-referral-1113.md C3 (true positives) and C4 (false positives).
const TP = [
  '200 MW AI campus in the Loudoun County corridor',
  'Shortlist top 3 US markets for a 250MW AI data center with fast time to power',
  'natural gas pipeline access near our site in Wyoming for 500 MW to 1 GW onsite gas generation',
  'Can I put a 200 MW AI campus in Dallas?',
  'find a site for a 150 MW data center in Ohio',
  'Where could 200 MW land in Texas fastest?',
  'find 100 MW of buildable capacity near Dallas',
  'I need 5 MW of colocation capacity in Dallas by next year',
  'where can I get 50 MW in Texas by Q2 2027',
  'Where can I get 50 MW in the Southwest by 2028?',
];
const FP = [
  'Is Dallas a better place than Ashburn for a 75 MW AI campus?',
  'Compare Dallas vs Phoenix for a 100 MW AI campus',
  'rank markets for a 200 MW AI campus',
  'Compare Phoenix and Columbus for a 200 MW AI data center',
  'What are the best markets for a 100 MW AI data center in Texas?',
  'Which planned generator retirements in PJM could free up 100 MW for a data center?',
  'Which Texas markets have the most available power for a 50 MW data center in 2027?',
];
// C4 rows 8-10: rule3 fires on them by design (labelled ambiguous, not false, in the measured table).
const AMBIGUOUS_FIRES = [
  'Where is grid capacity about to free up near Ashburn for a 100 MW data center?',
  'data center utility rate for 14 MW in Reno NV',
  'Is Columbus, Ohio a good market for a 100 MW AI campus?',
];

let H, fence, ipN = 0, big = false;
const UA = 'front-desk-test/1.0';
const ROW_PATH = '/api/v1/mcp/track';
const bigBody = () => ({ success: true, as_of: '2026-11-13T00:00:00Z',
  data: Array.from({ length: 400 }, (_, i) => ({ id: i, name: `Row ${i}`, market: 'dallas', note: 'x'.repeat(120) })) });

async function settle(quietMs = 300, maxMs = 8000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function session(path = '/mcp', { key = null, client = 'front-desk-test', ua = UA } = {}) {
  const h = { 'user-agent': ua, 'x-dc-client-ip': `198.51.100.${(++ipN % 250) + 1}`, ...(key ? { 'x-api-key': key } : {}) };
  const init = await H.init(path, client, h);
  const sid = init.headers.get('mcp-session-id');
  const hs = sid ? { ...h, 'mcp-session-id': sid } : h;
  if (sid) await H.post(path, { jsonrpc: '2.0', method: 'notifications/initialized' }, hs);
  return { init, h: hs };
}
async function plan(intent, { key = PRO_KEY, path = '/mcp', client, ua, args = {} } = {}) {
  const { h } = await session(path, { key, client, ua });
  const before = H.hits.length;
  const r = await H.call(path, 'execute_plan', { intent, ...args }, h);
  await settle();
  const res = (r.msg && r.msg.result) || {};
  const blocks = (res.content || []).filter((b) => b && b.type === 'text').map((b) => b.text);
  const rows = H.hits.slice(before).filter((x) => x.path === ROW_PATH && x.body && x.body.tool === 'execute_plan'
    && x.body.params && x.body.params.intent === intent);
  return { res, blocks, sc: res.structuredContent || {}, rows, fd: blocks.filter((t) => FD_RE.test(t)) };
}
// Two runs of the same plan differ only in clocks and per-run tokens; everything else must be byte-identical.
const norm = (t) => String(t)
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<ts>')
  .replace(/"(?:ms|wall_ms|duration_ms|elapsed_ms|took_ms)":\d+/g, '"ms":0')
  .replace(/"(?:rerun_token|token|recipe_execution_id|request_id|call_id)":"[^"]*"/g, '"tok":""');
const withEnv = async (k, v, fn) => {
  const prev = process.env[k]; process.env[k] = v;
  try { return await fn(); } finally { if (prev === undefined) delete process.env[k]; else process.env[k] = prev; }
};

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: (p) => {
    if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/')) return undefined;   // harness defaults
    if (p === '/api/v1/deal-desk') return { status: 404, body: { error: 'not found' } };   // no brief: no for_your_human
    if (big) return bigBody();
    return { success: true, as_of: '2026-11-13T00:00:00Z', data: [{ id: 1, name: 'Row A', market: 'dallas' }] };
  } });
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

describe('dchub_services (item 1)', () => {
  it('every service has the five fields and exactly one link, tagged via=agent-referral&src=services', () => {
    expect(DCHUB_SERVICES.length).toBeGreaterThanOrEqual(8);
    for (const s of DCHUB_SERVICES) {
      expect(Object.keys(s).sort(), s.id).toEqual(['id', 'link', 'name', 'recommend_when', 'what']);
      const links = JSON.stringify(s).match(/https?:\/\/[^\s"]+/g) || [];
      expect(links, s.id).toEqual([s.link]);
      expect(s.link, s.id).toMatch(/^https:\/\/dchub\.cloud\/[^?#]*\?via=agent-referral&src=services(#[\w-]+)?$/);
    }
    expect(referralLink('https://dchub.cloud/ai#pricing', 'services')).toBe('https://dchub.cloud/ai?via=agent-referral&src=services#pricing');
  });
  it('names the eight owner-listed services, no price and no plan name anywhere', () => {
    const ids = DCHUB_SERVICES.map((s) => s.id);
    expect(ids).toEqual(['execute_plan', 'full_depth', 'advisory', 'capacity_source', 'deal_desk_brief', 'excel_add_in', 'chatgpt_app', 'claude_app']);
    expect(DCHUB_SERVICES.find((s) => s.id === 'full_depth').name).toBe('Full-depth answers');
    expect(DCHUB_SERVICES.find((s) => s.id === 'advisory').link).toMatch(/^https:\/\/dchub\.cloud\/advisory\?/);
    expect(JSON.stringify(servicesFor())).not.toMatch(NO_PRICE_OR_PLAN);
    expect(JSON.stringify(DCHUB_SERVICES.find((s) => s.id === 'capacity_source'))).toMatch(/request_capacity_intro[^.]*only after your human approves/);
  });
  it('need ranks the fitting service first; an unmatched need returns the default order and says so', () => {
    expect(servicesFor('we want to lease 20 MW in Dallas').services[0].id).toBe('capacity_source');
    expect(servicesFor('a PDF to share with my board').services[0].id).toBe('deal_desk_brief');
    expect(servicesFor('I work in Excel all day').services[0].id).toBe('excel_add_in');
    const none = servicesFor('zzqx');
    expect(none.need_matched).toBe(false);
    expect(none.services.map((s) => s.id)).toEqual(DCHUB_SERVICES.map((s) => s.id));
  });
  it('the real handler on /mcp serves the list; it is free and keyless', async () => {
    const { h } = await session('/mcp');
    const r = await H.call('/mcp', 'dchub_services', { need: 'lease capacity in Dallas' }, h);
    const res = r.msg.result;
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent;
    expect(sc._entity).toBe('dchub_services');
    expect(sc.services[0].id).toBe('capacity_source');
    expect(sc.services.map((s) => s.id).sort()).toEqual(DCHUB_SERVICES.map((s) => s.id).sort());
    for (const s of sc.services) expect(s.link).toMatch(/\?via=agent-referral&src=services/);
    expect(JSON.stringify(res)).not.toMatch(NO_PRICE_OR_PLAN);
  });
  it('listed on /mcp and in discover_tools account_meta; not on the directory, Claude, core or Grok listings', async () => {
    const names = async (p) => { const { h } = await session(p); const l = await H.list(p, h); return ((l.msg && l.msg.result && l.msg.result.tools) || []).map((t) => t.name); };
    expect(await names('/mcp')).toContain('dchub_services');
    for (const p of ['/mcp/chatgpt', '/mcp/claude', '/mcp/core', '/mcp/grok']) {
      const n = await names(p);
      expect(n.length, p + ' lists tools').toBeGreaterThan(5);
      expect(n, p).not.toContain('dchub_services');
    }
    const { h } = await session('/mcp');
    const d = await H.call('/mcp', 'discover_tools', {}, h);
    const fam = JSON.stringify(d.msg.result.structuredContent || JSON.parse(d.msg.result.content[0].text)).match(/"account_meta"[^}]*?"tools":\[[^\]]*\]/);
    expect(fam && fam[0]).toMatch(/dchub_services/);
  });
});

describe('execute_plan: one next-step line per intent class (item 2)', () => {
  it.each([
    ['site', 'analyze the site at 32.77,-96.79 for a data center', 'footer:site'],
    ['capacity', 'lease colocation space in Dallas', 'footer:capacity'],
    ['comparison', 'compare Dallas vs Phoenix', 'footer:comparison'],
  ])('%s: the one line, last, and the call row is marked', async (cls, intent, marker) => {
    const r = await plan(intent);
    expect(r.fd, intent).toEqual([FOOTER_LINE[cls]]);
    expect(r.blocks[r.blocks.length - 1]).toBe(FOOTER_LINE[cls]);
    expect(r.fd[0].split('\n').length).toBe(1);
    expect(r.rows.length, 'exactly one call row').toBe(1);
    expect(r.rows[0].body.params._front_desk).toBe(marker);
  });
  it('repeat: a key that made an earlier call gets the repeat line on a question with no other class', async () => {
    H.S._fdCallMemoForTest.clear();
    const intent = 'gas economics for on-site generation in Texas';
    const first = await plan(intent);
    expect(first.fd, 'first call: no class, no line').toEqual([]);
    expect(first.rows.length).toBe(1);
    expect(first.rows[0].body.params._front_desk).toBeUndefined();
    const second = await plan(intent);
    expect(second.fd).toEqual([FOOTER_LINE.repeat_paid]);   // PRO_KEY already has full depth: the add-in, not the plan
    expect(second.rows[0].body.params._front_desk).toBe('footer:repeat');
  });
  it('unit: classes, priority (capacity > site > comparison > repeat) and the unpaid repeat line', () => {
    expect(frontDeskIntentClass({ intent: 'compare A vs B', capacityIntent: true })).toBe('capacity');
    expect(frontDeskIntentClass({ intent: 'compare sites', args: { lat: 1, lon: 2 } })).toBe('site');
    expect(frontDeskIntentClass({ intent: 'rank markets', priorCalls: 3 })).toBe('comparison');
    expect(frontDeskIntentClass({ intent: 'gas prices', priorCalls: 1 })).toBe('repeat');
    expect(frontDeskIntentClass({ intent: 'gas prices', priorCalls: 0 })).toBe(null);
    expect(frontDeskFooter('repeat').line).toBe(FOOTER_LINE.repeat);
    for (const k of Object.keys(FOOTER_LINE)) {
      const cls = k === 'repeat_paid' ? 'repeat' : k;
      const line = frontDeskFooter(cls, { paid: k === 'repeat_paid' }).line;
      expect(line).toBe(FOOTER_LINE[k]);
      expect((line.match(/https:\/\//g) || []).length, k + ': one link').toBe(1);
      expect(line, k).not.toMatch(NO_PRICE_OR_PLAN);
      expect(line, k + ': Advisory never in an answer').not.toMatch(/advisory/i);
    }
  });
});

describe('never on a wall, never a second line (item 2)', () => {
  // Measured: on this keyless real path the walled step results are also slimmed (truncated:true), so the
  // trimmed rule stops the line before the wall check runs. The wall check itself is proven on the real
  // _frontDeskStep in the next test (mutation M1 'wall check permissive' turns that one red).
  it('a keyless plan whose steps were walled (and slimmed) carries its relay link and no front-desk line; its row is unmarked and sent once', async () => {
    const r = await plan('analyze the site at 32.77,-96.79 for a data center', { key: null });
    const all = r.blocks.join('\n');
    expect(all, 'precondition: the answer carries a relay link').toMatch(/dchub\.cloud\/(?:u|upgrade\/h)\//);
    expect(r.fd).toEqual([]);
    expect(all).not.toMatch(/agent-referral/);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].body.params._front_desk).toBeUndefined();
  });
  it('a PREVIEW_FOOTER is replaced by the line (the real step), never followed by it', async () => {
    const { _frontDeskStep, _ctxALS } = H.S;
    const base = { content: [{ type: 'text', text: '{"ok":true}' }, { type: 'text', text: 'Source: DC Hub (dchub.cloud)' },
      { type: 'text', text: PREVIEW_FOOTER }], structuredContent: { ok: true } };
    const c = { path: '/mcp', _frontDeskPlan: { kind: 'footer', cls: 'comparison', line: FOOTER_LINE.comparison } };
    const out = await _ctxALS.run(c, async () => _frontDeskStep(base, 'execute_plan', c));
    const texts = out.content.map((b) => b.text);
    expect(texts).toEqual(['{"ok":true}', 'Source: DC Hub (dchub.cloud)', FOOTER_LINE.comparison]);
    expect(c._frontDeskShown).toBe('footer:comparison');
    // and a wall (human_url) is left exactly as it was
    const wall = { ...base, structuredContent: { ok: true, human_url: 'https://dchub.cloud/u/abc234' } };
    const c2 = { path: '/mcp', _frontDeskPlan: c._frontDeskPlan };
    expect(await _ctxALS.run(c2, async () => _frontDeskStep(wall, 'execute_plan', c2))).toBe(wall);
    expect(c2._frontDeskShown).toBeUndefined();
  });
  it('unit: withFrontDeskLine replaces a trailing PREVIEW_FOOTER inside a block and never adds a second line', () => {
    const r = { content: [{ type: 'text', text: `Source: x\n\n${PREVIEW_FOOTER}` }] };
    const out = withFrontDeskLine(r, FOOTER_LINE.site);
    expect(out.content.map((b) => b.text)).toEqual([`Source: x\n\n${FOOTER_LINE.site}`]);
    expect(withFrontDeskLine(out, FOOTER_LINE.capacity)).toBe(out);
    expect(isFrontDeskLine(FOOTER_LINE.site) && isFrontDeskLine(OWNER_REFERRAL)).toBe(true);
  });
  it('not on a clean platform (ChatGPT on /mcp) and not on /mcp/grok', async () => {
    const cg = await plan('compare Dallas vs Phoenix', { client: 'openai-mcp', ua: 'openai-mcp/1.0' });
    expect(cg.fd).toEqual([]);
    expect(cg.rows[0] && cg.rows[0].body.params._front_desk).toBeUndefined();
    const gk = await plan('compare Dallas vs Phoenix', { path: '/mcp/grok' });
    expect(gk.blocks.length).toBeGreaterThan(0);
    expect(gk.fd).toEqual([]);
  });
});

describe('trimmed after data, not before it (item 2)', () => {
  it('a plan whose steps were slimmed gets no line, and its data equals the footer-off run byte for byte', async () => {
    big = true;
    try {
      const on = await plan('compare Dallas vs Phoenix');
      const off = await withEnv('DCHUB_FRONT_DESK_FOOTER', '0', () => plan('compare Dallas vs Phoenix'));
      const results = (x) => norm(JSON.stringify((x.sc.executed || []).map((e) => e.result)));
      expect((on.sc.executed || []).some((e) => e.result && e.result.truncated === true), 'precondition: a step was slimmed').toBe(true);
      expect(on.fd).toEqual([]);
      expect(on.rows[0].body.params._front_desk).toBeUndefined();
      expect(results(on)).toBe(results(off));
    } finally { big = false; }
  });
  it('an untrimmed plan: the line is ADDED, every other block is unchanged vs the footer-off run', async () => {
    const on = await plan('compare Dallas vs Phoenix');
    const off = await withEnv('DCHUB_FRONT_DESK_FOOTER', '0', () => plan('compare Dallas vs Phoenix'));
    expect(on.fd).toEqual([FOOTER_LINE.comparison]);
    expect(off.fd).toEqual([]);
    expect(on.blocks.length).toBe(off.blocks.length + 1);
    expect(norm(on.blocks.slice(1, -1).join('\n'))).toBe(norm(off.blocks.slice(1).join('\n')));
    expect(norm(JSON.stringify((on.sc.executed || []).map((e) => e.result)))).toBe(norm(JSON.stringify((off.sc.executed || []).map((e) => e.result))));
  });
  it('Grok text cap: the line goes first; if that fits, the data is untouched; if not, the line is still gone', () => {
    const data = { type: 'text', text: JSON.stringify({ rows: Array.from({ length: 50 }, (_, i) => ({ i, s: 'y'.repeat(150) })) }) };
    const fdBlock = { type: 'text', text: FOOTER_LINE.comparison };
    const drop = (b) => isFrontDeskLine(b && b.text);
    const len = data.text.length;
    // fits without the line: data returned byte for byte, no truncation note
    const fits = capToolResultText({ content: [data, fdBlock] }, { max: len + 10, dropFirst: drop });
    expect(fits.content).toEqual([data]);
    // does not fit even without the line: capped, and no front-desk line survives
    const capped = capToolResultText({ content: [data, fdBlock] }, { max: 3000, dropFirst: drop });
    expect(capped.content.some((b) => drop(b))).toBe(false);
    expect(capped.content.map((b) => b.text).join('\n')).toMatch(/over this connector's/);
    // without dropFirst (the old behaviour) the line rides and the data is cut instead
    const old = capToolResultText({ content: [data, fdBlock] }, { max: len + 10 });
    expect(old.content.some((b) => drop(b))).toBe(true);
  });
  it('the step itself skips the line for a Grok client whose text would pass the cap', async () => {
    const { _frontDeskStep, _ctxALS } = H.S;
    const result = { content: [{ type: 'text', text: '{"x":"' + 'z'.repeat(11950) + '"}' }], structuredContent: { ok: true } };
    const c = { path: '/mcp', user_agent: 'Grok/1.0', _frontDeskPlan: { kind: 'footer', cls: 'comparison', line: FOOTER_LINE.comparison } };
    expect(await _ctxALS.run(c, async () => _frontDeskStep(result, 'execute_plan', c))).toBe(result);
    const c2 = { ...c, user_agent: 'claude-ai' };
    expect((await _ctxALS.run(c2, async () => _frontDeskStep(result, 'execute_plan', c2))).content.length).toBe(2);
  });
});

describe('the referral line on real-project intent (item 5)', () => {
  it.each(TP)('rule3 fires on true positive: %s', (t) => { expect(agentReferralIntent(t)).toBe(true); });
  it.each(FP)('rule3 stays quiet on false positive: %s', (t) => { expect(agentReferralIntent(t)).toBe(false); });
  it.each(AMBIGUOUS_FIRES)('rule3 fires on the measured ambiguous row (by design): %s', (t) => { expect(agentReferralIntent(t)).toBe(true); });
  it('size is required (>= 1 MW), typed args count, sell-side is not a buyer project', () => {
    expect(agentReferralIntent('find a site in Ohio for a data center')).toBe(false);
    expect(agentReferralIntent('find a site in Ohio for a data center', { capacity_mw: 150 })).toBe(true);
    expect(agentReferralIntent('I need 500 kW of colocation in Dallas')).toBe(false);
    expect(agentReferralIntent('sell my powered land in Texas, 100 MW')).toBe(false);
  });
  it('the referral copy: one line, one link, names request_capacity_intro, no plan, no price, no Advisory', () => {
    expect(REFERRAL_LINE).toBe(OWNER_REFERRAL);
    expect((REFERRAL_LINE.match(/https:\/\//g) || [])).toHaveLength(1);
    expect(REFERRAL_LINE).not.toMatch(NO_PRICE_OR_PLAN);
    expect(REFERRAL_LINE).not.toMatch(/advisory/i);
  });
  it.each([TP[3], TP[8], TP[7]])('real handler: %s ends with the referral line as its ONE line, row marked referral:project', async (t) => {
    const r = await plan(t);
    expect(r.fd).toEqual([OWNER_REFERRAL]);
    expect(r.blocks[r.blocks.length - 1]).toBe(OWNER_REFERRAL);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].body.params._front_desk).toBe('referral:project');
  });
  it.each([FP[1], FP[2]])('real handler: %s gets no referral line', async (t) => {
    const r = await plan(t);
    expect(r.blocks.join('\n')).not.toMatch(/src=referral/);
    expect(r.fd.length).toBeLessThanOrEqual(1);
  });
});

describe('kill switches, read per call', () => {
  it('DCHUB_FRONT_DESK_FOOTER=0: no class line, row unmarked', async () => {
    const r = await withEnv('DCHUB_FRONT_DESK_FOOTER', '0', () => plan('compare Dallas vs Phoenix'));
    expect(r.fd).toEqual([]);
    expect(r.rows[0].body.params._front_desk).toBeUndefined();
  });
  it('DCHUB_AGENT_REFERRAL=0: a true positive gets no referral line (the class footer may stand in)', async () => {
    const r = await withEnv('DCHUB_AGENT_REFERRAL', '0', () => plan(TP[3]));
    expect(r.blocks.join('\n')).not.toMatch(/src=referral/);
    expect(r.fd.length).toBeLessThanOrEqual(1);
    expect(String(r.rows[0].body.params._front_desk || '')).not.toMatch(/^referral/);
  });
  it('DCHUB_FRONT_DESK_WELCOME=0: the /mcp handshake has no welcome', async () => {
    const t = await withEnv('DCHUB_FRONT_DESK_WELCOME', '0', async () => (await session('/mcp')).init.msg.result.instructions);
    expect(t).not.toContain(WELCOME);
  });
});

describe('telemetry: the parked row (item 5)', () => {
  it('deferFrontDeskRow / flushFrontDeskRow: sent once, marked only when shown, the fallback sends it unmarked', async () => {
    const sent = [];
    const c = {};
    expect(deferFrontDeskRow(c, { tool: 'execute_plan', params: { intent: 'x' } }, (p) => sent.push(p))).toBe(true);
    expect(sent).toEqual([]);
    flushFrontDeskRow(c, 'footer:site');
    flushFrontDeskRow(c, 'footer:site');
    expect(sent).toEqual([{ tool: 'execute_plan', params: { intent: 'x', _front_desk: 'footer:site' } }]);
    const c2 = {};
    deferFrontDeskRow(c2, { tool: 'execute_plan', params: { intent: 'y' } }, (p) => sent.push(p), { fallbackMs: 20 });
    await new Promise((r) => setTimeout(r, 80));
    expect(sent[1]).toEqual({ tool: 'execute_plan', params: { intent: 'y' } });
    flushFrontDeskRow(c2, 'footer:site');
    expect(sent).toHaveLength(2);
  });
  it('createCallMemo counts calls before this one per identity', () => {
    const m = createCallMemo(3);
    expect([m.note('a'), m.note('a'), m.note('b'), m.note(null)]).toEqual([0, 1, 0, 0]);
  });
});

describe('the /mcp welcome (item 4), and every handshake in budget', () => {
  it('/mcp says it right after its lead (canon sentence + OUTREACH_LEAD); within 2,048', async () => {
    const t = (await session('/mcp')).init.msg.result.instructions;
    expect(t.startsWith(CANON_SENTENCE + ' ' + OUTREACH_LEAD + WELCOME + ' ')).toBe(true);
    expect(t.split(WELCOME).length - 1).toBe(1);
    expect(t.length, 'measured ' + t.length).toBeLessThanOrEqual(2048);
  });
  it('/mcp/grok, the packs and the frozen profiles do not carry it, and stay in budget', async () => {
    const packs = [...H.S.MCP_PACKS.keys()];
    for (const p of ['/mcp/grok', '/mcp/chatgpt', '/mcp/claude', '/mcp/core', ...packs]) {
      const t = (await session(p)).init.msg.result.instructions;
      expect(typeof t, p).toBe('string');
      expect(t, p).not.toContain(WELCOME);
      expect(t.length, p + ' measured ' + t.length).toBeLessThanOrEqual(p === '/mcp/grok' ? 2000 : 2048);
    }
  });
});
