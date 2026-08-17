/**
 * r-mpp-arg-channel (2026-08-17) — THE PAYMENT SIGNAL MUST BE REACHABLE BY A MODEL.
 *
 * WHAT SHIPPED BROKEN. Every instruction this rail publishes told the agent to
 * put the payment signal in `_meta`: `_meta.mpp_pay=true`, then
 * `_meta["org.paymentauth/credential"]`. `_meta` is JSON-RPC params-level
 * (`params._meta`) and is written by the MCP CLIENT LIBRARY. A model emitting a
 * tool call controls exactly one field: `arguments`. The one revenue path that
 * needs no human was documented in a channel its audience cannot write.
 *
 * WHY IT LOOKED FIXED FOR TWO MONTHS. `mppWantsChallenge` has read
 * `args.mpp_pay` since f845d94 (2026-06-21). It could never fire: the SDK
 * validates `params.arguments` with `safeParseAsync(z.object(shape))` and hands
 * the callback `parseResult.data`, and zod STRIPS undeclared keys. Reading a
 * param is not declaring it — and only the declaration survives validation.
 *
 * WHAT THIS GUARD PINS, in both directions:
 *   1. MECHANISM — through the REAL SDK, over a real transport: a tool that
 *      declares mppArgShape() RECEIVES the payment args; the identical tool
 *      without it receives NOTHING. Assertion (2) is what makes this file
 *      non-vacuous: it reproduces the original bug and would pass trivially if
 *      the SDK ever stopped stripping.
 *   2. WIRING — server.mjs merges that shape, derived from isMppTool(), so the
 *      declaration cannot drift from the price table.
 *   3. HYGIENE — the credential is lifted OUT of args before the digest, the
 *      handler (which forwards args to a REST query string) and the telemetry
 *      log can see it, and the call digest is IDENTICAL whether payment was
 *      signalled or not. Otherwise an honest retry reads as "spent on a
 *      DIFFERENT call".
 *   4. CONSENT — unchanged by the new channel: mpp_pay is quote-intent, never
 *      pay-intent, in args exactly as in _meta.
 *
 * Pure-local: no network, no sidecar, no Stripe, no money.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');
let mpp;

beforeAll(async () => {
  // ARMED, not dark: a guard that only passes while the feature is off is vacuous.
  process.env.MPP_ENABLED = '1';
  process.env.MPP_SIDECAR_URL = 'http://127.0.0.1:1';   // never dialled here
  mpp = await import('../mpp-hook.mjs');
});

/** Register one tool and call it through the real SDK; return what the handler saw. */
async function callThroughSdk(shape, args) {
  const srv = new McpServer({ name: 'guard', version: '0' });
  let seen = null;
  srv.tool('probe_site', 'guard probe', shape, async (a) => {
    seen = a;
    return { content: [{ type: 'text', text: 'ok' }] };
  });
  const client = new Client({ name: 'guard-client', version: '0' });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([srv.connect(serverT), client.connect(clientT)]);
  await client.callTool({ name: 'probe_site', arguments: args });
  return seen;
}

const BASE_SHAPE = { lat: z.number().optional(), lon: z.number().optional() };

describe('r-mpp-arg-channel: the model-writable channel exists', () => {
  it('DECLARED payment params survive SDK validation and reach the handler', async () => {
    const seen = await callThroughSdk(
      { ...BASE_SHAPE, ...mpp.mppArgShape() },
      { lat: 39.96, lon: -82.99, [mpp.MPP_ARG_PAY]: true, [mpp.MPP_ARG_CRED]: 'spt_token_abc' },
    );
    expect(seen, 'handler never ran').toBeTruthy();
    expect(seen[mpp.MPP_ARG_PAY], 'mpp_pay was stripped despite being declared').toBe(true);
    expect(seen[mpp.MPP_ARG_CRED]).toBe('spt_token_abc');
  });

  it('UNDECLARED payment params are stripped — the exact bug that shipped', async () => {
    // The negative half. If this ever fails, zod stopped stripping and the
    // positive test above proves nothing about the declaration.
    const seen = await callThroughSdk(
      BASE_SHAPE,
      { lat: 39.96, lon: -82.99, [mpp.MPP_ARG_PAY]: true, [mpp.MPP_ARG_CRED]: 'spt_token_abc' },
    );
    expect(seen).toBeTruthy();
    expect(seen[mpp.MPP_ARG_PAY], 'undeclared key survived — reproduce the strip or this file is vacuous').toBeUndefined();
    expect(seen[mpp.MPP_ARG_CRED]).toBeUndefined();
  });

  it('the shape declares exactly the canonical arg names, and accepts the wire types', async () => {
    const shape = mpp.mppArgShape();
    expect(Object.keys(shape).sort()).toEqual([...mpp.MPP_ARG_KEYS].sort());
    // A boolean true and a token string must both pass validation, or the
    // declaration is present and still unusable.
    const ok = await callThroughSdk({ ...BASE_SHAPE, ...shape }, { [mpp.MPP_ARG_PAY]: true });
    expect(ok[mpp.MPP_ARG_PAY]).toBe(true);
    const ok2 = await callThroughSdk({ ...BASE_SHAPE, ...shape }, { [mpp.MPP_ARG_CRED]: 'tok' });
    expect(ok2[mpp.MPP_ARG_CRED]).toBe('tok');
  });

  it('the lifted signal — not raw args — is what both readers receive', () => {
    // M8/M9 in the mutation sweep: reverting either call site to `args` left all
    // 60 tests green. That is the ORIGINAL bug's shape exactly — after the lift,
    // `args` no longer carries the keys, so a reader handed `args` silently sees
    // nothing, forever, while the code reads as if it works.
    const src = readFileSync(SERVER, 'utf8');
    const lift = src.match(/const\s+(\w+)\s*=\s*mppTakeArgSignal\s*\(\s*args\s*\)/);
    expect(lift, 'the payment signal is never lifted out of args').toBeTruthy();
    const sig = lift[1];

    // Derived from the lift statement rather than hardcoded, so renaming the
    // variable does not fail this guard for the wrong reason.
    for (const fn of ['mppCredential', 'mppWantsChallenge']) {
      const sites = src.split('\n')
        .map((text, i) => ({ line: i + 1, text }))
        .filter((r) => new RegExp(String.raw`\b${fn}\s*\(`).test(r.text)
                       && !/^\s*(\*|\/\/)/.test(r.text) && !/^import\b/.test(r.text.trim()));
      expect(sites.length, `no ${fn}() call site found — guard is vacuous`).toBeGreaterThan(0);
      for (const s of sites) {
        expect(s.text, `${fn} at server.mjs:${s.line} is not reading the lifted signal`)
          .toMatch(new RegExp(String.raw`\b${fn}\s*\(\s*extra\s*,\s*${sig}\s*\)`));
      }
    }

    // The lift must precede both readers, or they read a signal that is not there yet.
    expect(src.indexOf('mppTakeArgSignal')).toBeLessThan(src.indexOf('mppCredential(extra'));
  });

  it('every payable tool gets the declaration, derived from the price table', () => {
    const src = readFileSync(SERVER, 'utf8');
    // The merge must be keyed on isMppTool (the price table) — not a hand-listed
    // set that can drift from the tools the sidecar will actually accept.
    expect(src, 'trackedTool no longer merges mppArgShape() for payable tools')
      .toMatch(/isMppTool\s*\(\s*name\s*\)[\s\S]{0,200}?\{\s*\.\.\.schema\s*,\s*\.\.\.mppArgShape\s*\(\s*\)\s*\}/);
    // ...and it must sit in trackedTool, BEFORE the param-key capture, or the
    // declared params never reach the registered schema.
    const merge = src.indexOf('...mppArgShape()');
    const capture = src.indexOf('_TOOL_PARAM_KEYS.set(name, new Set(Object.keys(schema)))');
    expect(merge, 'mppArgShape() merge not found').toBeGreaterThan(-1);
    expect(capture, 'param-key capture not found').toBeGreaterThan(-1);
    expect(merge, 'merge must precede the param-key capture').toBeLessThan(capture);
  });
});

describe('r-mpp-arg-channel: the credential never leaks into args', () => {
  it('lifts and DELETES both keys from the args object', () => {
    const args = { lat: 1, lon: 2, [mpp.MPP_ARG_PAY]: true, [mpp.MPP_ARG_CRED]: 'spt_x' };
    const sig = mpp.mppTakeArgSignal(args);
    expect(sig[mpp.MPP_ARG_PAY]).toBe(true);
    expect(sig[mpp.MPP_ARG_CRED]).toBe('spt_x');
    // The load-bearing half: handlers forward args to callAPI() as a query
    // string, and trackToolCall logs `params: args`. A credential left here is a
    // bearer secret in a URL and in a log line.
    expect(Object.keys(args).sort()).toEqual(['lat', 'lon']);
  });

  it('leaves a call with no payment signal completely untouched', () => {
    const args = { lat: 1, lon: 2 };
    const sig = mpp.mppTakeArgSignal(args);
    expect(args).toEqual({ lat: 1, lon: 2 });
    expect(sig[mpp.MPP_ARG_PAY]).toBe(false);
    expect(sig[mpp.MPP_ARG_CRED]).toBeNull();
  });

  it('digests the SAME call identically however payment was signalled', () => {
    // One payment covers one call. If the signal contaminated the digest, the
    // paid retry would hash differently from the call it paid for and the
    // sidecar would report it as spent on a DIFFERENT call.
    const plain = { lat: 39.96, lon: -82.99 };
    const paying = { lat: 39.96, lon: -82.99, [mpp.MPP_ARG_PAY]: true, [mpp.MPP_ARG_CRED]: 'spt_x' };
    mpp.mppTakeArgSignal(paying);
    expect(mpp.mppCallDigest('analyze_site', paying)).toBe(mpp.mppCallDigest('analyze_site', plain));
  });

  it('survives shapes that are not plain objects', () => {
    for (const bad of [undefined, null, 'str', 42, ['a']]) {
      const sig = mpp.mppTakeArgSignal(bad);
      expect(sig[mpp.MPP_ARG_PAY]).toBe(false);
      expect(sig[mpp.MPP_ARG_CRED]).toBeNull();
    }
  });
});

describe('r-mpp-arg-channel: consent is unchanged by the new channel', () => {
  it('reads a credential presented in args', () => {
    const sig = mpp.mppTakeArgSignal({ [mpp.MPP_ARG_CRED]: 'spt_from_args' });
    expect(mpp.mppCredential(undefined, sig)).toBe('spt_from_args');
  });

  it('treats the mpp_pay ARGUMENT as quote-intent, NEVER as pay-intent', () => {
    // The whole point of the consent invariant, ported to the arg channel: an
    // agent asking for a PRICE has not authorized a charge.
    const sig = mpp.mppTakeArgSignal({ [mpp.MPP_ARG_PAY]: true });
    expect(mpp.mppWantsChallenge(undefined, sig)).toBe(true);
    expect(mpp.mppCredential(undefined, sig), 'quote-intent must not authorize a charge').toBeNull();
  });

  it('does not accept an empty or non-token credential from args', () => {
    for (const v of ['', '   ', null, undefined, false, 0]) {
      const sig = mpp.mppTakeArgSignal({ [mpp.MPP_ARG_CRED]: v });
      expect(mpp.mppCredential(undefined, sig), `"${String(v)}" must not authorize a charge`).toBeNull();
    }
  });

  it('_meta wins when both channels carry a credential', () => {
    const sig = mpp.mppTakeArgSignal({ [mpp.MPP_ARG_CRED]: 'from_args' });
    const extra = { _meta: { [mpp.MPP_CRED_KEY]: 'from_meta' } };
    expect(mpp.mppCredential(extra, sig)).toBe('from_meta');
  });
});

describe('r-mpp-arg-channel: the published recipe names the reachable channel', () => {
  /**
   * Strip every _meta-qualified mention, THEN require the bare argument name.
   *
   * Written this way because the obvious assertion is vacuous: `mpp_pay` is a
   * SUBSTRING of `_meta.mpp_pay`, so `expect(how).toContain('mpp_pay')` passes
   * on the very text this guard exists to reject. Caught by mutation M5 —
   * reverting `how` to the _meta-only recipe left all 35 tests green.
   */
  const bareArgsOnly = (s) => String(s).replace(/_meta(\.|\[)[^\s,)\]]*/g, '‹meta›');

  it('the two-step hint tells the agent to use the payment ARGUMENTS', () => {
    // The defect was never only plumbing — it was the instruction. An agent that
    // follows `how` verbatim must land on a channel it can actually write.
    const hint = mpp.mppAdvertiseHint('analyze_site');
    const how = bareArgsOnly(hint.how);
    expect(how, 'the recipe names mpp_pay only in its unreachable _meta form').toContain(mpp.MPP_ARG_PAY);
    expect(how, 'the recipe names the credential only in its unreachable _meta form').toContain(mpp.MPP_ARG_CRED);
    expect(hint.credential_arg).toBe(mpp.MPP_ARG_CRED);
    expect(hint.pay_arg).toBe(mpp.MPP_ARG_PAY);
    // _meta stays documented for SDK-level clients — this is additive, not a swap.
    expect(hint.credential_meta_key).toBe(mpp.MPP_CRED_KEY);
  });

  it('the ONE-STEP offer — the recipe agents actually meet at the wall — does too', async () => {
    // mppOffer is the primary published surface (agent_payment.how + pay_now.steps).
    // Stub sidecar so the inline challenge path is the one under test, not the
    // degraded fallback.
    const srv = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, price_usd: '0.50', challenge: { id: 'CH', method: 'stripe' } }));
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    process.env.MPP_SIDECAR_URL = `http://127.0.0.1:${srv.address().port}`;
    try {
      const offer = await mpp.mppOffer('analyze_site');
      expect(offer.challenges, 'stub sidecar did not mint — this test would assert on the fallback shape').toBeTruthy();
      expect(bareArgsOnly(offer.how)).toContain(mpp.MPP_ARG_CRED);
      expect(bareArgsOnly(offer.pay_now.steps.join(' | '))).toContain(mpp.MPP_ARG_CRED);
      expect(offer.pay_now.credential_arg).toBe(mpp.MPP_ARG_CRED);
      expect(bareArgsOnly(offer.refresh_challenge)).toContain(mpp.MPP_ARG_PAY);
    } finally {
      srv.close();
      process.env.MPP_SIDECAR_URL = 'http://127.0.0.1:1';
    }
  });

  it('server.mjs advertises the arg names at the wall, not just in _meta prose', () => {
    const src = readFileSync(SERVER, 'utf8');
    // _wallMachinePay is the block seven external agents read in 2026-08 and
    // none could act on. It must name the argument channel.
    const wall = src.slice(src.indexOf('function _wallMachinePay'), src.indexOf('function buildHumanRelay'));
    expect(wall, '_wallMachinePay not found').toBeTruthy();
    // Pin the ACTIONABLE fields, not merely that the identifiers appear somewhere
    // in the block: mutation M7 reverted `how` to the _meta literal and survived,
    // because the prose in `note` still mentioned both constants.
    expect(wall, 'the wall `how` no longer names the argument channel')
      .toMatch(/how:[^\n]*\$\{MPP_ARG_PAY\}/);
    expect(wall, 'the wall block no longer publishes the machine-readable arg names')
      .toMatch(/pay_arg:\s*MPP_ARG_PAY/);
    expect(wall).toMatch(/credential_arg:\s*MPP_ARG_CRED/);
  });
});
