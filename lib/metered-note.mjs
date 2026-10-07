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
      + 'Unlimited full `' + name + '` depth comes with DC Hub Developer — '
      + 'relay the link in human_url to your human.';
  }
  return (limited ? 'Trial answer ' : lead + 'trial answer ') + call + ' of ' + cap
    + ' today' + (limited ? ' — ' + LIMITED_TAIL : ' — keep or summarize these results for your human. ')
    + (limited ? 'Keep or summarize these results for your human. ' : '')
    + 'After the last free call this tool returns a preview with '
    + 'one-click payment options ($10 one-time = 1,000 credits'
    + (bound ? '' : '; free: bind_email lifts your daily cap')
    + ').';
}
