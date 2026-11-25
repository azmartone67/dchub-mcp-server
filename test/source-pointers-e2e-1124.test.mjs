// source-pointers-e2e-1124.test.mjs — Grok spec item 7 (DCHUB_SOURCE_POINTERS_V1) on a real server.mjs with a stub
// backend: flood, broadband and water asks at a Loudoun address. Flag on: the answer's lead carries a figure or a dated
// public pointer (URL + "pointer checked <YYYY-MM-DD>"), never "no figure in them could be summarised here". Flag off:
// the lead is what planLeadText gave before this change. Unit tests: test/source-pointers-1124.test.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { planLeadText } from '../lib/plan-lead-text.mjs';
import { usablePointers, loadSourcePointers } from '../lib/source-pointers.mjs';

const PRO = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.37' };
const ON = { DCHUB_SOURCE_POINTERS_V1: '1' };
const OFF = { DCHUB_SOURCE_POINTERS_V1: '' };
const DEAD_END = /no figure in them could be summarised/;
const DATED = /pointer checked \d{4}-\d{2}-\d{2}\)/;
const ASKS = {
  flood: { url: 'https://msc.fema.gov/portal/search', intents: ['Is Loudoun County Virginia in a FEMA flood zone?',
    'What is the flood zone at 21155 Smith Switch Rd, Ashburn, Loudoun County VA (39.0127, -77.4615)?'] },
  broadband: { url: 'https://broadbandmap.fcc.gov/', intents: ['broadband availability in Loudoun County VA',
    'Is fixed broadband available at 21155 Smith Switch Rd, Ashburn, Loudoun County VA (39.0127, -77.4615)?'] },
  water: { url: 'https://waterdata.usgs.gov/', intents: ['water risk in Loudoun County VA',
    'What is the water risk at 21155 Smith Switch Rd, Ashburn, Loudoun County VA (39.0127, -77.4615)?'] },
};
// The lead checks use a fixed, dated pointer list, so the weekly link check (which may drop a failing pointer from
// config/source-pointers.json) never turns its own PR red; the served block 0 is checked against the loaded config.
const FIXED = usablePointers(Object.values({
  flood: { topic: 'flood', label: 'FEMA National Flood Hazard Layer', url: 'https://msc.fema.gov/portal/search', publisher: 'FEMA', checked_on: '2026-11-24', fail_count: 0 },
  broadband: { topic: 'broadband', label: 'FCC National Broadband Map', url: 'https://broadbandmap.fcc.gov/', publisher: 'FCC', checked_on: '2026-11-24', fail_count: 0 },
  water: { topic: 'water', label: 'USGS Water Data for the Nation', url: 'https://waterdata.usgs.gov/', publisher: 'USGS', checked_on: '2026-11-24', fail_count: 0 },
}));
let H, fence;
const sc = (r) => r.msg.result.structuredContent || JSON.parse(r.msg.result.content.find((b) => b.text.trim().startsWith('{')).text);
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ env: ON });
}, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); }, 60_000);

describe('execute_plan source pointers at Loudoun (real server.mjs, stub backend)', () => {
  for (const [topic, { url, intents }] of Object.entries(ASKS)) {
    for (const intent of intents) {
      it(`${topic}: "${intent}" — flag on: a figure or a dated ${topic} pointer, never the dead-end line`, async () => {
        const r = await H.call('/mcp', 'execute_plan', { intent }, PRO);
        const o = sc(r);
        const lead = planLeadText(o, { env: ON, pointers: FIXED });
        expect(lead).not.toMatch(DEAD_END);
        expect(lead).toContain(url);
        expect(lead).toMatch(DATED);
        expect(lead).not.toMatch(/\b(partner|integrated with|powered by)\b/i);
        // flag off: no pointer, and the lead is the one before this change
        const off = planLeadText(o, { env: OFF, pointers: FIXED });
        expect(off).not.toContain(url);
        expect(off).not.toMatch(DATED);
        // The served block 0, when this surface serves a lead, is the flag-on lead (the server read the flag itself).
        const b0 = r.msg.result.content[0].text;
        if (!b0.trim().startsWith('{') && /Full answer: the JSON/.test(b0) && loadSourcePointers().has(topic)) {
          expect(b0).toContain(url);
          expect(b0).not.toMatch(DEAD_END);
        }
        expect(fence.foreign).toEqual([]);
        console.log(`[${topic}] ${intent}\n  ON : ${lead}\n  OFF: ${off}`);
      }, 120_000);
    }
  }
});
