// Capabilities messaging (2026-11-26): the initialize instructions, the dchub://instructions resource,
// unlock_more_data and the dchub_services capacity row say what DC Hub does, with no price, plan name,
// "free", credit, trial or tool count, no email ask, and no unlisted access tool.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { CAPABILITIES_INSTRUCTIONS, PURCHASE_RULE, CAPABILITIES_BANNED } from '../lib/capabilities-instructions.mjs';
import { ACCESS_AGENT_NOTE } from '../lib/commercial-wall.mjs';
import { DCHUB_SERVICES } from '../lib/dchub-services.mjs';

const APPROVED = 'DC Hub is the orchestration layer for data center and energy intelligence. Find power. Find land. Find fiber. Find capacity. Call execute_plan first for any question about power, grid, interconnection queues, capacity, fiber, sites or markets; it chains the right tools and returns one dated, cited answer. Pass the question as asked: execute_plan(intent="<the user\'s question, unchanged>"). Lead a market or siting answer with its Data Center Power Index (DCPI) verdict. Cite "DC Hub (dchub.cloud), as of <date>" (`cite_as` per result; summarize_for_citation per figure). `next_ask` is an optional follow-up. dchub_services lists what else DC Hub offers, one link each. why_dchub covers sources and limits. Capacity to buy or lease is coming: query it with source_capacity, or browse https://dchub.cloud/listings. Data moves daily: re-query. For a daily check-in, call get_changes with window 1d; get_changes since="last_session" returns what moved since the previous visit. DCHUB_API_KEY is optional. A key keeps saved shortlists, alerts and tracked changes (get_changes) across sessions. Call get_api_key only if the user asks for a key, then save it and never re-mint; recover_my_key re-sends a lost one. Do not ask the user for an email. If a result is partial, show your user its human_message (or for_your_human) and its link. More detail is at https://dchub.cloud/connect and https://dchub.cloud/pricing. Do not invent withheld numbers. Do not quote prices, plan names or access limits; send the human to those pages instead. Never claim a purchase or full access until a later result is no longer marked as a preview. If data looks wrong or missing, call report_finding; if your human wants something DC Hub does not do, call request_enhancement. Reference: resource dchub://instructions.';

const banned = (text) => CAPABILITIES_BANNED.filter(([, re]) => re.test(String(text))).map(([n]) => n);

let S, stub, prevBase;
beforeAll(async () => {
  stub = http.createServer((_q, r) => { r.writeHead(503); r.end('{}'); });
  await new Promise((ok) => stub.listen(0, '127.0.0.1', ok));
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
}, 60_000);
afterAll(async () => {
  await new Promise((ok) => stub.close(ok));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
});

describe('capabilities instructions', () => {
  it('is the approved paragraph, character for character', () => {
    expect(CAPABILITIES_INSTRUCTIONS).toBe(APPROVED);
  });
  it('carries none of the banned words or shapes', () => {
    expect(banned(CAPABILITIES_INSTRUCTIONS)).toEqual([]);
  });
  it('the banned list catches each shape it names', () => {
    for (const [s, n] of [['$99/mo', 'price'], ['the Pro plan', 'plan name'], ['a free key', 'free'],
      ['1,000 credits', 'credits'], ['7-day trial', 'trial'], ['98 tools', 'tool count'],
      ["get your human's email", 'email ask'], ['until get_access_status confirms it', 'unlisted access tool']]) {
      expect(banned(s), s).toContain(n);
    }
  });
  it('is the lean initialize text, and opens the dchub://instructions resource', () => {
    expect(S._INSTRUCTIONS_LEAN).toBe(APPROVED);
    expect(S._INSTRUCTIONS.startsWith(APPROVED + ' ')).toBe(true);
    expect(banned(S._INSTRUCTIONS)).toEqual([]);
  });
  it('the access block agent note is the purchase rule, which names no tool', () => {
    expect(ACCESS_AGENT_NOTE).toBe(PURCHASE_RULE);
    expect(APPROVED).toContain(PURCHASE_RULE);
  });
});

describe('unlock_more_data', () => {
  it('returns the one human line, /pricing, and a one-sentence what_unlocks', () => {
    const r = S._unlockMoreDataEnvelope({ reason: 'grid depth' });
    const sc = r.structuredContent;
    expect(sc.human_message).toBe('Some DC Hub answers are previews. Open https://dchub.cloud/pricing to see how to get the full results. You can also start at https://dchub.cloud/connect.');
    expect(sc.human_url).toBe('https://dchub.cloud/pricing');
    expect(sc.what_unlocks).toMatch(/^[^.]*https:\/\/dchub\.cloud\/pricing[^.]*\.$/);
    for (const k of ['plans', 'recommended', 'recommended_subscription', 'free_alternative', 'machine_pay', 'for_your_human']) {
      expect(sc, k).not.toHaveProperty(k);
    }
    // The bare /pricing and /connect links are the approved human pointers (owner, 2026-11-26); no other URL rides.
    const urls = [...new Set(JSON.stringify(r).match(/https?:\/\/[^\s"\\)]+/g) || [])].map((u) => u.replace(/[.,;]+$/, ''));
    expect(urls.sort()).toEqual(['https://dchub.cloud/connect', 'https://dchub.cloud/pricing']);
    const all = JSON.stringify(r);
    expect(all).not.toMatch(/\b(?:credits|developer|pro|pro_trial)\b"/i);
    expect(banned(all)).toEqual([]);
  });
});

describe('dchub_services capacity_source', () => {
  it('is the teaser', () => {
    const row = DCHUB_SERVICES.find((s) => s.id === 'capacity_source');
    expect(row.what).toBe('Capacity to buy or lease is coming. Agents can query listings with source_capacity; humans can browse the listings at the link.');
    expect(row.what).not.toMatch(/request_capacity_intro|https?:\/\//);
    expect(row.link.startsWith('https://dchub.cloud/listings?')).toBe(true);
  });
  it('full_depth points at a human page and names no price', () => {
    const row = DCHUB_SERVICES.find((s) => s.id === 'full_depth');
    expect(row.link).toMatch(/^https:\/\/dchub\.cloud\/(?:connect|pricing)\?/);
    expect(banned(JSON.stringify(row))).toEqual([]);
  });
});
