// Registered /mcp transport -> actual gated producer -> one-link wall ->
// _wallOuterStep/shortWallLinkStep -> source/lean/next-call. All remote-looking
// URLs are inert values; mint, backend and event receivers are LOOPBACK only.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { shortWallLinkStep } from '../lib/short-wall-link.mjs';
import { buildContinuation, buildContinueUrl } from '../lib/continuation.mjs';
import { splitLeadingJson } from '../lib/facility-location.mjs';
const SHORT = 'https://dchub.cloud/u/b2gf3f';
const LONG = 'https://dchub.cloud/upgrade/h/QUJDfGdldF9ncmlk.0123456789abcdef0123456789abcdef';
let H, fence, mode = 'ok', targets = [];
const review = sc => sc.continuation?.continuations?.find(a => a.type === 'human_review');
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    // These opt-outs expose the existing review action. The DEFAULT one-link
    // and lean controls below prove we do NOT reintroduce it when stripped.
    env: { DCHUB_LEAN_RESPONSES: '0', DCHUB_WALL_ONE_LINK: '0', DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0' },
    extraRoutes(path, _req, body) {
      if (path !== '/api/v1/relay/short') return undefined;
      targets.push(body.relay_url);
      if (mode === 'error') return { status: 503, body: { error: 'offline fixture' } };
      if (mode === 'missing') return { status: 200, body: { ok: true } };
      return { status: 200, body: { ok: true, url: mode === 'ok' ? SHORT : mode === 'long' ? body.relay_url : mode } };
    },
  });
}, 60000);
afterEach(() => { vi.unstubAllEnvs(); mode = 'ok'; targets = []; });
afterAll(async () => {
  if (H) await H.stop();
  if (fence) { const foreign = [...fence.foreign]; fence.restore(); expect(foreign).toEqual([]); }
});
async function call() {
  let headers = { 'user-agent': 'Claude-User' };
  const init = await H.init('/mcp', 'pipeline-client', headers);
  const sid = init.headers.get('mcp-session-id');
  if (sid) headers = { ...headers, 'mcp-session-id': sid };
  const response = await H.call('/mcp', 'get_grid_intelligence', { iso: 'ERCOT' }, headers);
  expect(response.msg?.result).toBeTruthy();
  return response.msg.result;
}
function consent(sc) {
  expect(sc.continuation.continuations.find(a => a.type === 'agent_autonomous')?.requires_user_authorization).toBe(true);
}
const humanLines = r => r.content.flatMap(b => (splitLeadingJson(b.text)?.rest ?? b.text ?? '').split('\n'))
  .filter(line => line.includes('→ **For your human:**'));

describe('real registered wall/continuation pipeline', () => {
  it('binds the surviving review to the one actual minted handback AFTER the long-URL producer', async () => {
    const r = await call(), sc = r.structuredContent;
    expect(sc.human_url).toBe(SHORT);
    expect(targets).toHaveLength(1); // no additional mint for continuation
    const target = new URL(targets[0]);
    expect(target.pathname).toMatch(/^\/upgrade\/h\//);
    expect(target.searchParams.has('buy')).toBe(false);
    expect(target.searchParams.get('via')).toBe('mcp-wall');
    expect(target.searchParams.get('wall')).toBeTruthy();
    expect(review(sc), 'review survives only with the one-link opt-out').toBeTruthy();
    const url = new URL(review(sc).url);
    expect(url.searchParams.get('handoff')).toBe('/u/b2gf3f');
    expect(url.searchParams.get('tool')).toBe('get_grid_intelligence');
    expect(url.searchParams.get('fields')).toContain('generation_mix_mw');
    expect(url.href).not.toMatch(/PLANTED|test-internal|upgrade%2Fh|session|api_key/);
    expect(sc.continuation.continuations.find(a => a.type === 'human_authorization').url).toBe(SHORT);
    consent(sc);
  });
  it.each(['error', 'missing', 'long',
    'https://evil.example/u/b2gf3f',
    SHORT + '?api_key=SYNTHETIC_SECRET', SHORT + '#SYNTHETIC_SECRET', SHORT + '\n',
    'https://dchub.cloud:8443/u/b2gf3f', 'https://dchub.cloud/u/abcdefghi',
  ])('mint failure, missing or unsafe short URL (%s): existing generic review, one attempt, no private handoff', async failure => {
    mode = failure;
    const r = await call(), sc = r.structuredContent;
    expect(targets).toHaveLength(1);
    expect(sc.human_url).toMatch(/^https:\/\/dchub\.cloud\/upgrade\/h\//);
    expect(new URL(sc.human_url).searchParams.has('buy')).toBe(false);
    expect(review(sc)).toBeTruthy();
    expect(new URL(review(sc).url).searchParams.has('handoff')).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/SYNTHETIC_SECRET|evil\.example|:8443/);
    consent(sc);
  });
  it('shortening kill switch retains generic review and does not mint a continuation link', async () => {
    vi.stubEnv('DCHUB_WALL_SHORT_ALL', '0');
    const r = await call(), sc = r.structuredContent;
    expect(targets).toHaveLength(0);
    expect(sc.human_url).toContain('/upgrade/h/');
    expect(new URL(review(sc).url).searchParams.has('handoff')).toBe(false);
    consent(sc);
  });
  it('DEFAULT single-CTA wall already removes human_review before shortening; do not put it back', async () => {
    vi.stubEnv('DCHUB_WALL_ONE_LINK', undefined);
    const r = await call(), sc = r.structuredContent;
    expect(sc.human_url).toBe(SHORT);
    expect(targets).toHaveLength(1);
    expect(sc.continuation).toBeTruthy(); // lean is still off, so isolate one-link policy
    expect(review(sc)).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('/continue');
    expect(humanLines(r)).toHaveLength(1);
    consent(sc);
  });
  it('DEFAULT lean removes the entire continuation even when one-link is off', async () => {
    vi.stubEnv('DCHUB_LEAN_RESPONSES', undefined);
    const r = await call(), sc = r.structuredContent;
    expect(sc.human_url).toBe(SHORT);
    expect(targets).toHaveLength(1);
    expect(sc.continuation).toBeUndefined();
    expect(splitLeadingJson(r.content[0].text).json.continuation).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('/continue');
    expect(humanLines(r)).toHaveLength(1);
  });
});

function wall(humanUrl = LONG) {
  const sc = { human_url: humanUrl, preview_is_partial: true, source: { as_of: null },
    continuation: buildContinuation({ tool: 'get_grid_intelligence', humanUrl,
      continueUrl: buildContinueUrl({ tool: 'get_grid_intelligence', agent: 'Claude', fields: ['headroom_mw'] }) }) };
  return { structuredContent: sc, content: [{ type: 'text', text: JSON.stringify(sc) },
    { type: 'text', text: '→ **For your human:** review ' + humanUrl }] };
}
describe('post-mint handback metadata boundaries (not a replacement for transport tests)', () => {
  it.each([LONG, SHORT])('updates existing review in structuredContent AND leading JSON, no extra mint (%s)', async humanUrl => {
    const mint = vi.fn(async () => SHORT), input = wall(humanUrl), before = JSON.stringify(input);
    const r = await shortWallLinkStep(input, { mint });
    expect(mint).toHaveBeenCalledTimes(humanUrl === LONG ? 1 : 0);
    for (const sc of [r.structuredContent, splitLeadingJson(r.content[0].text).json]) {
      const url = new URL(review(sc).url);
      expect(url.searchParams.get('handoff')).toBe('/u/b2gf3f');
      expect(url.searchParams.get('agent')).toBe('Claude');
      expect(url.searchParams.get('fields')).toBe('headroom_mw');
      expect(sc.source.as_of).toBeNull();
      consent(sc);
    }
    expect(r.content).toHaveLength(input.content.length);
    expect(JSON.stringify(input)).toBe(before);
    expect(await shortWallLinkStep(r, { mint })).toEqual(r); // idempotent, no second mint
    expect(mint).toHaveBeenCalledTimes(humanUrl === LONG ? 1 : 0);
  });
  it.each([undefined, null, '', 'https://evil.example/u/b2gf3f',
    SHORT + '?key=private', SHORT + '#private', SHORT + '\n',
    'https://user:secret@dchub.cloud/u/b2gf3f', 'https://dchub.cloud/u/%622gf3f',
    'https://dchub.cloud/u/b2gf3f/../b2gf3f',
  ])('no new path: missing or unsafe existing human_url (%s) is never minted or attached', async humanUrl => {
    const input = wall(SHORT);
    input.structuredContent.human_url = humanUrl;
    input.content[0].text = JSON.stringify(input.structuredContent);
    const mint = vi.fn();
    expect(await shortWallLinkStep(input, { mint })).toEqual(input);
    expect(mint).not.toHaveBeenCalled();
  });
  it('existing short handback plus kill switch: no metadata rewrite and no mint', async () => {
    const input = wall(SHORT), mint = vi.fn();
    expect(await shortWallLinkStep(input, { mint, env: { DCHUB_WALL_SHORT_ALL: '0' } })).toBe(input);
    expect(mint).not.toHaveBeenCalled();
  });
  it.each([undefined, null, {}, { continuations: null }, { continuations: [] },
    { continuations: [null, 'legacy', { type: 'human_review' }] },
  ])('does not create a review action or reject malformed/absent legacy metadata (%j)', async continuation => {
    const input = wall(SHORT);
    input.structuredContent.continuation = continuation;
    input.content[0].text = JSON.stringify(input.structuredContent);
    const mint = vi.fn();
    expect(await shortWallLinkStep(input, { mint })).toEqual(input);
    expect(mint).not.toHaveBeenCalled();
  });
  it.each([
    'https://evil.example/continue?tool=x', 'http://dchub.cloud/continue?tool=x',
    'https://user:secret@dchub.cloud/continue?tool=x',
    'https://dchub.cloud:8443/continue?tool=x',
    'https://dchub.cloud/continue?tool=x#secret',
    'https://dchub.cloud/continue?tool=x&api_key=secret',
    'https://dchub.cloud/continue?tool=x&intent=private',
    'https://dchub.cloud/x/../continue?tool=x',
    'https://dchub.cloud/continue?tool=x\n', 'not a url',
  ])('does not promote a foreign, noncanonical, private or malformed review destination (%s)', async url => {
    const input = wall(SHORT);
    review(input.structuredContent).url = url;
    input.content[0].text = JSON.stringify(input.structuredContent);
    const mint = vi.fn();
    expect(await shortWallLinkStep(input, { mint })).toEqual(input);
    expect(mint).not.toHaveBeenCalled();
  });
});
