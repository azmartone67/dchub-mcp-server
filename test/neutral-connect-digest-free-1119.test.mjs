// neutral-connect-digest-free-1119.test.mjs — Grok's daily MCP leadership note (2026-11-18 evening), item 13: the digest
// ask on every compact answer said "Next step for your user, free (...): "DC Hub can email you a free weekly summary of
// what changed here."". With the owner's go-ahead (2026-11-19) the final rewrite (lib/neutral-connect.mjs) takes "free"
// out of it and keeps the ask. README line 361 no longer states a calls-per-day figure.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { connectNeutralString, NEUTRAL_CONNECT_LINE } from '../lib/neutral-connect.mjs';
import { FLOOR_DIGEST_LEAD, FLOOR_EMAIL_LEAD } from '../lib/wall-offer-floor.mjs';

describe('item 13: the digest ask carries no "free"', () => {
  it('both digest leads keep the ask and lose "free"', () => {
    const a = connectNeutralString(`${FLOOR_DIGEST_LEAD} "DC Hub can email you a free weekly summary of what changed here." Ask them for an email.`);
    expect(a).toBe('Next step for your user (an email does not open the fields held back here): "DC Hub can email you a weekly summary of what changed here." Ask them for an email.');
    const b = connectNeutralString(`${FLOOR_EMAIL_LEAD} "DC Hub can email you a free weekly summary of what changed here."`);
    expect(b).toBe('Next step for your user: "DC Hub can email you a weekly summary of what changed here."');
    for (const s of [a, b]) { expect(s).not.toMatch(/\bfree\b/i); expect(s).not.toContain(NEUTRAL_CONNECT_LINE); }
  });
  it('data prose that says free is untouched', () => {
    for (const s of ['Carbon-free supply rose 4%.', 'Free cooling hours: 4,200.', 'call `claim_free_key` with {email}']) {
      expect(connectNeutralString(s)).toBe(s);
    }
  });
});

describe('item 13: README', () => {
  it('states no calls-per-day figure for bind_email', () => {
    const r = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    expect(r).not.toMatch(/calls\/day/);
    expect(r).toContain('**Add an email (`bind_email`):** raises the daily limit. More detail is available at dchub.cloud/connect.');
  });
});
