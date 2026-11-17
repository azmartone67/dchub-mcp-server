// news-footer.mjs — one conversion line under a free key's get_news answer.
//
// Brain 2026-10-30: free keys that come back read news and nothing else, and never meet the siting
// tools. The key does carry free monthly full analyze_site runs (server.mjs _lpFreeRun:
// LP_FREE_RUN_TOOLS, any caller that holds a key), so the news answer says so once, as a new
// trailing text item:
//
//     Watching a site? Your free key includes one full power and queue analysis for any address.
//
// TEXT ONLY: structuredContent and the first text block (the JSON payload) are not touched.
// The caller (server.mjs _newsFooterStep, inside the get_news handler) decides WHO gets it (a keyed free caller, only
// while the free monthly runs are on, not on the frozen directory profiles or a clean
// platform) and runs this BEFORE the Source line is appended, so the Source line stays last.
// Pure; never throws.

// Option A (owner 2026-11-16, lib/neutral-connect.mjs): the line does not call the key free.
export const NEWS_FOOTER_LINE = 'Watching a site? Your DC Hub key includes one full power and queue analysis for any address.';

// E9 (owner 2026-11-14): an EMAIL-BOUND free key gets this line instead. The email is what the website's
// free monthly Land & Power run is counted on (dchub-backend util/lp_web_free_run: one full site report a
// month for a signed-in account), so the line points at that run with the map's own one-click entry,
// ?welcome=free_run (dchub-frontend js/lp-free-run-prompt.js: the address search opens for the run, or
// sign-in and back when the browser is signed out). One line, no plan name, no price; the URL carries no
// key, email or token. Never for a paid key, a pack buyer or a keyless caller (server.mjs _newsFooterStep).
export const NEWS_SITE_REPORT_URL = 'https://dchub.cloud/land-power-map?welcome=free_run'
  + '&utm_source=mcp&utm_medium=get_news&utm_campaign=free_run';
export const NEWS_SITE_REPORT_LINE = 'Watching a site? Your email also gets one free full site report a month on the '
  + 'Land & Power map (sign in with it): ' + NEWS_SITE_REPORT_URL;
const _FOOTER_LINES = new Set([NEWS_FOOTER_LINE, NEWS_SITE_REPORT_LINE]);

const SOURCE_LINE_RE = /^Source: DC Hub \(dchub\.cloud(?:\/[^\s)]+)?\)(?:, as of \d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}Z)?)?$/;

function _lastLine(text) {
  const t = String(text || '').replace(/\s+$/, '');
  return t.slice(t.lastIndexOf('\n') + 1);
}

// Append the footer (`line`, NEWS_FOOTER_LINE by default). Unchanged when: not an object, an error,
// no text content, an upstream failure envelope, no data, or a footer (or a Source line) is already
// the last text.
export function withNewsFooter(result, line = NEWS_FOOTER_LINE) {
  try {
    if (!result || typeof result !== 'object' || result.isError === true) return result;
    if (!Array.isArray(result.content) || !result.content.length) return result;
    const texts = result.content.filter((it) => it && it.type === 'text' && typeof it.text === 'string');
    if (!texts.length) return result;
    const sc = result.structuredContent;
    if (sc && typeof sc === 'object' && !Array.isArray(sc)
        && (sc._error_mitigation || sc.error || sc.ok === false || sc.success === false)) return result;
    try {
      const first = JSON.parse(texts[0].text);
      if (first && typeof first === 'object' && !Array.isArray(first)
          && (first._error_mitigation || first.error || first.ok === false || first.success === false)) return result;
    } catch (_) { /* a text-only answer is still an answer */ }
    const last = _lastLine(texts[texts.length - 1].text);
    if (_FOOTER_LINES.has(last) || SOURCE_LINE_RE.test(last.trim())) return result;
    const text = _FOOTER_LINES.has(line) ? line : NEWS_FOOTER_LINE;
    return { ...result, content: [...result.content, { type: 'text', text }] };
  } catch (_) {
    return result;
  }
}
