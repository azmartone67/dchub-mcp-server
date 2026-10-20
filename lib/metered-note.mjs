// The `_metered_trial.note` line on a metered free/paid taste answer.
//
// It used to say "Full-fidelity trial answer N of M today" on EVERY metered answer,
// including ones the tier had capped (get_market_intel list: 10 of 132 markets,
// locked 122). `limited` is true when detectGating proved something was withheld
// from THIS payload, and then the note says so instead of claiming full fidelity.

const LIMITED_TAIL = 'this answer is tier-limited (see provenance.preview for what is withheld), '
  + 'so do not present it as the complete dataset. ';

export function meteredTrialNote({ paidTaste, limited, call, cap, name, bound, emailAllowance, frozen }) {
  const lead = limited ? '' : 'Full-fidelity ';
  // Item 3 (owner draft 2026-10-16): the email-bound grid/queue allowance. No pack, no plan, no price:
  // past the cap the tool returns its preview with one link for the human.
  if (emailAllowance) {
    return (limited ? 'Answer ' : lead + 'answer ') + call + ' of ' + cap + ' today for this email-bound key on `'
      + name + '`' + (limited ? ' — ' + LIMITED_TAIL : '. ')
      + 'After the last one, `' + name + '` returns a preview with one link for your human until 00:00 UTC.';
  }
  if (paidTaste) {
    return (limited ? 'Answer ' : lead + 'answer ') + call + ' of the ' + cap
      + ' included with your plan today on this tool'
      + (limited ? ' — ' + LIMITED_TAIL : '. ')
      // Trust fix 2026-10-20: no plan named, no instruction to the agent. `frozen` (the
      // /mcp/chatgpt seat, in OpenAI review) keeps the reviewed sentence byte-identical.
      + (frozen
        ? 'Unlimited full `' + name + '` depth comes with a paid DC Hub plan — '
          + 'relay the link in human_url to your human.'
        : 'Full result for a person: see human_url.');
  }
  return (limited ? 'Trial answer ' : lead + 'trial answer ') + call + ' of ' + cap
    + ' today' + (limited ? ' — ' + LIMITED_TAIL : ' — keep or summarize these results for your human. ')
    + (limited ? 'Keep or summarize these results for your human. ' : '')
    + 'After the last free call this tool returns a preview with '
    + 'one-click payment options (a one-time pack of 1,000 credits'
    + (bound ? '' : '; free: bind_email lifts your daily cap')
    + ').';
}

// ★2026-10-20 (agent QA round 2, item 6): the note is stamped BEFORE the >120KB taste trim
// (_teaseDepth), so a get_fiber_intel answer read "Full-fidelity trial answer 1 of 10" while
// provenance.completeness said partial_preview. The trim path calls this on the note it keeps:
// it rewrites an unlimited note into the limited wording. A note already limited is unchanged.
export function limitMeteredNote(note) {
  if (typeof note !== 'string' || !/^Full-fidelity /.test(note)) return note;
  let t = note.replace(/^Full-fidelity (\w)/, (_m, ch) => ch.toUpperCase());
  t = t.replace(/^((?:Trial answer|Answer) [^—.]*? (?:today(?: for this email-bound key on `[^`]+`)?|today on this tool))(?:\. | — keep or summarize these results for your human\. )/,
    (_m, head) => head + ' — ' + LIMITED_TAIL + (/^Trial answer/.test(head) ? 'Keep or summarize these results for your human. ' : ''));
  return t;
}

// ── the unlock copy on a granted answer that the free tier field-masked ───────────────────
// The auto-mint block is built BEFORE the free-tier mask runs, so it cannot know that score and
// total_mw (rank_markets) will be nulled, and it told an agent "`rank_markets` is FULL on this
// session now … N more full answers today". This runs on the FINAL result, where
// provenance.preview.withheld_fields is proven from the payload actually served, and rewrites
// exactly those three phrasings. Untouched answers, and any result without proven withholding,
// pass through unchanged.
const _s = (n) => (Number(n) === 1 ? '' : 's');
// True when a parsed payload (or its structuredContent) says it is a partial answer.
function _isPartial(o) {
  if (!o || typeof o !== 'object') return false;
  const pv = o.provenance;
  return o.preview_is_partial === true || o._taste_bounded === true || o.taste_bounded === true
    || !!(pv && (pv.completeness === 'partial_preview' || (pv.preview && pv.preview.withholding_proven === true)));
}

// A partial answer never carries "Full-fidelity" (item 6). Runs on the FINAL result.
export function noFullFidelityOnPartial(result) {
  try {
    if (!result || !Array.isArray(result.content)) return result;
    const sc = result.structuredContent;
    let partial = _isPartial(sc);
    const parsed = result.content.map((c) => {
      if (!c || typeof c.text !== 'string' || !/^\s*\{/.test(c.text)) return null;
      try { const o = JSON.parse(c.text); if (_isPartial(o)) partial = true; return o; } catch (_) { return null; }
    });
    if (!partial) return result;
    let changed = false;
    const content = result.content.map((c, i) => {
      if (!c || typeof c.text !== 'string' || !c.text.includes('Full-fidelity')) return c;
      const o = parsed[i];
      if (o && o._metered_trial && typeof o._metered_trial.note === 'string') {
        changed = true;
        return { ...c, text: JSON.stringify({ ...o, _metered_trial: { ...o._metered_trial, note: limitMeteredNote(o._metered_trial.note) } }) };
      }
      changed = true;
      return { ...c, text: c.text.replace(/Full-fidelity ((?:trial )?answer)/g, (_m, w) => w.charAt(0).toUpperCase() + w.slice(1)) };
    });
    let out = changed ? { ...result, content } : result;
    if (sc && sc._metered_trial && typeof sc._metered_trial.note === 'string' && /^Full-fidelity /.test(sc._metered_trial.note)) {
      out = { ...out, structuredContent: { ...sc, _metered_trial: { ...sc._metered_trial, note: limitMeteredNote(sc._metered_trial.note) } } };
    }
    return out;
  } catch (_) { return result; }
}

export function limitedAnswerCopy(result0) {
  const result = noFullFidelityOnPartial(result0);
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
