// pack-is-not-an-unlock.test.mjs — r-sku-wall, 2026-09-24
//
// Owner decision (2026-09-24): the $10 pack is sold as API credits paid PER
// CALL, never as an unlock. The mechanism is unchanged: a positive balance
// still serves a gated/Pro-only tool in full at CREDIT_HEAVY cost. Only the
// words changed. Pro keeps its unlock wording.
//
// MEASURED LIVE before this change, anonymous tools/call:
//   get_grid_intelligence → "full per-ISO depth … is one click: 💳 $10 one-time"
//   get_fiber_intel       → "Full set + every premium tool: your human unlocks
//                            in one click — $10 one-time = 1,000 API credits"
//
// Two layers, because either alone can pass on nothing:
//   1. the rendered walls (trialHeader, _rungsText) carry the pack rung and do
//      not call it an unlock;
//   2. a source scan: no "unlock" word within 160 characters of any pack
//      mention in code (comments and the tool name `unlock_more_data` excepted).
// Plus the CTA dedupe detector must still recognise the reworded gap line, or
// a second payment ask stacks under it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { _ctxALS, trialHeader, _rungsText, _hasHumanCta } from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const UNLOCK = /\bunlock(?:s|ed|ing)?\b(?!_more_data)/i;
const PACK = /\$10 one-time|_rungsText\(|_PACK_RUNG|_packCheckoutUrl\(|_keyBoundPackUrl\(|credits_pitch|credits_hint|upgrade_this_key_pack_pitch/;

let saved;
beforeEach(() => { saved = process.env.DCHUB_INTERNAL_KEY; process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret'; });
afterEach(() => { if (saved === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = saved; });
const withCtx = (store, fn) => _ctxALS.run({ ...store }, fn);

// Strip comments line by line, keeping line numbers. A `//` inside a URL is
// preceded by ':' and survives.
function codeLines(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlock.split('\n').map((l) => l.replace(/(^|[^:\\'"`])\/\/.*$/, '$1'));
}

// Every pack mention, with WIN characters either side (comments blanked, line
// breaks kept so the reported line number is real). A window, not a line: the
// initialize instructions are one 5,000-character line whose "unlocks" is
// about claim_free_key, nowhere near the pack.
const WIN = 160;
function offenders(src) {
  const code = codeLines(src).join('\n');
  const out = [];
  const rx = new RegExp(PACK.source, 'g');
  for (let m; (m = rx.exec(code));) {
    const lo = Math.max(0, m.index - WIN);
    const win = code.slice(lo, m.index + m[0].length + WIN);
    const u = UNLOCK.exec(win);
    if (u) {
      const at = lo + u.index;
      const line = code.slice(0, at).split('\n').length;
      out.push(`server.mjs:${line} «${code.slice(Math.max(0, at - 60), at + 80).replace(/\s+/g, ' ')}»`);
    }
  }
  return [...new Set(out)];
}

describe('the $10 pack is never called an unlock', () => {
  const SID = 'e6f1c0de-1234-4aaa-9999-abcdef012345';

  for (const tool of ['get_grid_intelligence', 'get_fiber_intel', 'rank_markets']) {
    it(`${tool}: the anonymous wall sells the pack as credits, not an unlock`, () => {
      const t = withCtx({ session_id: SID }, () => trialHeader(tool, SID, '3 of 20 results shown'));
      expect(t).toContain('$10 one-time = 1,000 API credits');   // the rung is there to judge
      const i = t.indexOf('$10 one-time');
      const around = t.slice(Math.max(0, i - 200), i + 400);
      expect(around).not.toMatch(UNLOCK);
    });
  }

  it('_rungsText on a Pro-only tool: pack rung, then Pro — and no unlock word', () => {
    const r = withCtx({ session_id: SID }, () => _rungsText('get_grid_intelligence', 'free', SID));
    expect(r).toContain('$10 one-time = 1,000 API credits');
    expect(r).toContain('Pro $99/mo');
    expect(r).not.toMatch(UNLOCK);
  });

  it('source: no "unlock" within 160 characters of a pack mention', () => {
    expect(offenders(SRC)).toEqual([]);
  });

  it('the scan fires on the exact lines it replaced (a scan that can find nothing passes)', () => {
    const was = [
      "                'Your human unlocks in one click — ' + _rungsText(toolName, 'free', _ctaSid) + '.\\n' +",
      "  return _lead + 'your human unlocks in one click — ' +\n         _rungsText(toolName, 'free', sessionId) +",
      "                credits_pitch: '$10 one-time = 1,000 API credits, no subscription — the cheapest unlock.',",
      "                    '💳 **Unlock full depth now — $10 one-time = 1,000 API credits (no subscription):** ' +",
    ];
    for (const w of was) expect(offenders(w).length, w).toBeGreaterThan(0);
    // …and ignores the tool name and comments.
    expect(offenders("  'Call `unlock_more_data` ($10 one-time = 1,000 API credits).'")).toEqual([]);
    expect(offenders("  // the cheapest unlock was $10 one-time")).toEqual([]);
  });

  // r-relay-one-ask (2026-09-24): the gap line is the checkout pointer, not the
  // human ask; the relay line is (test/relay-one-ask.test.mjs). It still never
  // calls the pack an unlock.
  it('the reworded gap line names the payer and is not itself the human ask', () => {
    const t = withCtx({ session_id: SID }, () => trialHeader('rank_markets', SID, '3 of 20 results shown'));
    expect(t).toContain('the payer checks out in one click');
    expect(_hasHumanCta(t)).toBe(false);
    expect(offenders(t)).toEqual([]);
  });
});
