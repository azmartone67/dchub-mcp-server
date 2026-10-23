// claim_free_key and bind_email lead with what an email buys (2026-10-23, draft for the owner).
// 13 keys claimed in the week of 10-19, 0 with an email (brain finding #116849). bind_email
// opened with what binding does NOT do and never named the allowance. The honesty section
// stays (test/oauth-first-copy.test.mjs); this pins that the benefit comes first, in canon numbers.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _emailBenefitText } from '../server.mjs';

const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const between = (a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i); return src.slice(i, j); };
const claimDesc = between("trackedTool(srv, 'claim_free_key',", '{ client_name:');
const bindDesc = between("trackedTool(srv, 'bind_email',", '{ email: Sreq');

describe('the email benefit sentence', () => {
  const t = _emailBenefitText();
  it('states the bound allowance, the decision-tool allowance and recovery', () => {
    expect(t).toMatch(/^WHAT AN EMAIL GETS \(free, no card\): \d+ calls\/day \(up to \d+ full answers per tool per day\)/);
    expect(t).toMatch(/full answers a day each on the grid, queue and market-intel tools/);
    expect(t).toMatch(/recover_my_key/);
  });
  it('names no plan and no price', () => {
    expect(t).not.toMatch(/\$|pro\b|developer|enterprise|pricing/i);
  });
  it('its figures are computed, not typed into the copy', () => {
    const fn = between('export function _emailBenefitText()', '\n}\n');
    expect(fn).toMatch(/_rungNum\('identified'\)/);
    expect(fn).toMatch(/_fullAnswersPerToolPerDay\('identified'\)/);
    expect(fn).toMatch(/EMAIL_DECISION_DAILY_FULL_CAP/);
    expect(fn).not.toMatch(/['"][^'"]*\b(50|10)\b[^'"]*['"]/);
  });
});

describe('both tools lead with it', () => {
  it('claim_free_key states it (no bare "Add an email: N calls/day")', () => {
    expect(claimDesc).toContain('_emailBenefitText()');
    expect(claimDesc).not.toMatch(/Add an email: ' \+ FREE_TIER/);
  });
  it('bind_email puts it BEFORE the does-not-do section, which stays', () => {
    const b = bindDesc.indexOf('_emailBenefitText()');
    const h = bindDesc.indexOf('★ WHAT THIS DOES AND DOES NOT DO');
    expect(b).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(b);
    expect(bindDesc).toMatch(/UNPROVEN/);
  });
  it('still asks only for an address the human typed', () => {
    expect(claimDesc).toMatch(/pass it only if they typed it/);
    expect(bindDesc).toMatch(/pass only an address they typed/);
  });
});
