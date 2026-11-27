// invalid-key-notice-wall-copy-v2-1127.test.mjs — stability P3 follow-up (2026-11-27, after mcp#1811).
//
// ★THE BUG. mcp#1811 kept the invalid-key notice's /connect link through the one-link wall rule, but production also
// runs the v2 wall copy (DCHUB_WALL_IDENTITY_V2 on), whose rewriteText sends every human dchub.cloud link to
// /mcp/connect. Live 2026-11-27 23:40Z, keyless canvas with a refused key: "Get a new key at
// https://dchub.cloud/mcp/connect" while initialize said https://dchub.cloud/connect.
//
// ★THE CONTRACT PINNED HERE. rewriteText leaves the one link right after KEY_NOTICE_LEAD as it is and still rewrites
// every other human link. server.mjs's _keyNoticeLine and _oneLinkProse use the same constant (imported from here).
import { describe, it, expect } from 'vitest';
import * as W from '../lib/wall-copy-v2.mjs';
import { KEY_NOTICE_LEAD as SERVER_LEAD } from '../server.mjs';

describe('rewriteText leaves only the key-notice link alone', () => {
  it('keeps the link after the notice lead, rewrites the others', () => {
    const s = "isn't valid, so you're getting keyless results. " + W.KEY_NOTICE_LEAD + 'https://dchub.cloud/connect Until then. '
      + 'Or open https://dchub.cloud/u/ab23cd to see the rest. See https://dchub.cloud/connect too.';
    const t = W.rewriteText(s, { keyless: true });
    expect(t).toContain(W.KEY_NOTICE_LEAD + 'https://dchub.cloud/connect Until');
    expect(t).not.toContain('dchub.cloud/u/ab23cd');
    expect(t).toContain('See https://dchub.cloud/mcp/connect too.');   // non-vacuous: the rewrite still runs
  });
  it('a platform install page after the lead is kept too', () => {
    const t = W.rewriteText(W.KEY_NOTICE_LEAD + 'https://dchub.cloud/install/grok then', { keyless: true });
    expect(t).toBe(W.KEY_NOTICE_LEAD + 'https://dchub.cloud/install/grok then');
  });
  it('server.mjs uses the same lead', () => { expect(SERVER_LEAD).toBe(W.KEY_NOTICE_LEAD); });
});
