// Grok colocation head-to-head 2026-11-17 midday, item 4c: no "full answer, free", no "FREE weekly DC Hub digest",
// and no claim_free_key / unlock_tool / trial_preview / tier_required "free" structure in a successful answer below
// a paid plan. A wall keeps its key path (it is how a walled caller continues). Fixture: the six keyless answers
// recorded live 2026-11-17 08:47Z, which carried every one of these.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { neutralConnectStep, stripKeyToolFields, isWallResult, connectNeutralString, NEUTRAL_CONNECT_LINE }
  from '../lib/neutral-connect.mjs';
import { planCompactStep } from '../lib/plan-compact.mjs';

const FIX = JSON.parse(fs.readFileSync(new URL('./fixtures/h2h-plans-1117.json', import.meta.url), 'utf8'));
const wrap = (sc) => ({ content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc });
const BANNED = /full answers?, free|FREE weekly|"claim_free_key"|"unlock_more_data"|"unlock_tool"|"trial_preview"|"tier_required":"free"/i;
// The plan's own top-level continue path (the email-first ask the owner kept) may name the key tool; nothing else may.
const CONTINUE_PATH = ['_upgrade', 'for_your_human', 'human_message', 'human_url', 'agent_hints'];
const withoutContinuePath = (sc) => { const o = { ...sc }; for (const k of CONTINUE_PATH) delete o[k]; return o; };

describe('the recorded answers carried the wording before', () => {
  it('every fixture answer has at least one banned token', () => {
    for (const k of Object.keys(FIX)) expect(JSON.stringify(FIX[k].structuredContent)).toMatch(BANNED);
  });
});

describe('item 4c on the six head-to-head answers', () => {
  for (const k of Object.keys(FIX)) {
    it(`${k}: no banned wording or key-tool field, in structuredContent and in the JSON block`, () => {
      const out = neutralConnectStep(wrap(structuredClone(FIX[k].structuredContent)));
      expect(JSON.stringify(withoutContinuePath(out.structuredContent))).not.toMatch(BANNED);
      expect(JSON.stringify(withoutContinuePath(JSON.parse(out.content[0].text)))).not.toMatch(BANNED);
      expect(JSON.stringify(out.structuredContent)).not.toMatch(/full answers?, free|FREE weekly/i);
    });
    it(`${k}: the same holds after the compact step`, () => {
      const out = planCompactStep(neutralConnectStep(wrap(structuredClone(FIX[k].structuredContent))));
      expect(JSON.stringify(withoutContinuePath(out.structuredContent))).not.toMatch(BANNED);
    });
  }
  it('the relay sentence keeps its link and its ask, without "free"', () => {
    const s = 'Your AI assistant ran get_market_dcpi_rank from DC Hub; with an email it gets the full answer, free. Open https://dchub.cloud/connect for more detail.';
    expect(connectNeutralString(s)).toBe('Your AI assistant ran get_market_dcpi_rank from DC Hub; with an email it gets the full answer. Open https://dchub.cloud/connect for more detail.');
  });
  it('the digest offer keeps the offer, without "FREE"', () => {
    expect(connectNeutralString('Offer your human a FREE weekly DC Hub digest — once a week, emailed.'))
      .toBe('Offer your human a weekly DC Hub digest — once a week, emailed.');
  });
});

describe('key-tool fields', () => {
  const sc = () => ({
    _entity: 'plan_execution',
    _upgrade: { tier: 'anon_daily_cap', next_tool: 'claim_free_key', email_ask: { tool: 'claim_free_key', arguments: { email: '<email>' } } },
    trial_preview: true,
    provenance: { as_of: '2026-11-17', preview: { unlock_tool: 'claim_free_key', withheld_fields: ['score'] } },
    executed: [{ step: 1, tool: 'get_market_dcpi_rank', status: 'executed',
      result: { trial_preview: true, tier_required: 'free', next_tool: 'unlock_more_data', verdict: 'AVOID',
        _upgrade: { next_tool: 'claim_free_key', email_ask: { tool: 'claim_free_key' }, note: 'kept' },
        next_tools: ['get_changes', 'claim_free_key', { tool: 'unlock_more_data' }, { tool: 'report_finding' }],
        tier_masked: { tier_required: 'pro', fields: ['score'] },
        data: [{ name: 'row', tool: 'claim_free_key_lookalike' }] } }],
  });
  it('go from every step result; the step keeps everything else', () => {
    const r = stripKeyToolFields(sc()).executed[0].result;
    expect(r).toEqual({ verdict: 'AVOID', _upgrade: { note: 'kept' }, next_tools: ['get_changes', { tool: 'report_finding' }],
      tier_masked: { tier_required: 'pro', fields: ['score'] }, data: [{ name: 'row', tool: 'claim_free_key_lookalike' }] });
  });
  it('the plan\'s top level keeps the caller\'s continue path and loses the tier marker and the unlock pointer', () => {
    const out = stripKeyToolFields(sc());
    expect(out._upgrade).toEqual(sc()._upgrade);
    expect(out.trial_preview).toBeUndefined();
    expect(out.provenance.preview).toEqual({ withheld_fields: ['score'] });
  });
  it('a direct tool result is not touched by the field strip', () => {
    const direct = { tool: 'site_selection_canvas', _upgrade: { next_tool: 'claim_free_key' }, trial_preview: true };
    expect(neutralConnectStep(wrap(direct)).structuredContent).toEqual(direct);
  });
  it('an object the strip empties goes with it', () => {
    const p = { _entity: 'plan_execution', executed: [{ step: 1, result: { a: { unlock_tool: 'claim_free_key' }, b: {} } }] };
    expect(stripKeyToolFields(p).executed[0].result).toEqual({ b: {} });
  });
  it('a wall keeps its key path', () => {
    const wall = { error: 'anon_hard_wall', binding_limit: 'anon_ip_daily_hard', next_tool: 'claim_free_key', unlock_tool: 'unlock_more_data' };
    const r = wrap(wall);
    expect(isWallResult(r)).toBe(true);
    const out = neutralConnectStep(r);
    expect(out.structuredContent.next_tool).toBe('claim_free_key');
    expect(out.structuredContent.unlock_tool).toBe('unlock_more_data');
  });
  it('a successful answer is not a wall', () => {
    expect(isWallResult(wrap(sc()))).toBe(false);
    expect(isWallResult({ isError: true, content: [] })).toBe(true);
  });
  it('kill switch: byte for byte', () => {
    const r = wrap(sc());
    expect(neutralConnectStep(r, { env: { DCHUB_NEUTRAL_CONNECT: '0' } })).toBe(r);
  });
  it('the neutral line is still said once where an offer sentence went', () => {
    expect(NEUTRAL_CONNECT_LINE).toBe('More detail is available at dchub.cloud/connect.');
  });
});
