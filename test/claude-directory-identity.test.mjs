// /mcp/claude tells the caller whether its key arrived (2026-11-26).
// The shared directory scrub drops `identity`, so a keyed Claude connector and an anonymous one got the
// same envelope and nobody could tell which one a response came from. lib/claude-directory.mjs
// withClaudeIdentity puts back { tier, credential_source } and nothing else.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { withClaudeIdentity } from '../lib/claude-directory.mjs';

const DIR = '/mcp/claude';
let H, fence;
beforeAll(async () => { fence = fenceNetwork(); H = await startHarness(); });
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

const idOf = (r) => r.msg && r.msg.result && r.msg.result.structuredContent && r.msg.result.structuredContent.identity;
const ARGS = { lat: 39.04, lon: -77.48 };

describe('/mcp/claude identity block', () => {
  it('a keyed call says the key arrived, and at which tier', async () => {
    const r = await H.call(DIR, 'analyze_site', ARGS, { 'x-api-key': PRO_KEY });
    expect(idOf(r)).toEqual({ tier: 'pro', credential_source: 'header' });
  });
  it('a ?api_key= call names the query channel', async () => {
    const r = await H.call(`${DIR}?api_key=${PRO_KEY}`, 'analyze_site', ARGS);
    expect(idOf(r)).toMatchObject({ credential_source: 'query', tier: 'pro' });
  });
  it('an anonymous call says none, so the two are told apart', async () => {
    const r = await H.call(DIR, 'analyze_site', ARGS);
    const id = idOf(r);
    expect(id && id.credential_source).toBe('none');
    expect(id.tier).not.toBe('pro');
  });
  it('carries only the fixed fields: no key, prose, quota or session plumbing', async () => {
    const r = await H.call(DIR, 'analyze_site', ARGS, { 'x-api-key': PRO_KEY });
    const id = idOf(r);
    expect(Object.keys(id).every((k) => ['tier', 'credential_source', 'credential_refused', 'credential_unverified'].includes(k))).toBe(true);
    expect(JSON.stringify(id)).not.toContain(PRO_KEY);
    expect(r.body).not.toMatch(/"means"\s*:/);
  });
  it('kill switch DCHUB_CLAUDE_IDENTITY=0 restores the old envelope', async () => {
    process.env.DCHUB_CLAUDE_IDENTITY = '0';
    try {
      const r = await H.call(DIR, 'analyze_site', ARGS, { 'x-api-key': PRO_KEY });
      expect(idOf(r)).toBeUndefined();
    } finally { delete process.env.DCHUB_CLAUDE_IDENTITY; }
  });
});

describe('withClaudeIdentity (unit)', () => {
  const out = { structuredContent: { a: 1 } };
  it('drops values outside the fixed lists', () => {
    expect(withClaudeIdentity(out, { structuredContent: { identity: { credential_source: 'evil<script>', tier: 'pro' } } }, {})).toBe(out);
    const r = withClaudeIdentity(out, { structuredContent: { identity: { credential_source: 'header', tier: 'Pro Plus $99' } } }, {});
    expect(r.structuredContent.identity).toEqual({ credential_source: 'header' });
  });
  it('flags a refused or unverified key without the prose', () => {
    const r = withClaudeIdentity(out, { structuredContent: { identity: { credential_source: 'header', tier: 'free',
      credential_refused: 'rejected', means: 'long prose', key_status: 'x' } } }, {});
    expect(r.structuredContent.identity).toEqual({ tier: 'free', credential_source: 'header', credential_refused: true });
  });
  it('leaves odd input alone', () => {
    expect(withClaudeIdentity(null, {}, {})).toBe(null);
    expect(withClaudeIdentity(out, null, {})).toBe(out);
    expect(withClaudeIdentity({ content: [] }, { structuredContent: { identity: { credential_source: 'none' } } }, {})).toEqual({ content: [] });
  });
});
