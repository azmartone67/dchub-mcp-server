// withheld-label-1121.test.mjs — owner 2026-11-21 (agent-incentive round): a preview that withholds
// fields labels them "withheld (full figure needs a DC Hub license)" beside the list; values stay null.
// Behind DCHUB_WITHHELD_LABEL (default OFF); never on /mcp/chatgpt, /mcp/claude or /mcp/core.
import { describe, it, expect } from 'vitest';
import { WITHHELD_LABEL, buildEvidence } from '../lib/evidence-contract.mjs';
import { WITHHELD_LABEL_TEXT } from '../lib/attribution.mjs';
import { DIRECTORY_PROFILE } from '../lib/chatgpt-directory.mjs';
import { CLAUDE_PROFILE } from '../lib/claude-directory.mjs';
import { CORE_PROFILE } from '../lib/core-profile.mjs';
import * as S from '../server.mjs';

describe('withheld label', () => {
  it('is the approved wording, with no price, plan or "free"', () => {
    expect(WITHHELD_LABEL).toBe('withheld (full figure needs a DC Hub license)');
    expect(WITHHELD_LABEL_TEXT).toBe(WITHHELD_LABEL);
    expect(WITHHELD_LABEL).not.toMatch(/free|\$|plan|credit|per day/i);
  });
  it('flag off by default; on, never on the directory, Claude or core profiles', () => {
    expect(S._withheldLabelOn({})).toBe(false);
    expect(S._withheldLabelAllowed({ profile: null }, {})).toBe(false);
    const on = { DCHUB_WITHHELD_LABEL: '1' };
    expect(S._withheldLabelAllowed({ profile: null }, on)).toBe(true);
    for (const p of [DIRECTORY_PROFILE, CLAUDE_PROFILE, CORE_PROFILE]) {
      expect(typeof p).toBe('string');
      expect(S._withheldLabelAllowed({ profile: p }, on)).toBe(false);
    }
  });
});

describe('evidence coverage', () => {
  it('carries the label only when the preview block carries it', () => {
    const ev = buildEvidence({ rows: [] }, { completeness: 'partial_preview', preview: { withheld_fields: ['mw'], withheld_label: WITHHELD_LABEL } }, () => {});
    expect(ev.coverage.withheld_label).toBe(WITHHELD_LABEL);
    const ev2 = buildEvidence({ rows: [] }, { completeness: 'partial_preview', preview: { withheld_fields: ['mw'] } }, () => {});
    expect(ev2.coverage.withheld_label).toBeUndefined();
  });
});
