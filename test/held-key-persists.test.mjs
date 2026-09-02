// held-key-persists.test.mjs — r-held-key (2026-09-02, QA sweep F2)
//
// THE DEFECT. Measured 2026-09-02 00:23Z: free-key agents reuse a key within a
// session 49.2% of the time and across weeks 2.0%; remint_ratio 19.1 and
// worsening. claim_free_key minted a NEW key every session because the only
// reuse branch recognised a key the caller PRESENTED — which a header-less
// host never can. The fix remembers the mint per durable caller fingerprint
// (client IP + client family) and hands THAT key back, `already_held:true`,
// and says so in-band in the session's initialize instructions.
//
// Two layers: the pure helpers are exercised directly; the wiring (where the
// lookup sits relative to the mint, the validity guard, the instructions
// tail) is asserted by anchor over the committed server.mjs, each anchor with
// a vacuity guard that ERRORS when its landmark is missing.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  _callerFingerprint, _rememberHeldKey, _heldKeyFor, _forgetHeldKey, _heldKeys,
  _HELD_KEY_TTL_MS, _HELD_KEY_MAX, _INSTR_TAIL_HELD,
} from '../server.mjs';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs'), 'utf8');

/** Index of the sole occurrence of `needle` inside `hay`; errors on 0 or >1. */
function sole(hay, needle, label) {
  const first = hay.indexOf(needle);
  if (first < 0) throw new Error(`ANCHOR ${label}: not found: ${needle}`);
  if (hay.indexOf(needle, first + 1) >= 0) throw new Error(`ANCHOR ${label}: more than one: ${needle}`);
  return first;
}

beforeEach(() => _heldKeys.clear());

describe('caller fingerprint', () => {
  it('needs a client IP — no IP, no fingerprint (nothing to key on)', () => {
    expect(_callerFingerprint({ platform: 'claude' })).toBeNull();
    expect(_callerFingerprint(null)).toBeNull();
  });
  it('is stable for the same caller and distinct across client families', () => {
    const a = _callerFingerprint({ client_ip: '203.0.113.9', platform: 'claude' });
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(_callerFingerprint({ client_ip: '203.0.113.9', platform: 'Claude' })).toBe(a);   // case-folded family
    expect(_callerFingerprint({ client_ip: '203.0.113.9', platform: 'cursor' })).not.toBe(a);
    expect(_callerFingerprint({ client_ip: '203.0.113.10', platform: 'claude' })).not.toBe(a);
  });
  it('never embeds the raw IP', () => {
    expect(_callerFingerprint({ client_ip: '203.0.113.9', platform: 'claude' })).not.toContain('203.0.113');
  });
});

describe('remembering a held key', () => {
  const fp = _callerFingerprint({ client_ip: '198.51.100.7', platform: 'claude' });
  it('remembers a durable free key and returns it', () => {
    expect(_rememberHeldKey(fp, 'dch_live_abc123', 'free')).toBe(true);
    expect(_heldKeyFor(fp)).toMatchObject({ key: 'dch_live_abc123', tier: 'free' });
  });
  it('NEVER remembers a trial key or a paid tier — a NAT-shared fingerprint must not leak paid access', () => {
    expect(_rememberHeldKey(fp, 'dch_trial_xyz', 'free')).toBe(false);
    expect(_rememberHeldKey(fp, 'dch_live_paid', 'pro')).toBe(false);
    expect(_rememberHeldKey(fp, 'dch_live_paid2', 'developer')).toBe(false);
    expect(_heldKeyFor(fp)).toBeNull();
  });
  it('expires after the TTL and can be forgotten (a revoked key is not handed back)', () => {
    _rememberHeldKey(fp, 'dch_live_old', 'free');
    expect(_heldKeyFor(fp, Date.now() + _HELD_KEY_TTL_MS + 1)).toBeNull();
    _rememberHeldKey(fp, 'dch_live_new', 'free');
    _forgetHeldKey(fp);
    expect(_heldKeyFor(fp)).toBeNull();
  });
  it('is bounded — the map cannot grow past _HELD_KEY_MAX', () => {
    for (let i = 0; i < _HELD_KEY_MAX + 25; i++) _rememberHeldKey('fp' + i, 'dch_live_' + i, 'free');
    expect(_heldKeys.size).toBe(_HELD_KEY_MAX);
    expect(_heldKeyFor('fp0')).toBeNull();                       // FIFO: the oldest went first
    expect(_heldKeyFor('fp' + (_HELD_KEY_MAX + 24))).not.toBeNull();
  });
});

describe('the in-band instructions tail', () => {
  it('names the key, says it is already held, and routes to claim_free_key rather than a re-mint', () => {
    const t = _INSTR_TAIL_HELD('dch_live_held9');
    expect(t).toContain('dch_live_held9');
    expect(t).toContain('already_held');
    expect(t).toContain('claim_free_key');
    expect(t).toMatch(/do not mint|not mint another/i);
  });
  it('is empty without a key (a keyless session gets the unchanged instructions)', () => {
    expect(_INSTR_TAIL_HELD('')).toBe('');
    expect(_INSTR_TAIL_HELD(null)).toBe('');
  });
});

describe('wiring in server.mjs (anchored on the committed source)', () => {
  // The claim_free_key tool body: from its trackedTool registration to the
  // next trackedTool registration.
  const start = sole(SRC, "trackedTool(srv, 'claim_free_key',", 'claim tool start');
  const end = SRC.indexOf('trackedTool(srv, ', start + 1);
  const TOOL = SRC.slice(start, end);

  it('claim_free_key consults the held-key map BEFORE it mints', () => {
    const lookup = sole(TOOL, '_heldKeyFor(_fp)', 'held lookup');
    const mint = sole(TOOL, "callAPIWrite('/api/v1/keys/claim', body)", 'mint');
    expect(lookup).toBeLessThan(mint);
  });
  it('returns the held key flagged already_held; a REJECTED key is forgotten and re-minted', () => {
    const rejected = sole(TOOL, 'if (_v && _v.key_rejected) {', 'rejection guard');
    const forget = sole(TOOL, '_forgetHeldKey(_fp);', 'forget');
    const flag = sole(TOOL, 'already_held:            true', 'already_held flag');
    expect(rejected).toBeLessThan(forget);
    expect(forget).toBeLessThan(flag);
  });
  it('the install artifact and the session auto-bind ride ONLY on a confirmed key', () => {
    const ok = sole(TOOL, 'const _ok = !!(_v && _v.valid);', 'confirmed flag');
    const bind = sole(TOOL, '_m1.api_key = _e.key;', 'auto-bind');
    const artifact = sole(TOOL, 'for_your_human: _connectRelay(_e.key, _via)', 'artifact');
    expect(ok).toBeLessThan(bind);
    expect(TOOL.slice(ok, bind)).toContain('if (_ok) {');
    const gate = TOOL.lastIndexOf('...(_ok ? {', artifact);
    expect(gate).toBeGreaterThan(ok);
    expect(TOOL.slice(gate, artifact)).not.toContain('}');       // inside the _ok spread
    expect(TOOL).toContain('key_confirmed:           _ok,');
  });
  it('remembers every fresh mint for the fingerprint', () => {
    const mint = sole(TOOL, "callAPIWrite('/api/v1/keys/claim', body)", 'mint');
    const remember = sole(TOOL, '_rememberHeldKey(_fp, key,', 'remember');
    expect(remember).toBeGreaterThan(mint);
  });
  it('a keyless initialize gets the held key in-band, a keyed one never does', () => {
    const i = sole(SRC, 'const mcpServer = createServer(_descOverrides, _instrTail);', 'per-session createServer');
    const window = SRC.slice(Math.max(0, i - 900), i);
    expect(window).toContain('if (!apiKey) {');
    expect(window).toContain('_instrTail = _INSTR_TAIL_HELD(_held.key)');
    expect(SRC).toMatch(/instructions: _INSTRUCTIONS \+ \(\(typeof instructionsTail === 'string'\) \? instructionsTail : ''\)/);
  });
});
