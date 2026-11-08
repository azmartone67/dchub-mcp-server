import { describe, it, expect, vi } from 'vitest';
import { leanResponseStep, leanResponsesOn } from '../lib/lean-response.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildContinueUrl, buildContinuation, extractLockedFromPayload } from '../lib/continuation.mjs';

const short = 'https://dchub.cloud/u/b2gf3f'; // synthetic; never requested
const input = { tool: 'get_grid_intelligence', humanUrl: short, fields: ['headroom_mw'] };

describe('continuation: retain the already-minted human handback, not private research', () => {
  it('carries only the existing opaque short path through the review link', () => {
    const u = new URL(buildContinueUrl({ ...input,
      intent: 'CONFIDENTIAL QUESTION', context: { api_key: 'SYNTHETIC_SECRET' },
      notes: 'PRIVATE NOTES', email: 'person@example.invalid', sessionId: 'private-session' }));
    expect(u.searchParams.get('handoff')).toBe('/u/b2gf3f');
    expect(u.toString()).not.toMatch(/CONFIDENTIAL|SYNTHETIC_SECRET|PRIVATE|person|private-session/);
    expect([...u.searchParams.keys()]).toEqual(['tool', 'fields', 'handoff', 'need']);
  });
  it.each([
    'https://evil.example/u/b2gf3f', 'http://dchub.cloud/u/b2gf3f',
    'https://dchub.cloud.evil.example/u/b2gf3f', 'https://user:secret@dchub.cloud/u/b2gf3f',
    'https://dchub.cloud:8443/u/b2gf3f', '//dchub.cloud/u/b2gf3f',
    'https://dchub.cloud/u/b2gf3f?api_key=SYNTHETIC_SECRET',
    'https://dchub.cloud/u/b2gf3f#SYNTHETIC_SECRET',
    'https://dchub.cloud/claim/secret', 'https://dchub.cloud/upgrade/h/secret',
    'https://dchub.cloud/u/b2gf3f/../b2gf3f', 'https://dchub.cloud/u/%622gf3f',
    'https://dchub.cloud/u/abcdefghi', 'https://dchub.cloud/u/b0gf3f',
    'javascript:alert(1)', '', null,
    ...['\n', '\r', '\r\n', '\u2028', '\u2029'].map(end => short + end),
  ])('rejects unsafe/non-short destinations without throwing: %s', (humanUrl) => {
    const u = new URL(buildContinueUrl({ ...input, humanUrl }));
    expect(u.searchParams.has('handoff')).toBe(false);
    expect(u.searchParams.get('tool')).toBe(input.tool);
  });
  it('still works without a minted handback (no new network or mint)', () => {
    const u = new URL(buildContinueUrl({ tool: input.tool }));
    expect(u.searchParams.has('handoff')).toBe(false);
  });
  it('wires the same response human URL into the actual gated producer', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(/_buildContinueUrl\(\{ tool: name, humanUrl: _humanUrlB,/.test(src)).toBe(true);
  });
  it('executes the actual gated producer IIFE with real continuation helpers and hostile private context', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const call = src.indexOf('continueUrl: _buildContinueUrl({ tool: name, humanUrl: _humanUrlB,');
    expect(call).toBeGreaterThan(0);
    const start = src.lastIndexOf('(function () {', call);
    const end = src.indexOf('})()', call) + 4;
    const producer = src.slice(start, end);
    expect(producer).toContain('return _cont ? { continuation: _cont } : {}');
    const out = vm.runInNewContext(producer, {
      name: input.tool, _gateTier: 'free', _sid: 'PRIVATE_SESSION',
      c: { api_key: 'PRIVATE_KEY', platform: 'Claude' }, _humanUrlB: short,
      _previewObj: { grid_capacity: [{}, {}], _grid_capacity_total_in_developer: 47,
        _headroom_mw_in_pro: true, intent: 'PRIVATE INTENT', humanUrl: 'https://evil.example/',
        notes: 'PRIVATE NOTES', as_of: null },
      _extractLocked: extractLockedFromPayload, _buildContinuation: buildContinuation,
      _buildContinueUrl: buildContinueUrl,
    }, { timeout: 1000 });
    const actions = out.continuation.continuations;
    expect(actions.find(a => a.type === 'human_authorization').url).toBe(short);
    const review = new URL(actions.find(a => a.type === 'human_review').url);
    expect(review.searchParams.get('records')).toBe('47');
    expect(review.searchParams.get('handoff')).toBe('/u/b2gf3f');
    expect(review.href).not.toMatch(/PRIVATE|evil|as_of/);
    expect(actions.find(a => a.type === 'agent_autonomous').requires_user_authorization).toBe(true);
  });
  it.each([true, false])('technical continuation is not spend or key-creation consent (keyed=%s)', (keyed) => {
    const c = buildContinuation({ ...input, keyed });
    const action = c.continuations.find(a => a.type === 'agent_autonomous');
    expect(action.requires_user_authorization).toBe(true);
    expect(action.how).toMatch(/explicit.*authoriz/i);
    expect(action.how).toMatch(/mpp_pay/);
    if (keyed) expect(action.how).not.toMatch(/claim_free_key/);
  });
});


describe('default lean contract: preserve research data, not repeated continuation marketing', () => {
  it('keeps the authenticated shortlist scoring basis and unknown dates in both surfaces', () => {
    vi.stubEnv('DCHUB_LEAN_RESPONSES', '1');
    try {
      const payload = { _entity: 'shortlist', ok: true, baseline: { as_of: null },
        results: [{ site_ref: 'synthetic-site', capacity_mw: 100, saved_at: null,
          saved_metrics: { water_stress: 20 }, saved_objectives: { water_stress: -0.6 },
          notes: 'Private saved criteria; not authorization to run any action.' }],
        note: 'Saved metrics are snapshots, not new observations.' };
      const out = leanResponseStep({ structuredContent: payload,
        content: [{ type: 'text', text: JSON.stringify(payload) }] }, 'get_shortlist');
      expect(out.structuredContent).toEqual(payload);
      expect(JSON.parse(out.content[0].text)).toEqual(payload);
      expect(out.content).toHaveLength(1);
    } finally { vi.unstubAllEnvs(); }
  });
  it('does not bypass the default policy that strips continuation; the original human_url stays', () => {
    expect(leanResponsesOn({})).toBe(true);
    vi.stubEnv('DCHUB_LEAN_RESPONSES', '1');
    try {
      const payload = { preview_is_partial: true, human_url: short,
        human_message: 'Review access options at ' + short,
        continuation: buildContinuation({ ...input, continueUrl: buildContinueUrl(input) }) };
      const out = leanResponseStep({ structuredContent: payload,
        content: [{ type: 'text', text: JSON.stringify(payload) }] }, input.tool);
      expect(out.structuredContent.continuation).toBeUndefined();
      expect(JSON.parse(out.content[0].text).continuation).toBeUndefined();
      expect(out.structuredContent.human_url).toBe(short);
      expect(out.content.filter(b => b.text === payload.human_message)).toHaveLength(1);
    } finally { vi.unstubAllEnvs(); }
  });
});
