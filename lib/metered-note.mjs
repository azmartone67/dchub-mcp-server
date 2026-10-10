// The `_metered_trial.note` line on a metered free/paid taste answer.
//
// It used to say "Full-fidelity trial answer N of M today" on EVERY metered answer,
// including ones the tier had capped (get_market_intel list: 10 of 132 markets,
// locked 122). `limited` is true when detectGating proved something was withheld
// from THIS payload, and then the note says so instead of claiming full fidelity.

const LIMITED_TAIL = 'this answer is tier-limited (see provenance.preview for what is withheld), '
  + 'so do not present it as the complete dataset. ';

export function meteredTrialNote({ paidTaste, limited, call, cap, name, bound }) {
  const lead = limited ? '' : 'Full-fidelity ';
  if (paidTaste) {
    return (limited ? 'Answer ' : lead + 'answer ') + call + ' of the ' + cap
      + ' included with your plan today on this tool'
      + (limited ? ' — ' + LIMITED_TAIL : '. ')
      + 'Unlimited full `' + name + '` depth comes with a paid DC Hub plan — '
      + 'relay the link in human_url to your human.';
  }
  return (limited ? 'Trial answer ' : lead + 'trial answer ') + call + ' of ' + cap
    + ' today' + (limited ? ' — ' + LIMITED_TAIL : ' — keep or summarize these results for your human. ')
    + (limited ? 'Keep or summarize these results for your human. ' : '')
    + 'After the last free call this tool returns a preview with '
    + 'one-click payment options (a one-time pack of 1,000 credits'
    + (bound ? '' : '; free: bind_email lifts your daily cap')
    + ').';
}

// ── the unlock copy on a granted answer that the free tier field-masked ───────────────────
// The auto-mint block is built BEFORE the free-tier mask runs, so it cannot know that score and
// total_mw (rank_markets) will be nulled, and it told an agent "`rank_markets` is FULL on this
// session now … N more full answers today". This runs on the FINAL result, where
// provenance.preview.withheld_fields is proven from the payload actually served, and rewrites
// exactly those three phrasings. Untouched answers, and any result without proven withholding,
// pass through unchanged.
const _s = (n) => (Number(n) === 1 ? '' : 's');
export function limitedAnswerCopy(result) {
  try {
    const sc = result && result.structuredContent;
    if (!sc || typeof sc !== 'object' || sc.inline_full !== true) return result;
    const prev = sc.provenance && sc.provenance.preview;
    if (!prev || prev.withholding_proven !== true) return result;
    const names = (prev.withheld_fields || []).map(String).filter(Boolean).slice(0, 4);
    if (!names.length) return result;
    const wh = names.join(', ');
    const fix = (t) => String(t)
      .replace(/→ `([^`]+)` is FULL on this session now \(free for (\d+) days(?:, (\d+) full answers? left today)?\) — just call it again\./g,
        (_m, tool, days, left) => '→ `' + tool + '` is free on this session now, with ' + wh + ' withheld at this tier (free for '
          + days + ' days' + (left !== undefined ? ', ' + left + ' free answer' + _s(left) + ' left today' : '') + ').')
      .replace(/ — you have (\d+) more full answers? today on the free trial/g,
        (_m, n) => ' — you have ' + n + ' more free answer' + _s(n) + ' today on the free trial (' + wh + ' stay withheld at this tier)')
      .replace(/\(you have (\d+) more full answers? today on the free trial\)/g,
        (_m, n) => '(you have ' + n + ' more free answer' + _s(n) + ' today on the free trial; ' + wh + ' stay withheld at this tier)');
    const content = Array.isArray(result.content)
      ? result.content.map((c) => (c && typeof c.text === 'string' ? { ...c, text: fix(c.text) } : c))
      : result.content;
    const out = { ...result, content };
    const sc2 = { ...sc };
    if (typeof sc2.retry_instructions === 'string') sc2.retry_instructions = fix(sc2.retry_instructions);
    out.structuredContent = sc2;
    return out;
  } catch (_) { return result; }
}
