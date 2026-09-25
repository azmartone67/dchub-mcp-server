// ── Grok re-verify after mcp#562/#564 (2026-09-25, 22:24–22:30Z) ──
//
// 1 keyless execute_plan cut machine_pay.covered_tools 13 -> 3, unlocked_tools
//   9 -> 3 and executed[] 4 -> 3: the free preview trim ran over the envelope.
// 2 /mcp/chatgpt get_grid_data carried email_capture, agent_action (POST) and
//   enterprise_note.
// 3 /mcp/chatgpt source_capacity carried sign_in_url, register_interest (POST)
//   and lead-register copy.
// 4 search handed out a slug that 404s on fetch and on the facility page; an
//   unknown id answered an empty record with no isError.
// 5 search answered 2 content items; OpenAI's connector wants exactly one.
// 6 fetch printed 6-decimal coordinates; "relay line" / "layer is locked" copy.
import { describe, it, expect } from 'vitest';
import { trimForTrial, _facilityFetchRecord, _STEP_PROTECTED_KEY_RE } from '../server.mjs';
import { scrubToolResult, scrubText, transformDirectoryBody } from '../lib/chatgpt-directory.mjs';

const tools = (n) => Array.from({ length: n }, (_, i) => 'tool_' + i);

describe('1: the keyless preview never cuts never-cut fields', () => {
  it('machine_pay and unlocked_tools pass through byte-identical', () => {
    const src = { data: tools(12), machine_pay: { price_usd: 0.05, covered_tools: tools(13) },
      unlocked_tools: tools(9), retry_with: { tools: tools(5) } };
    const out = trimForTrial(src, 'get_facility');
    expect(out.data).toHaveLength(3);                     // data still previews
    expect(JSON.stringify(out.machine_pay)).toBe(JSON.stringify(src.machine_pay));
    expect(out.unlocked_tools).toEqual(src.unlocked_tools);
    expect(out.retry_with).toEqual(src.retry_with);
    expect(out._covered_tools_total_in_pro).toBeUndefined();
  });

  it('the execute_plan envelope is not re-trimmed (every step already ran at the caller tier)', () => {
    const env = { _entity: 'plan_execution',
      executed: [1, 2, 3, 4].map((i) => ({ step: i, tool: 't' + i, result: { rows: tools(3) } })),
      machine_pay: { covered_tools: tools(13) } };
    const out = trimForTrial(env, 'execute_plan');
    expect(out.executed).toHaveLength(4);
    expect(out.machine_pay.covered_tools).toHaveLength(13);
  });

  it('step slimming and the preview trim share one never-cut list', () => {
    for (const k of ['machine_pay', 'unlocked_tools', 'for_your_human', 'retry_with', 'persist_command', 'upgrade_url'])
      expect(_STEP_PROTECTED_KEY_RE.test(k), k).toBe(true);
  });
});

const call = (tool, sc) => scrubToolResult({ content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc }, tool);

describe('2: get_grid_data gated block', () => {
  const GATED = { iso: 'PJM', load_mw: 91000, tier_required: 'developer',
    agent_action: { type: 'claim_free_key', method: 'POST', url: 'https://dchub.cloud/api/v1/keys/claim',
      body: { client_name: '<your agent identifier>' } },
    email_capture: { type: 'capture_email_for_free_key', method: 'GET', url: 'https://dchub.cloud/notify?tool=get_grid_data',
      prompt: 'Ask your human: want a free dev key? Drop your email at this URL — it turns this anonymous probe into a tracked account they can manage and upgrade.' },
    enterprise_note: 'Hedge fund / REIT / broker / infra GP? Enterprise data licensing from 12,000/yr. https://dchub.cloud/enterprise',
    gating_matrix: 'https://dchub.cloud/api/v1/gating-matrix',
    learn: { cookbook: 'https://dchub.cloud/api/v1/agent/cookbook' } };

  it('keeps the data, drops capture, write instructions and enterprise copy', () => {
    const all = JSON.stringify(call('get_grid_data', GATED));
    for (const bad of ['email_capture', 'capture_email', 'tracked account', 'agent_action', 'client_name', 'POST',
                       'enterprise', 'gating_matrix', 'cookbook'])
      expect(all, bad).not.toContain(bad);
    expect(all).toContain('91000');
  });
  it('any write instruction goes, whatever its key is called', () => {
    const r = call('get_grid_data', { iso: 'PJM', notify_me: { method: 'POST', path: '/api/v1/alerts', body: { iso: 'PJM' } },
      docs: { method: 'GET', url: 'https://dchub.cloud/docs' } });
    expect(r.structuredContent.notify_me).toBeUndefined();
    expect(r.structuredContent.docs).toBeDefined();
  });
});

describe('3: source_capacity lead-register copy', () => {
  const LISTINGS = { listings: [], count: 0,
    program: { name: 'DC Hub Capacity Source', status: 'upcoming',
      summary: 'Powered land, powered shells and turnkey capacity. Search by size and location. Sign in and accept the introduction terms once to see specs.',
      how_it_works: ['Search listings by size and location, without an account.',
        'Sign in with a free account, or connect an identified AI agent, and accept the introduction terms once.'],
      note: 'The first listings are being onboarded. Register a requirement to get first access when they open.',
      register_interest: { method: 'POST', path: '/api/v1/listings/interest', mcp_tool: 'request_capacity_intro' },
      terms: { version: '1', summary: 'DC Hub records your registration in its lead register and sends the operator your company name.' } },
    viewer: { identified: false, tier: 'anon', sign_in_url: 'https://dchub.cloud/login?next=/listings' } };

  it('drops sign-in, the interest POST and lead-register copy; keeps what the program is', () => {
    const r = call('source_capacity', LISTINGS);
    const all = JSON.stringify(r);
    for (const bad of ['sign_in', 'Sign in', 'register_interest', '/api/v1/listings/interest', 'lead register',
                       'introduction terms', 'Register a requirement', 'POST'])
      expect(all, bad).not.toContain(bad);
    expect(r.structuredContent.program.name).toBe('DC Hub Capacity Source');
    expect(all).toContain('Search listings by size and location');
  });
});

describe('4/6: fetch', () => {
  it('coordinates are 2 dp and approximate, whatever precision the record carried', () => {
    const r = _facilityFetchRecord('8484', { name: 'Level 3 Ashburn', city: 'Ashburn', state: 'VA',
      latitude: 39.022182, longitude: -77.45761, status: 'Operational' }, 'https://dchub.cloud/facility/8484');
    expect(r.text).toMatch(/Approximate location: 39\.02, -77\.46\./);
    expect(r.text).not.toMatch(/39\.0221/);
    expect(r.metadata).toMatchObject({ lat: 39.02, lon: -77.46, coordinates: 'approximate' });
  });

  it('a record without coordinates prints no location', () => {
    const r = _facilityFetchRecord('1', { name: 'X', city: 'Ashburn', state: 'VA' }, 'u');
    expect(r.text).not.toMatch(/location/i);
    expect(r.metadata.lat).toBeUndefined();
  });
});

describe('5: search and fetch answer exactly one content item', () => {
  const gatedSearch = { results: [{ id: '8484', title: 'Level 3 Ashburn', url: 'https://dchub.cloud/facility/8484' }],
    preview_is_partial: true };
  it('no plans line is appended to search or fetch', () => {
    for (const tool of ['search', 'fetch']) {
      const r = call(tool, gatedSearch);
      expect(r.content, tool).toHaveLength(1);
      expect(JSON.parse(r.content[0].text).results[0].id).toBe('8484');
      expect(JSON.stringify(r)).not.toContain('dchub.cloud/plans');
    }
  });
  it('other gated tools still carry the plans line', () => {
    expect(call('get_market_intel', { market: 'x', preview_is_partial: true }).content).toHaveLength(2);
  });
  it('the tool name reaches the scrub through the response body', () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [
      { type: 'text', text: JSON.stringify(gatedSearch) }, { type: 'text', text: 'extra' }] } });
    expect(JSON.parse(transformDirectoryBody(body, 'tools/call', 'search')).result.content).toHaveLength(1);
  });
});

describe('2/3: the same copy in prose (a text block, not a key)', () => {
  it('capture and lead-register sentences are dropped, the data sentence kept', () => {
    expect(scrubText('PJM load is 91 GW. It turns this anonymous probe into a tracked account.')).toBe('PJM load is 91 GW.');
    expect(scrubText('No listings yet. DC Hub records your registration in its lead register.')).toBe('No listings yet.');
    expect(scrubText('Leave your email here to hear first.')).toBe('');
  });
});

describe('6: wording', () => {
  it('relay-line and locked-layer sentences are dropped on the profile', () => {
    expect(scrubText('Ranks markets. Copy the human relay line verbatim.')).toBe('Ranks markets.');
    expect(scrubText('12 markets scored. The decision layer is locked.')).toBe('12 markets scored.');
  });
});
