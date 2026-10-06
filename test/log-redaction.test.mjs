// No session id, API key, bearer token or client IP reaches a server.mjs log line
// (mcp-marketplace.io scan of v2.12.27: 7.0/10, log findings). Helpers are pure; the source
// scan is the guard that a new console line cannot quietly re-introduce the pattern.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { logId, keyKind, scrubLogText } from '../lib/log-redact.mjs';

const SID = '3f2c9a1e-7b4d-4e0a-9c55-0123456789ab';
const KEY = 'dch_live_' + 'AbCdEfGh1234567890ZyXwVu';

describe('logId', () => {
  it('is stable, short, and reveals none of the input', () => {
    const t = logId(SID);
    expect(t).toMatch(/^h-[0-9a-f]{8}$/);
    expect(logId(SID)).toBe(t);
    expect(logId(SID + 'x')).not.toBe(t);
    for (let i = 4; i <= SID.length; i += 2) expect(t.includes(SID.slice(0, i))).toBe(false);
  });
  it('handles absent values', () => {
    expect(logId(undefined)).toBe('-');
    expect(logId(null)).toBe('-');
    expect(logId('')).toBe('-');
  });
});

describe('keyKind', () => {
  it('names only the public prefix, never a secret character', () => {
    expect(keyKind(KEY)).toBe('dch_live_…');
    expect(keyKind('dch_trial_' + 'q'.repeat(30))).toBe('dch_trial_…');
    expect(keyKind('dchub_' + 'z'.repeat(30))).toBe('dchub_…');
    expect(keyKind('somethingelse-secret')).toBe('key');
    expect(keyKind('')).toBe('none');
    expect(keyKind(undefined)).toBe('none');
    expect(keyKind(KEY)).not.toContain('AbCd');
  });
});

describe('scrubLogText', () => {
  it('redacts keys, bearer tokens, JWTs, secret query params, uuids and ipv4', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl';
    const txt = scrubLogText(`failed https://x.test/p?api_key=${KEY}&q=1 Bearer abcdef0123456789 ${jwt} sid ${SID} from 203.0.113.77 ok`);
    expect(txt).not.toContain('AbCdEfGh');
    expect(txt).not.toContain('abcdef0123456789');
    expect(txt).not.toContain('eyJhbGci');
    expect(txt).not.toContain(SID);
    expect(txt).not.toContain('203.0.113.77');
    expect(txt).toContain('failed https://x.test/p?api_key=[redacted]&q=1');   // control: the rest survives
    expect(txt).toContain('[jwt]');
    expect(txt).toContain('[uuid]');
    expect(txt).toContain('[ip]');
  });
  it('takes an Error (stack) or any value without throwing, and keeps ordinary text', () => {
    const e = new Error('upstream said ' + KEY);
    expect(scrubLogText(e)).not.toContain('AbCdEfGh');
    expect(scrubLogText(e)).toContain('upstream said');
    expect(scrubLogText(undefined)).toBe('undefined');
    expect(scrubLogText('version 2.12.27 ready')).toBe('version 2.12.27 ready');
  });
});

describe('server.mjs log lines', () => {
  const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const logLines = src.split('\n').filter((l) => /console\.(log|warn|error|info|debug)\(/.test(l));
  // the shapes that used to print part of a secret or an id
  const BAD = [
    [/\.slice\(0,\s*8\)\}/, 'an 8-char prefix of an id/bearer token'],
    [/\.slice\(0,\s*(?:6|12)\)\s*(?:\}|\+)/, 'a prefix of an api key'],
    [/originalUrl/, 'the full request URL (may carry ?api_key=)'],
    [/\b(?:client_ip|clientIp|remoteAddress|x-forwarded-for)\b/i, 'a client IP'],
  ];
  it('control: the scan sees the log lines, and its patterns catch the old shapes', () => {
    expect(logLines.length).toBeGreaterThan(40);
    expect(BAD[0][0].test('console.log(`sid=${sid.slice(0, 8)}`)')).toBe(true);
    expect(BAD[1][0].test('console.log(`key=${String(key).slice(0, 6)}…`)')).toBe(true);
    expect(BAD[1][0].test("console.log(`key=${apiKey ? apiKey.slice(0,6) + '…' : 'none'}`)")).toBe(true);
    expect(BAD[2][0].test('console.warn(`on ${req.originalUrl}`)')).toBe(true);
    expect(BAD[3][0].test("console.log('ip', req.headers['x-forwarded-for'])")).toBe(true);
    expect(BAD[3][0].test('console.log(`ip=${clientIp}`)')).toBe(true);
  });
  for (const [re, what] of BAD) {
    it(`no console line prints ${what}`, () => {
      const hits = logLines.filter((l) => re.test(l)).map((l) => l.trim().slice(0, 150));
      expect(hits).toEqual([]);
    });
  }
  it('error stacks are scrubbed before they are written', () => {
    const raw = logLines.filter((l) => /\.stack\)\s*\|\|/.test(l) && !/_scrubLog\(/.test(l));
    expect(raw.map((l) => l.trim().slice(0, 150))).toEqual([]);
    expect(logLines.filter((l) => /_scrubLog\(/.test(l)).length).toBeGreaterThanOrEqual(4);
  });
});
