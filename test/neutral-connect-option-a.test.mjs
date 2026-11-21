// neutral-connect-option-a.test.mjs -- owner decision "option A" (2026-11-16): the server instructions and live
// tool output carry no price, credit, free-key or calls-per-day wording; one neutral line points to
// dchub.cloud/connect, and the Capacity Source copy in the instructions and in execute_plan is the teaser only.
// lib/neutral-connect.mjs, server.mjs _INSTRUCTIONS / _INSTRUCTIONS_LEAN / _sourceLineCb.
import { describe, it, expect } from 'vitest';
import {
  connectNeutralString, neutralConnectStep, NEUTRAL_CONNECT_LINE, NEUTRAL_CONNECT_SKIP_TOOLS,
} from '../lib/neutral-connect.mjs';
import { neutralCtaStep, NEUTRAL_GATED } from '../lib/neutral-cta.mjs';
import { CAPACITY_TEASER_LINE } from '../lib/capacity-source-summary.mjs';
process.env.VITEST = process.env.VITEST || '1';
const S = await import('../server.mjs');

// The coordinator's list, verbatim in intent.
export const OPTION_A_BANNED = [
  /\d[\d,]*\s+(?:API\s+)?credits?\b/i,
  /calls?\/day/i,
  /free key/i,
  /free Land & Power/i,
  /fee only on close/i,
  /\$\d/,
];
const hits = (s) => OPTION_A_BANNED.filter((re) => re.test(s)).map(String);

// The strings a keyless head-to-head test read off live /mcp, in the fields they rode.
const LIVE_PACK = 'Want the full dataset? Relay this to your human: a one-time pack of 1,000 credits at https://dchub.cloud/u/abc, no subscription.';
const LIVE_KEY = 'Ask your human for their email, then call claim_free_key: a free key gets 50 MCP calls/day with an email. 1 free Land & Power map search a month.';
const LIVE_FIRST = 'This is today’s full plan answer without a key. Later execute_plan calls today return the preview; a DC Hub key (claim_free_key) adds more.';
const LIVE_LISTING = 'To list capacity, send them to https://dchub.cloud/listings#list-capacity (free; fee only on close).';
const DATA_ROWS = [
  { hub: 'HB_NORTH', price: '$45.20/MWh', note: 'Seller credits 1,000 credits to the buyer.' },
  { headline: 'Utility offers a free key account manager to large loads' },
];
function keylessPlan() {
  const sc = {
    _entity: 'plan_execution',
    first_full_answer: { used: 1, limit: 1, note: LIVE_FIRST },
    answer_guide: 'Compose the answer from executed[].result. ' + LIVE_LISTING + ' ' + CAPACITY_TEASER_LINE,
    for_your_human: { text: LIVE_PACK + ' ' + LIVE_KEY, url: 'https://dchub.cloud/u/abc' },
    human_message: LIVE_KEY + ' Upgrade at $10 one-time.',
    executed: [{ step: 1, tool: 'get_energy_prices', status: 'executed', result: { rows: DATA_ROWS, lmp_usd_mwh: 45.2 } }],
    held: 'Your key dch_live_ABCDEF0123456789 is a free key; send it as X-API-Key.',
  };
  return { content: [{ type: 'text', text: JSON.stringify(sc) }, { type: 'text', text: LIVE_KEY + '\nPJM demand is 93,825 MW.' }],
    structuredContent: sc };
}
const run = (r, env = {}) => neutralConnectStep(neutralCtaStep(r, { env }), { env });

describe('server instructions (option A)', () => {
  it('the handshake and dchub://instructions carry none of the banned wording', () => {
    for (const [name, t] of [['lean', S._INSTRUCTIONS_LEAN], ['full', S._INSTRUCTIONS]]) {
      expect(typeof t).toBe('string');
      expect(hits(t), name).toEqual([]);
      expect(t, name).toContain(NEUTRAL_CONNECT_LINE);
      expect(t, name).not.toMatch(/Past that, previews|listings#list-capacity|request_capacity_intro|one-time pack/);
    }
  });
  it('Capacity Source copy is the teaser only', () => {
    expect(S._INSTRUCTIONS_LEAN).toContain(CAPACITY_TEASER_LINE);
    expect(S._INSTRUCTIONS).toContain(CAPACITY_TEASER_LINE);
    expect(S._INSTRUCTIONS).not.toMatch(/CAPACITY SOURCE(?: ROUTING)?:/);
  });
  it('the tool names stay: claim_free_key and recover_my_key are still named', () => {
    expect(S._INSTRUCTIONS_LEAN).toContain('`claim_free_key`');
    expect(S._INSTRUCTIONS_LEAN).toContain('`recover_my_key`');
  });
});

describe('keyless execute_plan-style result (option A)', () => {
  it('fixture carries the live wording (the guard can fail)', () => {
    const r = keylessPlan();
    expect(hits(JSON.stringify(r.structuredContent.for_your_human))).not.toEqual([]);
    expect(hits(r.structuredContent.first_full_answer.note)).not.toEqual([]);
    expect(hits(r.structuredContent.answer_guide)).not.toEqual([]);
  });
  it('for_your_human, human_message, answer_guide and notes carry none of it; one neutral line instead', () => {
    const out = run(keylessPlan());
    const sc = out.structuredContent;
    const j0 = JSON.parse(out.content[0].text);
    for (const v of [sc, j0]) {
      expect(hits(v.for_your_human.text), 'for_your_human').toEqual([]);
      expect(hits(v.human_message), 'human_message').toEqual([]);
      expect(hits(v.answer_guide), 'answer_guide').toEqual([]);
      expect(hits(v.first_full_answer.note), 'note').toEqual([]);
      expect(v.answer_guide).toContain(CAPACITY_TEASER_LINE);
      expect(v.answer_guide).toContain('Compose the answer from executed[].result.');
    }
    expect(out.content[1].text).toBe(NEUTRAL_CONNECT_LINE + '\nPJM demand is 93,825 MW.');
    expect(JSON.stringify(sc)).toContain(NEUTRAL_CONNECT_LINE);
    expect(JSON.stringify(sc)).not.toContain('Some fields aren\'t included in this answer; connect a free key');
  });
  it('data rows and figures are untouched, and a sentence carrying a key value is kept', () => {
    const out = run(keylessPlan());
    expect(out.structuredContent.executed[0].result.rows).toEqual(DATA_ROWS);
    expect(out.structuredContent.held).toContain('dch_live_ABCDEF0123456789');
  });
  it('CONTROL: DCHUB_NEUTRAL_CONNECT=0 and DCHUB_PLAN_NEUTRAL_CTA=0 leave the wording', () => {
    const env = { DCHUB_NEUTRAL_CONNECT: '0', DCHUB_PLAN_NEUTRAL_CTA: '0' };
    const r = keylessPlan();
    expect(run(r, env)).toBe(r);
  });
});

describe('connectNeutralString', () => {
  it('drops an offer sentence, says the neutral line once, keeps the rest', () => {
    expect(connectNeutralString('Queue is 373.6 GW. ' + LIVE_KEY + ' PJM leads.'))
      .toBe('Queue is 373.6 GW. ' + NEUTRAL_CONNECT_LINE + ' PJM leads.');
  });
  it('a pack offer keeps its link (phrase rewrite), and a dropped sentence keeps its quote / bold balanced', () => {
    expect(connectNeutralString('Tell the user: "This answer hid X. The full answer is available with a one-time pack of 1,000 credits: https://dchub.cloud/upgrade/h/x."'))
      .toBe('Tell the user: "This answer hid X. The full answer is available with full access: https://dchub.cloud/upgrade/h/x."');
    expect(connectNeutralString('Tell the user: "This answer hid X. One email unlocks 50 calls a day."'))
      .toBe('Tell the user: "This answer hid X. ' + NEUTRAL_CONNECT_LINE + '"');
    expect(connectNeutralString('Add your email to get your free key (50 MCP calls/day) and keep going.'))
      .toBe('Add your email to get your key and keep going.');
    expect(connectNeutralString('🔒 **`get_x` needs a $10 pack.** Rows: 5.')).toBe('🔒 **' + NEUTRAL_CONNECT_LINE + '** Rows: 5.');
  });
  it('a bare $ figure is data outside a CTA field, offer wording inside one', () => {
    expect(connectNeutralString('LMP averaged $45/MWh.')).toBe('LMP averaged $45/MWh.');
    expect(connectNeutralString('Unlock it for $10.', { cta: true })).toBe(NEUTRAL_CONNECT_LINE);
    expect(connectNeutralString('Unlock it for $10 one-time.')).toBe(NEUTRAL_CONNECT_LINE);
  });
  it('the tool name claim_free_key alone is not offer wording', () => {
    expect(connectNeutralString('Call claim_free_key to get a key.')).toBe('Call claim_free_key to get a key.');
  });
  it('NEUTRAL_GATED itself is clean', () => {
    expect(hits(NEUTRAL_GATED)).toEqual([]);
  });
  it('the key and commerce tools are skipped (the caller asked)', () => {
    for (const t of ['claim_free_key', 'recover_my_key', 'bind_email', 'unlock_more_data']) expect(NEUTRAL_CONNECT_SKIP_TOOLS.has(t)).toBe(true);
  });
});

describe('execute_plan Capacity Source register offer is off by default', () => {
  it('_capRegisterOfferOn reads DCHUB_CAPACITY_REGISTER_OFFER, default off', () => {
    expect(S._capRegisterOfferOn({})).toBe(false);
    expect(S._capRegisterOfferOn({ DCHUB_CAPACITY_REGISTER_OFFER: '1' })).toBe(true);
  });
});
