// licence-wall-email-keeps-1125.test.mjs — owner 2026-11-25 (Grok -> Brain item 1).
// A licence-only wall said "The withheld fields come with a DC Hub licence, not with an email" while the same answer
// asked for an email (email_ask). The line now says what an email keeps on that page (the /u/ page's email box binds one
// key that keeps saved sites, alerts and tracked changes) and that the withheld fields need a licence. It never says an
// email opens the withheld fields: a licence does (licence.licence_unlocks). Kill switch DCHUB_LICENCE_WALL_EMAIL_KEEPS=0.
import { describe, it, expect, afterEach } from 'vitest';
import { relayHumanMessage, promisesIn, RELAY_LICENCE_LINE } from '../lib/wall-relay-everywhere.mjs';
import { withHonestPromises, LICENCE_CLAUSE, LICENCE_CLAUSE_PRE_1125 } from '../lib/wall-value-first.mjs';

const LINK = 'https://dchub.cloud/u/abc123';
const prev = process.env.DCHUB_LICENCE_WALL_EMAIL_KEEPS;
afterEach(() => { if (prev === undefined) delete process.env.DCHUB_LICENCE_WALL_EMAIL_KEEPS; else process.env.DCHUB_LICENCE_WALL_EMAIL_KEEPS = prev; });

describe('licence-only wall line', () => {
  it('says what an email keeps and that the withheld fields need a licence', () => {
    delete process.env.DCHUB_LICENCE_WALL_EMAIL_KEEPS;
    const m = relayHumanMessage({ tool: 'execute_plan', link: LINK, unlock: 'licence' });
    expect(m).toBe('Your AI assistant got a preview of execute_plan from DC Hub. Add your email on this page to keep your '
      + 'saved sites, alerts and tracked changes across sessions; the withheld fields need a DC Hub licence: ' + LINK);
    expect(m).not.toMatch(/not with an email/);
    expect(m.startsWith('Your AI assistant got a preview of execute_plan from DC Hub. ' + RELAY_LICENCE_LINE)).toBe(true);
  });
  it('makes no email-opens promise: the only promise is the licence', () => {
    delete process.env.DCHUB_LICENCE_WALL_EMAIL_KEEPS;
    expect(promisesIn(relayHumanMessage({ tool: 'execute_plan', link: LINK, unlock: 'licence' }))).toEqual(['licence']);
    expect(promisesIn(LICENCE_CLAUSE)).toEqual(['licence']);
  });
  it('the email branch is unchanged', () => {
    delete process.env.DCHUB_LICENCE_WALL_EMAIL_KEEPS;
    expect(relayHumanMessage({ tool: 'search_facilities', link: LINK, unlock: 'email' }))
      .toBe('Your AI assistant got a preview of search_facilities from DC Hub. An email on this page opens the full answer: ' + LINK);
  });
  it('an email-full promise the answer cannot keep becomes the honest clause', () => {
    delete process.env.DCHUB_LICENCE_WALL_EMAIL_KEEPS;
    const r = { content: [{ type: 'text', text: 'Preview of get_facility; with an email it gets the full answer.' }] };
    expect(withHonestPromises(r, { emailOpens: false }).content[0].text)
      .toBe('Preview of get_facility' + LICENCE_CLAUSE + '.');
  });
  it('kill switch DCHUB_LICENCE_WALL_EMAIL_KEEPS=0 restores the pre-2026-11-25 copy', () => {
    process.env.DCHUB_LICENCE_WALL_EMAIL_KEEPS = '0';
    expect(relayHumanMessage({ tool: 'execute_plan', link: LINK, unlock: 'licence' })).toBe('Your AI assistant got a '
      + 'preview of execute_plan from DC Hub. The withheld fields come with a DC Hub licence, not with an email. See what was withheld: ' + LINK);
    const r = { content: [{ type: 'text', text: 'x; with an email it gets the full answer.' }] };
    expect(withHonestPromises(r, { emailOpens: false }).content[0].text).toBe('x' + LICENCE_CLAUSE_PRE_1125 + '.');
  });
});
