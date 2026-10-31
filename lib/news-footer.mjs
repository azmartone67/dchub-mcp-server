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

export const NEWS_FOOTER_LINE = 'Watching a site? Your free key includes one full power and queue analysis for any address.';

const SOURCE_LINE_RE = /^Source: DC Hub \(dchub\.cloud(?:\/[^\s)]+)?\)(?:, as of \d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}Z)?)?$/;

function _lastLine(text) {
  const t = String(text || '').replace(/\s+$/, '');
  return t.slice(t.lastIndexOf('\n') + 1);
}

// Append the footer. Unchanged when: not an object, an error, no text content, an upstream
// failure envelope, no data, or the footer (or a Source line) is already the last text.
export function withNewsFooter(result) {
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
    if (last === NEWS_FOOTER_LINE || SOURCE_LINE_RE.test(last.trim())) return result;
    return { ...result, content: [...result.content, { type: 'text', text: NEWS_FOOTER_LINE }] };
  } catch (_) {
    return result;
  }
}
