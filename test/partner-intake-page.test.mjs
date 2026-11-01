// /mcp/partner (owner 2026-10-30): the intake form page. It must post the fields the
// backend validates, carry a honeypot, name no plan or price or count, and be served with
// a CSP that allows exactly its one script.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  PARTNER_PATH, INTAKE_API, HONEYPOT, BUILDING, CLIENTS, EXPECTED_USE,
  PARTNER_SCRIPT, PARTNER_CSP, renderPartnerPage,
} from '../lib/partner-intake-page.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const DIRS = readFileSync(new URL('../lib/directories-page.mjs', import.meta.url), 'utf8');
const EMOJI = /[\p{Extended_Pictographic}️⃣]/u;
const PRICE = /\$\s?\d|\/mo\b|per month|\b(pro|developer|starter|enterprise|free)\b|\b\d[\d,]*\+?\s+(tools|facilities|markets)\b/i;

describe('renderPartnerPage', () => {
  const html = renderPartnerPage();

  it('has every field in the brief, and consent is required while the partnership box is optional', () => {
    for (const must of ['name="name"', 'name="email"', 'name="company"', 'name="building"',
      'name="clients"', 'name="prompts"', 'name="expected_use"', 'name="data_partnership"', 'name="consent"']) {
      expect(html, must).toContain(must);
    }
    expect(html).toMatch(/name="consent" value="yes" required/);
    expect(html).not.toMatch(/name="data_partnership"[^>]*required/);
  });

  it('offers exactly the enum values the backend accepts', () => {
    expect(BUILDING.map((r) => r[0])).toEqual(['ai_agent', 'mcp_gateway', 'data_platform', 'site_selection', 'other']);
    expect(CLIENTS.map((r) => r[0])).toEqual(['claude', 'chatgpt', 'cursor', 'copilot', 'gemini', 'grok', 'mistral', 'other']);
    expect(EXPECTED_USE.map((r) => r[0])).toEqual(['testing', 'regular', 'production']);
    for (const [v] of [...BUILDING, ...CLIENTS, ...EXPECTED_USE]) expect(html).toContain(`value="${v}"`);
  });

  it('carries an off-screen honeypot that humans do not tab into', () => {
    expect(HONEYPOT).toBe('website');
    expect(html).toMatch(/class="hp"[^>]*aria-hidden="true"/);
    expect(html).toMatch(/name="website" tabindex="-1" autocomplete="off"/);
    expect(PARTNER_SCRIPT).toContain('website:fd.get(');
  });

  it('posts to the backend intake route and shows the /connect steps after a 200', () => {
    expect(INTAKE_API).toBe('/api/v1/mcp/partner-intake');
    expect(html).toContain(`action="${INTAKE_API}"`);
    expect(PARTNER_SCRIPT).toContain(`fetch('${INTAKE_API}'`);
    expect(html).toContain('https://dchub.cloud/connect');
  });

  it('names no plan, price or count, and no emoji', () => {
    const text = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
    expect(text).not.toMatch(PRICE);
    expect(html).not.toMatch(EMOJI);
  });

  it('never shows or asks for a key', () => {
    expect(html).not.toMatch(/dch_live_|api[_ -]?key/i);
  });
});

describe('PARTNER_CSP', () => {
  it('allows the one inline script by its hash and the same-origin site nav, nothing broader', () => {
    const csp = PARTNER_CSP();
    const hash = createHash('sha256').update(PARTNER_SCRIPT).digest('base64');
    const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toBe(`script-src 'self' 'sha256-${hash}' https://static.cloudflareinsights.com`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self' https://cloudflareinsights.com");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('matches the script as it is embedded in the page (a mismatch would block the form)', () => {
    const html = renderPartnerPage();
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m && m[1]).toBe(PARTNER_SCRIPT);
  });
});

describe('wiring', () => {
  it('server.mjs serves the page at /mcp/partner with the hashed CSP', () => {
    expect(PARTNER_PATH).toBe('/mcp/partner');
    expect(SRC).toMatch(/app\.get\(\[PARTNER_PATH, PARTNER_PATH \+ '\/'\]/);
    expect(SRC).toContain("res.set('Content-Security-Policy', PARTNER_CSP());");
  });

  it('/mcp/directories links the form', () => {
    expect(DIRS).toContain('https://dchub.cloud/mcp/partner');
  });
});
