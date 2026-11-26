// unlock-tool-text-price-free.test.mjs — 2026-10-09 (owner call).
// Directories (LobeHub, Glama) mirror tool DESCRIPTIONS, so a price in the unlock_more_data
// description re-published the $10 line after the listing copy went price-free (#861/#866).
// The description names no price; the pack is still sold in the tool's RESPONSE.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _unlockMoreDataEnvelope, _ctxALS } from '../server.mjs';
// Capabilities messaging (2026-11-26): unlock_more_data now answers every non-ChatGPT seat with the neutral
// envelope (one human line, human_url /pricing; test/capabilities-instructions-1126.test.mjs). This file pins the
// legacy ladder, which a ChatGPT frozen seat and DCHUB_UNLOCK_NEUTRAL=0 still serve.
process.env.DCHUB_UNLOCK_NEUTRAL = '0';

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
      // 2026-11-15 (owner listing rule 2026-11-14): no plan wording either.
      // Capabilities messaging (2026-11-26): the description points at human_url and names no plan, price or limit.
      expect(d).toContain('human_url, the page that explains how to get full results');
      expect(d).not.toMatch(/paid plans?|free tier/i);
    });
  }
  it('the response still sells the pack', () => {
    const r = _ctxALS.run({ session_id: 'pf-sid', tier: 'free', platform: 'cursor' }, () => _unlockMoreDataEnvelope({}));
    // Owner 2026-10-10: sold with no amount (the checkout page shows it). Owner 2026-11-21 (decision 2): and with no
    // pack or credit wording either; the rung says what the checkout gets.
    expect(r.structuredContent.human_message).toContain('**Full answers in one checkout** (no subscription)');
    expect(r.structuredContent.human_message).not.toMatch(/credits?\b/i);
    expect(r.structuredContent.human_message).not.toContain('$');
  });
});
