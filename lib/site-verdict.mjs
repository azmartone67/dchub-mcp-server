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

// Grok QA 2026-10-23: /api/site-score now carries the nearest DCPI market's verdict and time to power for
// every point (dchub-backend util/site_market_verdict.py), so a coordinate call gets the market verdict too,
// not only a call that named a market. The months are a paid figure; the band is free (the keyless market
// page shows it), so only the band travels here.
const TTP_BANDS = new Set(['under_24_months', '24_to_48_months', 'over_48_months']);
export function marketVerdictFromSiteScore(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const mv = body.market_verdict;
  if (!mv || typeof mv !== 'object') return null;
  const verdict = String(mv.verdict || '').toUpperCase();
  if (!BANDS.has(verdict)) return null;
  const band = body.time_to_power && body.time_to_power.time_to_power_band;
  return {
    market: typeof mv.market === 'string' && mv.market ? mv.market : null,
    slug: slugOk(mv.slug) ? mv.slug : null,
    verdict,
    composite_score: null,
    as_of: day(mv.as_of),
    ...(TTP_BANDS.has(band) ? { time_to_power_band: band } : {}),
  };
}

// The location lookup's market block, with the site answer's time-to-power band when both name one market.
export function withSiteScoreMarket(current, body) {
  const fromSite = marketVerdictFromSiteScore(body);
  if (!fromSite) return current || null;
  if (!current) return fromSite;
  if (current.slug && current.slug === fromSite.slug && fromSite.time_to_power_band) {
    return { ...current, time_to_power_band: fromSite.time_to_power_band };
  }
  return current;
}

export function marketVerdictSentence(m) {
  if (!m || !BANDS.has(m.verdict)) return '';
  return 'Market verdict (DCPI): ' + m.verdict + (m.composite_score != null ? ' (' + m.composite_score + ')' : '')
    + (m.market ? ' for ' + m.market : '')
    + (TTP_BANDS.has(m.time_to_power_band) ? ', time to power ' + m.time_to_power_band.replace(/_/g, ' ') : '')
    + (m.as_of ? ', as of ' + m.as_of : '') + '.';
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
