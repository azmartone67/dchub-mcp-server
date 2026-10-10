// unlock-tool-text-price-free.test.mjs — 2026-10-09 (owner call).
// Directories (LobeHub, Glama) mirror tool DESCRIPTIONS, so a price in the unlock_more_data
// description re-published the $10 line after the listing copy went price-free (#861/#866).
// The description names no price; the pack is still sold in the tool's RESPONSE.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _unlockMoreDataEnvelope, _ctxALS } from '../server.mjs';

const desc = (file) => {
  const j = JSON.parse(readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
  return (Array.isArray(j) ? j : j.tools).find((t) => t.name === 'unlock_more_data').description;
};

describe('unlock_more_data description is price-free', () => {
  for (const f of ['mcp-server.json', 'toolspec.json', 'integrations/packs/grid.json']) {
    it(f, () => {
      const d = desc(f);
      expect(d).not.toMatch(/\$\d/);
      expect(d).not.toMatch(/1,000 API credits/);
      expect(d).toContain('Paid plans:');
    });
  }
  it('the response still sells the pack', () => {
    const r = _ctxALS.run({ session_id: 'pf-sid', tier: 'free', platform: 'cursor' }, () => _unlockMoreDataEnvelope({}));
    // Owner 2026-10-10: sold as a pack of credits, with no amount (the checkout page shows it).
    expect(r.structuredContent.human_message).toContain('a one-time pack of 1,000 API credits (usage capacity, not a subscription)');
    expect(r.structuredContent.human_message).not.toContain('$');
  });
});
