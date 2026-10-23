// Owner decision (a), 2026-10-23: a bound email also gets a weekly summary of what its key
// looked up. The backend enrolls a key only when the client sends consent_purpose
// (dchub-backend#7627), so this client may send it only where the human was told.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { EMAIL_PURPOSE_TEXT, WEEKLY_SUMMARY_PURPOSE, _emailBenefitText } from '../server.mjs';

const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const between = (a, b) => { const i = src.indexOf(a); return src.slice(i, src.indexOf(b, i)); };

describe('the disclosure', () => {
  it('names the summary, its condition and how to stop it', () => {
    expect(EMAIL_PURPOSE_TEXT).toMatch(/weekly summary of what the key looked up/);
    expect(EMAIL_PURPOSE_TEXT).toMatch(/only in weeks it was used/);
    expect(EMAIL_PURPOSE_TEXT).toMatch(/unsubscribe anytime/);
    expect(EMAIL_PURPOSE_TEXT).toMatch(/no other marketing unless they opt in/);
  });
  it('the old "only to recover" purpose is gone everywhere', () => {
    expect(src).not.toMatch(/used only to recover the key and to send the alerts they set/);
    expect(src).not.toMatch(/used ONLY to recover your key and route upgrade receipts/);
    expect(src).not.toMatch(/no newsletter or digest/);
  });
  it('every email ask uses the one sentence', () => {
    expect((src.match(/const purpose = EMAIL_PURPOSE_TEXT;/g) || []).length).toBe(2);
    expect(between("trackedTool(srv, 'bind_email',", '{ email: Sreq')).toMatch(/CONSENT\/PURPOSE: ' \+ EMAIL_PURPOSE_TEXT/);
    expect(src).toMatch(/'Purpose: ' \+ EMAIL_PURPOSE_TEXT/);
    expect(_emailBenefitText()).toMatch(/a weekly summary of what your key looked up \(unsubscribe anytime\)/);
  });
});

describe('the consent token goes only with the disclosure', () => {
  it('matches the backend constant', () => {
    expect(WEEKLY_SUMMARY_PURPOSE).toBe('recovery_receipts_weekly_summary_v1');
  });
  it('bind_email sends it (its description discloses the summary)', () => {
    expect(src).toMatch(/const body = \{ email, email_source: _retEmailSourceFor\(getCtx\(\)\), consent_purpose: WEEKLY_SUMMARY_PURPOSE \};/);
  });
  it('claim_free_key sends it only with an email, and its description discloses the summary', () => {
    const claim = between("trackedTool(srv, 'claim_free_key',", "callAPIWrite('/api/v1/keys/claim'");
    expect(claim).toMatch(/if \(a\.email\) \{[\s\S]*body\.consent_purpose = WEEKLY_SUMMARY_PURPOSE;[\s\S]*\}/);
    expect(claim).toContain('_emailBenefitText()');
  });
  it('the token is sent nowhere else', () => {
    expect((src.match(/consent_purpose[: =]+WEEKLY_SUMMARY_PURPOSE/g) || []).length).toBe(2);
  });
});
