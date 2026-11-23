// lib/platform-family.mjs — one clean platform field: claude | chatgpt | grok | other
// (checkout-attribution spec 2026-11-22, section 5).
//
// Derivation order, first hit wins: the attribution ref's family; src= (claude* / chatgpt, openai* / grok, xai*);
// via=; then the MCP clientInfo name / platform, by regex (claude|anthropic, chatgpt|openai, grok|xai); else other.
// A src/via that names some other client (cursor, n8n, ...) is not a family and falls through.
//
// MIRROR: dchub-backend util/platform_family.py implements the same table. Both repos test it against
// test/fixtures/platform_family_cases.json (identical bytes in each repo). Change both, or neither.
// Note: this is NOT lib/client-recognition's Grok contract detection (connectors-manager counts as Grok there, as
// "other" here, per the spec's table). Pure.
export const FAMILIES = Object.freeze(['claude', 'chatgpt', 'grok', 'other']);
const TABLE = [['claude', /claude|anthropic/i], ['chatgpt', /chatgpt|openai/i], ['grok', /grok|xai/i]];

export function familyOf(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  for (const [fam, rx] of TABLE) if (rx.test(s)) return fam;
  return null;
}

export function platformFamily({ aref_family = null, src = null, via = null, client = null, platform = null } = {}) {
  const a = String(aref_family || '').trim().toLowerCase();
  if (FAMILIES.slice(0, 3).includes(a)) return a;
  for (const raw of [src, via, client, platform]) {
    const f = familyOf(raw);
    if (f) return f;
  }
  return 'other';
}
