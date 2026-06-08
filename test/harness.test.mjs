// Pure-unit tests for the live-suite resilience helpers (no network). These
// hard-gate CI alongside gating.test.mjs so the retry/skip logic that keeps the
// flaky 1-replica live suite from blocking merges can't silently regress.
import { describe, it, expect } from 'vitest';
import { isTransient, parseRpc } from './live-harness.mjs';

describe('isTransient — transient edge/server blips we should retry', () => {
  it('flags an empty / whitespace-only body (edge dropped the response)', () => {
    expect(isTransient(200, '')).toBe(true);
    expect(isTransient(200, '   \n  ')).toBe(true);
    expect(isTransient(200, undefined)).toBe(true);
  });

  it('flags a "No session" handshake error regardless of status', () => {
    expect(isTransient(400, 'No session')).toBe(true);
    expect(isTransient(200, '{"error":"No session for id"}')).toBe(true);
  });

  it('flags 429 / rate-limit and 5xx upstream errors', () => {
    expect(isTransient(429, 'Too Many Requests')).toBe(true);
    expect(isTransient(200, 'rate limit exceeded')).toBe(true);
    expect(isTransient(503, 'Service Unavailable')).toBe(true);
    expect(isTransient(502, 'Bad Gateway')).toBe(true);
  });

  it('flags Cloudflare edge errors (error 10xx)', () => {
    expect(isTransient(200, 'error 1010')).toBe(true);
    expect(isTransient(200, 'Cloudflare Error 1000')).toBe(true);
  });

  it('does NOT flag a normal 2xx JSON-RPC payload (real data must still assert)', () => {
    expect(isTransient(200, '{"jsonrpc":"2.0","result":{"tools":[]}}')).toBe(false);
    expect(isTransient(200, 'data: {"jsonrpc":"2.0","id":1,"result":{}}')).toBe(false);
  });

  it('does NOT flag a legitimate paid_only / trial gate (those are not transient)', () => {
    // A gate is a real, stable response — handled by isGated, not retried here.
    expect(isTransient(200, '{"error":"paid_only","trial_preview":true}')).toBe(false);
  });
});

describe('parseRpc — JSON + SSE payload extraction', () => {
  it('parses a plain JSON body', () => {
    const p = parseRpc('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}');
    expect(p?.result?.ok).toBe(true);
  });

  it('parses an SSE data: framed body', () => {
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"n":5}}\n\n';
    expect(parseRpc(sse)?.result?.n).toBe(5);
  });

  it('parses a multi-line SSE data: payload', () => {
    const sse = 'data: {"jsonrpc":"2.0",\ndata: "id":3,"result":{"a":1}}\n\n';
    expect(parseRpc(sse)?.result?.a).toBe(1);
  });

  it('returns null for an empty or junk body', () => {
    expect(parseRpc('')).toBe(null);
    expect(parseRpc('not json at all')).toBe(null);
  });
});
