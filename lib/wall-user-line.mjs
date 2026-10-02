// wall-user-line.mjs (2026-09-30, copy_version v11)
//
// WHY. Measured 2026-09-29/30 (Grok, live keyless analyze_site): 52 relays minted, 0 people
// acted in 7 days. The wall led with an agent instruction, offered claim_free_key as the
// agent's own next step, and carried a ~100-character /go/c/<base64>.<sig> link. An agent
// treated it as a failed call and never showed it to anyone; a person would not have
// clicked that link.
//
// WHAT. The FIRST line of a wall's content text is a sentence written for the PERSON, short
// enough to quote verbatim, carrying dchub.cloud/u/<code> (dchub-backend#6017: a 302 to the
// same signed /go/c token, so attribution is unchanged). structuredContent.user_message is
// that same text and show_to_user is true. claim_free_key stays, AFTER it, as the
// "if the user prefers a free preview first" alternative.
//
// TRUTHFUL PER TOOL (owner 2026-09-30). The offer is whatever really opens the tool:
// Land & Power and Pro-only tools name DC Hub Pro (unpriced: owner rule 09-27, the only
// price DC Hub states is the $10 pack). The $10 pack is described as API capacity, never as
// an unlock, and the word "unlock" is not used here at all.
//
// Pure module: no network, no ctx. server.mjs mints the short link and calls in.

export const WALL_COPY_VERSION = 'v11';

// The only preview count the line may carry (analyze_site nearby.substations_50km).
export const COUNT_LABEL = 'substations within 50 km';

// dchub-backend relay_short_link: 6 chars, no 0/o/1/i/l.
export const SHORT_LINK_RE = /^https:\/\/dchub\.cloud\/u\/[2-9a-hj-km-np-z]{6}$/;

const LABEL = {
  analyze_site: 'site analysis', compare_sites: 'site comparison',
  get_grid_intelligence: 'grid intelligence', get_fiber_intel: 'fiber intelligence',
  generate_site_analysis: 'site analysis report', get_dchub_recommendation: 'recommendation',
  get_composite_site_score: 'composite site score',
};
function labelFor(tool) { return LABEL[tool] || String(tool || 'result').replace(/_/g, ' '); }

// /go/c/<base64url(plan|ref[|sid])>.<sig>  ->  { plan, ref, sid } or null.
// Deriving the short link's fields from the long link means the two can never disagree
// about who gets credit for the purchase.
export function decodeGoToken(url) {
  try {
    const m = /^https:\/\/dchub\.cloud\/go\/c\/([A-Za-z0-9_-]+)\.[0-9a-f]{32}$/.exec(String(url || ''));
    if (!m) return null;
    const [plan, ref = '', sid = ''] = Buffer.from(m[1], 'base64url').toString('utf8').split('|');
    return plan ? { plan, ref, sid } : null;
  } catch (_) { return null; }
}

// The band alone: BUILD / CAUTION / AVOID (owner decision 2, 2026-09-30). Never a score, a
// figure or the factor's number. `headline` is lib/paywall-contract lpHeadline's output.
function bandClause(headline) {
  if (!headline) return '';
  if (headline.sites && headline.sites.length) {
    const parts = headline.sites.map((x, i) => 'site ' + (i + 1) + ' ' + (x.verdict || 'unscored'));
    return 'DC Hub rates ' + parts.join(', ') + '. ';
  }
  if (headline.verdict) {
    // One measured COUNT (never a score/figure): only an integer and a label this module
    // owns, so a malformed headline cannot put free text or a decimal in the line.
    const pc = headline.preview_count;
    const n = pc && Number.isInteger(pc.value) && pc.value >= 0 ? pc.value : null;
    const tail = (n !== null && pc.label === COUNT_LABEL) ? '; ' + n + ' ' + COUNT_LABEL : '';
    return 'DC Hub rates this site ' + headline.verdict + ' overall' + tail + '. ';
  }
  return '';
}

// offer: 'pro' | 'pack'. link: the short link, or the long /go/c link when the mint failed.
export function userLineText({ tool, offer, link, headline }) {
  const what = labelFor(tool);
  const lead = bandClause(headline);
  if (offer === 'pro') {
    return lead + 'For the full ' + what + ', your user can open ' + link + ' — it needs DC Hub Pro.';
  }
  return lead + 'For the full ' + what + ', your user can open ' + link
    + ' — a $10 one-time pack adds 1,000 API credits for your agent (usage capacity, not a subscription).';
}

const CLAIM_ALT = 'If the user prefers a free preview first, call `claim_free_key` (one call, no email).';

// Rewrites a wall result so the person's line is first. `keepBody` true (paid_only,
// metered, hard wall) keeps the existing agent-facing body after the line; false (the
// Land & Power wall, whose body was the old lock notice) replaces it with the
// claim_free_key alternative. Never mutates the input.
export function withUserLine(result, { tool, offer, link, headline, keepBody, plan }) {
  const line = userLineText({ tool, offer, link, headline });
  const first = result && result.content && result.content[0];
  let oldText = (first && first.type === 'text' && typeof first.text === 'string') ? first.text : '';
  // The kept body already carries a long /go/c link for the SAME plan the line just
  // offered; a second copy of that ask (and a base64 token) gives way to a pointer.
  // Links for other plans (the agent's alternative rungs) are left alone.
  if (keepBody && plan) {
    oldText = oldText.replace(/https:\/\/dchub\.cloud\/go\/c\/[A-Za-z0-9_-]+\.[0-9a-f]{32}/g,
      (u) => { const d = decodeGoToken(u); return d && d.plan === plan ? 'the link in the first line' : u; });
  }
  const text = keepBody && oldText ? line + '\n\n' + oldText : line + '\n\n' + CLAIM_ALT;
  const content = Array.isArray(result.content) ? result.content.slice() : [];
  content[0] = { type: 'text', text };
  const sc = { ...(result.structuredContent || {}) };
  sc.user_message = line;
  sc.show_to_user = true;
  sc.copy_version = WALL_COPY_VERSION;
  return { ...result, content, structuredContent: sc };
}
