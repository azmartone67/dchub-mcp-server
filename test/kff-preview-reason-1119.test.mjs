// kff-preview-reason-1119.test.mjs — Grok's daily MCP leadership note (2026-11-18) item 9: a keyless execute_plan that
// came back at preview depth at 00:33 UTC said only "no key — steps returned preview depth". The note now says why:
// today's plan answer already used, a QA-marked caller (never served it), or an endpoint that does not serve it.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { _kffPreviewReason, _keylessFirstFullCharge } from '../server.mjs';
import { fenceNetwork } from './helpers/claude-directory-harness.mjs';

// Hard gate: the charge's durable-mirror read never leaves loopback.
let fence;
beforeAll(() => { fence = fenceNetwork(); vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 })); });
afterAll(() => { vi.unstubAllGlobals(); if (fence) fence.restore(); });

describe('_kffPreviewReason', () => {
  // Owner 2026-11-23: a full execute_plan needs a paid key, so there is no keyless first full plan to charge or spend.
  it('an outside keyless caller has no reason, the plan cannot be charged, and no "was used" reason appears', async () => {
    const c = { client_ip: '198.51.100.71', user_agent: 'Mozilla/5.0 agent' };
    expect(_kffPreviewReason(c)).toBe('');
    expect(await _keylessFirstFullCharge(c, 'execute_plan', 1)).toBe(false);
    expect(_kffPreviewReason(c)).toBe('');
  });
  it('a QA-marked caller is told it is not served the first full plan answer', () => {
    expect(_kffPreviewReason({ client_ip: '198.51.100.72', qa_header: true })).toBe('a QA-marked caller is not served the first full plan answer');
  });
  it('an endpoint outside the lane says so; a keyed caller has no reason', () => {
    expect(_kffPreviewReason({ client_ip: '198.51.100.73', profile: 'chatgpt' })).toBe('this endpoint does not serve the first full plan answer');
    expect(_kffPreviewReason({ client_ip: '198.51.100.74', api_key: 'k' })).toBe('');
  });
  it('stays on loopback', () => { expect(fence.foreign).toEqual([]); });
});
