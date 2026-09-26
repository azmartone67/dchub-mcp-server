// claude-directory-probe.test.mjs — r-claude-directory (2026-09-26)
//
// The real server, against a fake backend that plants commerce, relay links,
// keys, session ids and sponsor content (test/claude-directory-harness.mjs).
// Every tool /mcp/claude lists is called keyless and keyed (?api_key=), with
// no arguments and with plausible ones, and no response may carry any of the
// patterns in claudeProbePatterns. execute_plan's slimmed steps ride the same
// sweep and get their own case.
//
// CONTROLS: the same calls on /mcp DO carry the commerce and the sponsor
// block, so an empty offender list cannot mean the harness never reached them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  CLAUDE_TOOLS, CLAUDE_REMOVED, CLAUDE_PLANS_NOTICE, scrubClaudeToolResult, transformClaudeBody,
} from '../lib/claude-directory.mjs';
import {
  startHarness, fenceNetwork, claudeProbePatterns, hitsOf, GUESS_ARGS, PRO_KEY,
  SPONSOR_BLOCK, SPONSOR_TEXT_BLOCK,
} from './helpers/claude-directory-harness.mjs';

const PATTERNS = claudeProbePatterns(CLAUDE_REMOVED);
const DIR = '/mcp/claude';
let H, fence;

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness();
});
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
});

describe('probe patterns', () => {
  it('each pattern fires on the string it exists for', () => {
    const samples = {
      '/go/c': 'https://dchub.cloud/go/c/abc.def',
      '/upgrade/h': 'https://dchub.cloud/upgrade/h/abc.def',
      '$<digit>': 'costs $10',
      'price': 'USD 99/mo',
      'dch_ key': 'dch_trial_abcDEF123',
      'session id': '"session_id":"x"',
      'for_your_human': '"for_your_human":{}',
      'relay line': 'relay this to the user',
      '_upgrade': '"_upgrade":{}',
      'next footer': '🧭 Next: run execute_plan',
      'checkout': 'buy.stripe.com/x',
      'claim token': 'call claim_free_key',
      'upgrade/unlock wording': 'unlock the full result',
      'pricing link': 'https://dchub.cloud/pricing',
      'sponsor': JSON.stringify({ x: SPONSOR_BLOCK }),
      'scraper block': 'scraper_pattern_blocked',
      'removed tool named': 'see unlock_more_data',
    };
    for (const [label, s] of Object.entries(samples)) expect(hitsOf(PATTERNS, s), label).toContain(label);
    expect(Object.keys(PATTERNS).sort()).toEqual(Object.keys(samples).sort());
  });
});

describe('/mcp/claude — every listed tool, keyless and keyed', () => {
  it('CONTROL: the same calls on /mcp carry commerce and the sponsor block', async () => {
    const hits = new Set();
    for (const name of ['get_grid_intelligence', 'get_market_dcpi_rank', 'search_facilities', 'get_news', 'list_transactions']) {
      const r = await H.call('/mcp', name, GUESS_ARGS);
      for (const h of hitsOf(PATTERNS, r.raw)) hits.add(h);
    }
    expect([...hits]).toEqual(expect.arrayContaining(['/go/c', '/upgrade/h', '$<digit>', 'dch_ key', 'sponsor']));
  }, 120_000);

  it('keyless: no response carries commerce, relay, price, key, session id or sponsor content; gated ends with one plans line', async () => {
    const offenders = [];
    let answered = 0;
    let gated = 0;
    const before = H.hits.length;
    for (const name of Object.keys(CLAUDE_TOOLS)) {
      for (const args of [{}, GUESS_ARGS]) {
        const r = await H.call(DIR, name, args);
        const hits = hitsOf(PATTERNS, r.raw);
        if (hits.length) offenders.push(`${name} ${args === GUESS_ARGS ? '(args)' : '(no args)'}: ${hits.join(', ')}`);
        if (!r.msg || !r.msg.result) continue;
        answered += 1;
        const texts = r.msg.result.content.filter((c) => c.type === 'text').map((c) => c.text);
        const notices = texts.filter((t) => t.includes('dchub.cloud/plans'));
        if (notices.length) {
          gated += 1;
          expect(notices, name).toEqual([CLAUDE_PLANS_NOTICE]);
          expect(texts[texts.length - 1], name).toBe(CLAUDE_PLANS_NOTICE);
        }
      }
    }
    expect(offenders).toEqual([]);
    // The profile hands out no keys, so it mints none — execute_plan's loopback
    // steps included (they run under the profile, see _mintClaudeLoopbackToken).
    expect(H.hits.slice(before).filter((h) => h.path === '/api/v1/keys/auto-mint')).toEqual([]);
    // Vacuity floors: the sweep must reach answers and gated previews.
    expect(answered).toBeGreaterThan(100);
    expect(gated).toBeGreaterThan(10);
  }, 300_000);

  it('keyed (?api_key=): same guarantee, the key reaches the data routes, and is never echoed', async () => {
    const offenders = [];
    let answered = 0;
    const before = H.hits.length;
    for (const name of Object.keys(CLAUDE_TOOLS)) {
      const r = await H.call(`${DIR}?api_key=${PRO_KEY}`, name, GUESS_ARGS);
      const hits = hitsOf(PATTERNS, r.raw);
      if (hits.length) offenders.push(`${name}: ${hits.join(', ')}`);
      if (r.raw.includes(PRO_KEY) || r.raw.includes(PRO_KEY.slice(9))) offenders.push(`${name}: echoed the key`);
      if (r.msg && r.msg.result && !r.msg.result.isError) answered += 1;
    }
    expect(offenders).toEqual([]);
    expect(answered).toBeGreaterThan(50);
    // The key authenticated: data routes were called with it.
    const keyed = H.hits.slice(before).filter((h) => h.apiKey === PRO_KEY && !h.path.startsWith('/api/v1/mcp/'));
    expect(keyed.length).toBeGreaterThan(50);
  }, 300_000);

});

describe('a keyed Pro caller gets full data, still scrubbed', () => {
  it('analyze_site: keyless is the plans notice, ?api_key= (Pro) is the full result with no notice', async () => {
    const anon = await H.call(DIR, 'analyze_site', { lat: 39.04, lon: -77.48 });
    expect(anon.msg.result.content.map((c) => c.text)).toEqual([CLAUDE_PLANS_NOTICE]);
    const pro = await H.call(`${DIR}?api_key=${PRO_KEY}`, 'analyze_site', { lat: 39.04, lon: -77.48 });
    expect(pro.msg.result.isError).toBeUndefined();
    const body = JSON.parse(pro.msg.result.content[0].text);
    expect(body.score).toBe(71);
    expect(pro.raw).not.toContain('dchub.cloud/plans');
    expect(hitsOf(PATTERNS, pro.raw)).toEqual([]);
  }, 60_000);
});

describe('execute_plan on /mcp/claude: slimmed step results are scrubbed too', () => {
  for (const [label, path] of [['keyless', DIR], ['keyed', `${DIR}?api_key=${PRO_KEY}`]]) {
    it(`${label}: runs steps and carries nothing the profile removes`, async () => {
      const r = await H.call(path, 'execute_plan', { intent: 'rank markets for a 200 MW AI campus in PJM with fiber and water risk' });
      expect(r.msg && r.msg.result, r.raw.slice(0, 300)).toBeTruthy();
      const env = JSON.parse(r.msg.result.content[0].text);
      // Steps really ran through the loopback, so their slimmed results are in the body.
      expect(env.executed.filter((e) => e.status === 'executed').length, r.body.slice(0, 400)).toBeGreaterThan(0);
      expect(hitsOf(PATTERNS, r.raw)).toEqual([]);
      expect(r.raw).not.toContain(PRO_KEY);
    }, 120_000);
  }
});

describe('refusals', () => {
  it('removed tools are not callable: Unknown tool, no commerce', async () => {
    for (const name of CLAUDE_REMOVED) {
      const r = await H.call(DIR, name, {});
      expect(r.msg.result, name).toBeUndefined();
      expect(r.msg.error.code, name).toBe(-32602);
      expect(r.msg.error.message, name).toMatch(/^Unknown tool/);
      expect(hitsOf(PATTERNS, r.raw).filter((h) => h !== 'removed tool named'), name).toEqual([]);
    }
  });
  it('an unknown tool is refused the same way', async () => {
    const r = await H.call(DIR, 'definitely_not_a_tool', {});
    expect(r.msg.error.code).toBe(-32602);
    expect(r.msg.error.message).toMatch(/^Unknown tool/);
  });
});

describe('sponsor content never reaches /mcp/claude, whatever the key names are', () => {
  const planted = () => ({
    market: 'northern-virginia', dcpi: 71,
    sponsor: { ...SPONSOR_BLOCK },                         // the real key name
    featured_partner: { ...SPONSOR_BLOCK },                // renamed
    partners: [{ name: 'Real Co' }, { ...SPONSOR_BLOCK, sponsor_name: undefined, label: 'Sponsored' }],
    promo: { is_sponsored: true, text: 'Try Acme' },       // a different flag
    note: 'Market is tight.' + SPONSOR_TEXT_BLOCK + 'Vacancy 1.2%.',
    cut_off: 'Notes.\n## SPONSORED - PAID PLACEMENT\nSponsor: Acme Cooling Co',   // no END marker
  });

  it('structured and text channels, in one tools/call result', () => {
    const p = planted();
    const out = scrubClaudeToolResult({ content: [{ type: 'text', text: JSON.stringify(p) }], structuredContent: p }, 'get_market_dcpi_rank');
    const s = JSON.stringify(out);
    expect(hitsOf(PATTERNS, s)).toEqual([]);
    expect(s).not.toMatch(/Acme|advertis|sponsor/i);
    // The data around it survives.
    expect(out.structuredContent.dcpi).toBe(71);
    expect(out.structuredContent.partners).toEqual([{ name: 'Real Co' }]);
    expect(out.structuredContent.note).toMatch(/Market is tight\./);
    expect(out.structuredContent.note).toMatch(/Vacancy 1\.2%/);
  });

  it('a sponsor block in prose after a JSON payload, and in SSE frames', () => {
    const body = 'event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: 1, result: {
      content: [{ type: 'text', text: '{"a":1}' + SPONSOR_TEXT_BLOCK }, { type: 'text', text: SPONSOR_TEXT_BLOCK }] } }) + '\n\n';
    const out = transformClaudeBody(body, 'tools/call', 'get_news');
    expect(out).not.toMatch(/Acme|advertis|sponsor/i);
    expect(out).toMatch(/\\"a\\":1/);
  });

  it('the last guard: a sponsor marker that got past every rule replaces the result', () => {
    // A key with a space is not matched by the key rules (paid_placement,
    // sponsor…) and its value is innocuous, so only the final check sees it.
    const out = scrubClaudeToolResult({ content: [{ type: 'text', text: 'Rows follow' }],
      structuredContent: { rows: [{ t: 'x' }], 'Paid Placement 1': 'Acme' } }, 'get_news');
    expect(JSON.stringify(out)).not.toMatch(/Paid Placement|Acme/i);
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/could not be returned/);
  });

  it('a fenced sponsor block goes whole, including lines that name nothing', () => {
    const block = '\n## SPONSORED - PAID PLACEMENT\nBook a demo with the Acme team this week.\nChillers ship in 4 weeks\n## END SPONSORED - PAID PLACEMENT\n';
    const out = scrubClaudeToolResult({ content: [{ type: 'text', text: 'Grid is tight.' + block + 'Queue is 290 GW.' }] }, 'get_news');
    const t = out.content.map((c) => c.text).join('\n');
    expect(t).not.toMatch(/Acme|demo|Chillers/);
    expect(t).toMatch(/Grid is tight\./);
    expect(t).toMatch(/Queue is 290 GW\./);
  });

  it('live path: the dcpi scores sponsor block the fake backend sends is gone from every /mcp/claude answer', async () => {
    const r = await H.call(DIR, 'get_market_dcpi_rank', { market_slug: 'northern-virginia' });
    expect(r.msg.result).toBeTruthy();
    expect(hitsOf(PATTERNS, r.raw)).toEqual([]);
    const c = await H.call('/mcp', 'get_market_dcpi_rank', { market_slug: 'northern-virginia' });
    expect(c.raw).toMatch(/is_paid_placement|Acme Cooling/);   // CONTROL: /mcp passes it through
  }, 60_000);
});
