// The six tools that take a human's email (or name and company) say what they collect,
// why, who keeps it, and that the agent confirms it with the human before calling.
//
// WHY (2026-11-15, Note J): MCP Marketplace scored DC Hub 5.7 on six High "data
// exfiltration" flags, one per tool below. The annotations were already honest
// (readOnlyHint/destructiveHint/openWorldHint all false); the descriptions never said
// where the address goes. A scanner, and the agent deciding whether to call, read the
// description, so the data-use line lives there and this test keeps it from drifting.
//
// ★ request_capacity_intro DOES send data on: the company and requirement to the
// provider, and name, role and email once the provider accepts. "Never shared" would
// be false there, so the test forbids that phrase on that tool alone.
//
// ★ Slim clients cut descriptions at SLIM_DESC_MAX; bind_email runs past it. The line
// must survive the slim projection, so it is checked there too, not just on the full list.
import { describe, it, expect, beforeAll } from 'vitest';
import { _buildToolsListResult } from '../server.mjs';
import { slimToolsList } from '../lib/list-slim.mjs';

const EMAIL_TOOLS = ['claim_free_key', 'bind_email', 'recover_my_key', 'set_market_alert', 'set_site_alert'];
const ALL_SIX = [...EMAIL_TOOLS, 'request_capacity_intro'];
// Listing rule (owner 2026-11-14): no plan name and no price in tool copy.
const PLAN_OR_PRICE = /\$\s?\d|\bPro\b|paid plan|per month|\/mo\b|Enterprise plan|Developer plan/i;

let FULL;
let SLIM;

beforeAll(async () => {
  FULL = (await _buildToolsListResult(null)).tools;
  SLIM = slimToolsList({ tools: FULL.map((t) => ({ ...t })) }).tools;
});

const pick = (list, n) => list.find((t) => t.name === n);
const dataUse = (desc) => {
  const i = desc.indexOf('DATA USE:');
  return i < 0 ? '' : desc.slice(i, i + 700);
};

describe('email tools: data-use disclosure', () => {
  it('sees all six tools on both surfaces', () => {
    for (const n of ALL_SIX) {
      expect(pick(FULL, n), `${n} on the full list`).toBeTruthy();
      expect(pick(SLIM, n), `${n} on the slim list`).toBeTruthy();
    }
  });

  for (const surface of ['FULL', 'SLIM']) {
    describe(surface, () => {
      for (const n of ALL_SIX) {
        it(`${n} says what it collects, that it runs on request, and to confirm first`, () => {
          const t = pick(surface === 'FULL' ? FULL : SLIM, n);
          const line = dataUse(t.description);
          expect(line, `${n} has no DATA USE line`).not.toBe('');
          expect(line).toMatch(/only when your human asks/);
          expect(line).toMatch(/confirm (the address|the email|their name)/);
          expect(line).toMatch(/never sells/);
        });
      }
      for (const n of EMAIL_TOOLS) {
        it(`${n} says DC Hub alone keeps the email and links the privacy policy`, () => {
          const line = dataUse(pick(surface === 'FULL' ? FULL : SLIM, n).description);
          expect(line).toMatch(/DC Hub keeps it and never sells it or shares it for anyone else’s use/);
          expect(line).toContain('https://dchub.cloud/privacy');
        });
      }
    });
  }

  it('request_capacity_intro names the provider as the one recipient and never claims "never shared"', () => {
    const d = pick(FULL, 'request_capacity_intro').description;
    expect(dataUse(d)).toMatch(/go to no one but the provider/);
    expect(d).toMatch(/Only if the provider accepts does DC Hub share/);
    expect(d).not.toMatch(/never (shares|shared)/i);
  });

  it('read_inbox says it reads only the calling key\'s notes and takes no personal data', () => {
    const d = pick(FULL, 'read_inbox').description;
    expect(d).toMatch(/only the notes left for the key making the call, never another key's inbox/);
    expect(d).toMatch(/takes no email or other personal data/);
  });

  it('the new copy names no plan and no price', () => {
    for (const n of ALL_SIX) expect(dataUse(pick(FULL, n).description), n).not.toMatch(PLAN_OR_PRICE);
  });

  it('annotations stay write, non-destructive, closed-world on all six', () => {
    for (const n of ALL_SIX) {
      const a = pick(FULL, n).annotations;
      expect([a.readOnlyHint, a.destructiveHint, a.openWorldHint], n).toEqual([false, false, false]);
    }
  });
});
