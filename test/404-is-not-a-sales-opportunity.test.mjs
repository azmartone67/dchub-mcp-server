// A 404 is the caller's identifier not resolving — not an upgrade prompt.
//
// Measured live 2026-09-20, get_market_intel {"market":"Dallas, TX"}:
//
//   structuredContent : error "API 404", code NOT_FOUND, and a `detail` naming
//                       exactly how to recover ("Use a valid market id … call
//                       rank_markets for the full list")
//   content[0].text   : "## 📊 Your agent just answered using 1 of 300+ markets
//                       … The number above is real" + claim_free_key + $10 +
//                       Pro $99 — and isError:false
//
// Nothing was answered and no number was above. phase9L_clean_preview deleted
// the error body and returned the CTA alone, so the only channel the model reads
// lost the one field that could have rescued the call. The rational next step
// for that agent was to ask its human to pay for a typo.
import { describe, it, expect } from 'vitest';
import { phase9L_clean_preview } from '../server.mjs';

const CTA = '## 📊 Your agent just answered using 1 of 300+ markets\n\nThe number above is real';
const NOT_FOUND = JSON.stringify({
  error: 'API 404',
  detail: 'Use a valid market id. Slug, display name and any casing all resolve. Call rank_markets (or GET /api/v1/markets) for the full list; DCPI market pages live at /dcpi/<slug>.',
  code: 'NOT_FOUND',
  error_version: 1,
});

describe('a 404 keeps its error', () => {
  it('returns the error body, not the upsell', () => {
    const out = phase9L_clean_preview(CTA, NOT_FOUND);
    expect(out).toContain('NOT_FOUND');
    expect(out).toMatch(/call rank_markets/i);   // the detail names the recovery
  });

  it('does not claim the agent answered', () => {
    // The load-bearing half. Returning error+CTA would still tell the model it
    // succeeded, so the CTA must be ABSENT, not merely accompanied.
    const out = phase9L_clean_preview(CTA, NOT_FOUND);
    expect(out).not.toContain('just answered');
    expect(out).not.toContain('The number above is real');
  });

  it('recognises the shape however it is spelled', () => {
    for (const body of ['{"error":"API 404"}', 'API 404 Not Found', '{"code": "NOT_FOUND"}']) {
      const out = phase9L_clean_preview(CTA, body);
      expect(out, body).not.toContain('just answered');
    }
  });
});

describe('entitlement errors are unchanged — the CTA is the right answer to those', () => {
  it('401 / 402 / 403 still suppress the body and sell', () => {
    for (const body of ['{"error":"API 401"}', '{"error":"API 402"}', '{"error":"API 403"}',
                        '403 Forbidden', '{"success": false}']) {
      expect(phase9L_clean_preview(CTA, body), body).toBe(CTA);
    }
  });
});

describe('the normal path is untouched', () => {
  it('a real answer still gets the CTA appended after it', () => {
    const body = '{"market":{"id":"dallas"},"stats":{"facilities":372}}';
    const out = phase9L_clean_preview(CTA, body);
    expect(out.startsWith(body)).toBe(true);
    expect(out).toContain('just answered');
    expect(out).toContain('---');
  });

  it('no CTA returns the body alone; junk does not throw', () => {
    expect(phase9L_clean_preview('', '{"ok":1}')).toBe('{"ok":1}');
    expect(() => phase9L_clean_preview(CTA, null)).not.toThrow();
    expect(() => phase9L_clean_preview(CTA, undefined)).not.toThrow();
  });
});
