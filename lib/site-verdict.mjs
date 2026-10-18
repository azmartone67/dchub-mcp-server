// ── site verdict vs market verdict (Grok 2026-10-18, P1-10) ────────────────
// Keyless analyze_site Phoenix said "verdict BUILD" while the market's DCPI read CAUTION 41.9. Both are
// true and they are different things: the teaser's verdict is a band of the SITE score (power, fiber,
// gas at that point); the DCPI verdict is the MARKET's. A bare "verdict" invites reading one as the
// other, so the site band is labelled as what it is and, where the call named a market, the market
// verdict (the DCPI row the location lookup already read) is printed beside it with its date.

export const SITE_VERDICT_LABEL = 'site infrastructure verdict';
const BANDS = new Set(['BUILD', 'CAUTION', 'AVOID']);
const day = (v) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : null; };
const slugOk = (s) => typeof s === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);

// A compact market block from a DCPI row (/api/v1/dcpi/scores/<slug>); null unless it carries a band.
export function marketVerdictFromRow(row, slug) {
  if (!row || typeof row !== 'object' || row.error) return null;
  const verdict = String(row.verdict || '').toUpperCase();
  if (!BANDS.has(verdict)) return null;
  const score = Number(row.composite_score);
  const s = slugOk(row.market_slug) ? row.market_slug : (slugOk(slug) ? slug : null);
  return {
    market: typeof row.market_name === 'string' && row.market_name ? row.market_name : null,
    slug: s,
    verdict,
    composite_score: Number.isFinite(score) ? Math.round(score * 10) / 10 : null,
    as_of: day(row.computed_at) || day(row.as_of),
  };
}

export function marketVerdictSentence(m) {
  if (!m || !BANDS.has(m.verdict)) return '';
  return 'Market verdict (DCPI): ' + m.verdict + (m.composite_score != null ? ' (' + m.composite_score + ')' : '')
    + (m.market ? ' for ' + m.market : '') + (m.as_of ? ', as of ' + m.as_of : '') + '.';
}

// Said when the call gave no market (coordinates): the site band is not the market's.
export const NO_MARKET_SENTENCE = 'This is a site-level read, not the market verdict: for the market, call get_market_dcpi_rank.';

export function sourceLine(m) {
  if (m && m.slug) return 'Source: DC Hub (dchub.cloud/markets/' + m.slug + ')' + (m.as_of ? ', as of ' + m.as_of : '') + '.';
  return 'Source: DC Hub site score (dchub.cloud).';
}

// The sentences to follow the "site infrastructure verdict X; power infrastructure Y" clause.
export function verdictContext(m) {
  return [m && BANDS.has(m.verdict) ? marketVerdictSentence(m) : NO_MARKET_SENTENCE, sourceLine(m)].join(' ');
}
