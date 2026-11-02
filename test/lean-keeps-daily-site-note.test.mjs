// The lean step keeps the daily site lane's run-count note (Brain 2026-11-02, live check of mcp#1236).
//
// Measured live 11-02 02:36Z, keyless analyze_site on /mcp: the full answer and
// structuredContent.daily_site_runs {used 1, limit 2} arrived, but the text blocks were the JSON,
// "🔒 This answer hid time to power … → https://dchub.cloud/u/…" and the Source line. The note
// "Free full site analysis without a key: 1 of 2 today (UTC) …" was gone: it names claim_free_key, so
// lib/lean-response.mjs counted it as an ask, and the one ask kept was the paragraph with human_url.
// The loopback harness never mints that /u/ line, so the e2e daily-lane tests could not see this; the
// result below is the live block shape.
import { describe, it, expect } from 'vitest';
import { leanResponseStep } from '../lib/lean-response.mjs';

const URL = 'https://dchub.cloud/u/c6qq88';
const NOTE = 'Free full site analysis without a key: 1 of 2 today (UTC). 1 left today.'
  + ' A free key (claim_free_key) adds monthly full analyses of its own.';
const KEYED_NOTE = "Free daily full site analysis 2 of 2 today (UTC), after this key's monthly runs."
  + ' That was the last one today: the next analyze_site call returns the preview until UTC midnight.';
const LOCK = '\u{1F512} This answer hid time to power. They come with the DC Hub plan that includes every tool → '
  + URL + ' The verdict, composite score and bands are not withheld.';
const SOURCE = 'Source: DC Hub (dchub.cloud), as of 2026-11-02';
const SC = { overall_score: 81.8, human_url: URL, human_message: 'Open ' + URL,
  daily_site_runs: { used: 1, limit: 2, remaining: 1 } };

const run = (note, sc = SC) => leanResponseStep({
  content: [{ type: 'text', text: JSON.stringify({ overall_score: 81.8 }) },
    { type: 'text', text: note }, { type: 'text', text: LOCK }, { type: 'text', text: SOURCE }],
  structuredContent: sc,
}, 'analyze_site');
const texts = (r) => r.content.map((b) => b.text);

describe('a daily site run keeps its run-count note', () => {
  it('keyless: the note is the one ask kept, the 🔒 link line goes', () => {
    const t = texts(run(NOTE));
    expect(t).toContain(NOTE);
    expect(t.join('\n')).not.toContain(URL);
    expect(t[t.length - 1]).toBe(SOURCE);
  });
  it('keyed wording too', () => {
    expect(texts(run(KEYED_NOTE))).toContain(KEYED_NOTE);
  });
  it('human_url stays in structuredContent', () => {
    expect(run(NOTE).structuredContent.human_url).toBe(URL);
  });
});

describe('controls', () => {
  it('no daily_site_runs: the human_url line is the ask kept, as before', () => {
    const { daily_site_runs, ...sc } = SC;
    const t = texts(run(NOTE, sc));
    expect(t).toContain(LOCK);
    expect(t).not.toContain(NOTE);
  });
  it('a run-count look-alike that is not the note is not kept over the link', () => {
    const other = 'Free tier: claim_free_key for 2 of 2 today.';
    const t = texts(run(other));
    expect(t).toContain(LOCK);
    expect(t).not.toContain(other);
  });
});
