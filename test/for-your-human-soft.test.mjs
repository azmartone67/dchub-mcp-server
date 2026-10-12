// for-your-human-soft.test.mjs — owner decisions 2026-10-11 (conversion panel plan).
//
// Decision 1: the separate "For your human" first-line rule is gone. It told agents to reproduce the
// "-> **For your human:**" line VERBATIM, link included, as the FIRST line of their (final) answer, and
// each for_your_human block carried "DO NOT summarize or paraphrase this block away ... emit the
// `markdown` field above exactly as written". The data stays (for_your_human, the line in results,
// the `render` machine field); only the order to agents is softened to "share it with your user along
// with its link".
//
// Decision 2: agent text states the free analyze_site allowance as "a few", never as a number, on every
// surface, whatever DCHUB_LP_FREE_RUNS_ANALYZE_SITE says.
//
// Every check runs a checker over the real surface AND over the old wording (must-fail control), so a
// checker that cannot see the old text fails here instead of passing silently.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  _composeInstructions, _accessTagFor, _connectRelay, _dealDeskHumanRelay,
  SITE_NOSID_KEY_LINE, SITE_KEY_LINK_MESSAGE, ANALYZE_SITE_ACCESS_B2, ANALYZE_SITE_ACCESS_PRE_B2,
} from '../server.mjs';
import { gatedPreviewHumanMessage, gatedPreviewLead } from '../lib/gated-preview.mjs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SRC = read('server.mjs');
const LLMS = read('llms.txt');

// The retired order. Any one of these in agent-facing text is a failure.
const FIRST_LINE_ORDER = [
  /reproduce it\s+verbatim/i,
  /as the first line of your (final )?answer/i,
  /first line of your final answer/i,
  /do not summari[sz]e or paraphrase/i,
  /exactly as written/i,
  /relay that line verbatim/i,
];
const orderHits = (s) => FIRST_LINE_ORDER.filter((re) => re.test(String(s))).map(String);

// A numeric monthly allowance ("3 full reports a month", "5 full site reports each month", "three ...").
const NUMERIC_ALLOWANCE = /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:free\s+)?(?:full\s+)?(?:site\s+)?(?:reports?|analys[ie]s|runs?)\s+(?:a|per|each|every)\s+month\b/i;

// The old texts, copied from origin/main before this change: the must-fail controls.
const OLD_LLMS_RULE = '- A gated response carries at most one line beginning `-> **For your human:**`. Reproduce it\n'
  + '  verbatim, link included, as the first line of your final answer. Paraphrasing it to';
const OLD_AGENTS_RULE = 'If the response carries a line beginning "-> **For your human:**", reproduce it verbatim, link\n'
  + 'included, as the first line of your answer to them.';
const OLD_AGENT_INSTRUCTION = 'DO NOT summarize or paraphrase this block away. Show your human the LINK ITSELF: '
  + 'emit the `markdown` field above exactly as written, as a clickable link in your reply.';
const OLD_TAG = 'Call the tool first: a gated result carries the link for this caller in its '
  + '`Tell the user:` / `For your human:` line. Relay that line verbatim; pricing_url is only a fallback.';
const OLD_ALLOWANCE = 'This is a preview, not the full site report. Unlock it free by email (3 full reports a month, no card):';

// Every `_agent_instruction: '...' + '...'` literal in server.mjs, concatenation included.
function agentInstructionLiterals(src) {
  const out = [];
  const re = /_agent_instruction:\s*((?:'(?:[^'\\]|\\.)*'\s*(?:\+\s*)?)+)/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1].match(/'(?:[^'\\]|\\.)*'/g).map((q) => q.slice(1, -1)).join(''));
  return out;
}

describe('controls: the checkers see the old wording', () => {
  it('first-line order checker fires on each old surface', () => {
    for (const s of [OLD_LLMS_RULE, OLD_AGENTS_RULE, OLD_AGENT_INSTRUCTION, OLD_TAG]) {
      expect(orderHits(s).length, s).toBeGreaterThan(0);
    }
  });
  it('numeric allowance checker fires on the old gated_preview line and on spelled-out numbers', () => {
    expect(OLD_ALLOWANCE).toMatch(NUMERIC_ALLOWANCE);
    expect('a free key adds 3 free full site reports each month').toMatch(NUMERIC_ALLOWANCE);
    expect('your next call returns the full report, three reports a month').toMatch(NUMERIC_ALLOWANCE);
    expect('a few free full site reports each month').not.toMatch(NUMERIC_ALLOWANCE);
  });
  it('the literal extractor finds concatenated _agent_instruction strings', () => {
    const got = agentInstructionLiterals("x = { _agent_instruction: 'DO NOT summarize or paraphrase ' + 'this', y: 1 }");
    expect(got).toEqual(['DO NOT summarize or paraphrase this']);
    expect(orderHits(got[0]).length).toBe(1);
  });
});

describe('decision 1: no "For your human" first-line / verbatim order to agents', () => {
  it('llms.txt shares the line softly', () => {
    expect(orderHits(LLMS)).toEqual([]);
    expect(LLMS).toContain('share it with your user\n  along with its link');
    expect(LLMS).toContain('`-> **For your human:**`');   // the line is still named, softly
  });
  it('initialize instructions (with and without facts) carry no first-line order', () => {
    for (const out of [_composeInstructions(null, Date.now())]) {
      expect(orderHits(out)).toEqual([]);
      expect(out).toContain('show it to your human with its link');
    }
  });
  it('the tools/list tag on every gated tool points at the line without ordering it verbatim', () => {
    const tag = _accessTagFor('analyze_site');
    expect(tag.upgrade_relay).toContain('For your human:');
    expect(tag.upgrade_relay).toContain('Share that line with your user along with its link');
    expect(orderHits(tag.upgrade_relay)).toEqual([]);
  });
  it('every _agent_instruction literal in server.mjs is soft (none skipped by the extractor)', () => {
    const lits = agentInstructionLiterals(SRC);
    const sites = (SRC.match(/_agent_instruction:\s*'/g) || []).length;
    expect(sites).toBeGreaterThanOrEqual(4);
    expect(lits.length).toBe(sites);
    for (const l of lits) expect(orderHits(l), l).toEqual([]);
  });
  it('the exported for_your_human builders keep their data and the render field, with soft wording', () => {
    const c = _connectRelay('dch_live_fyh_soft_fixture_key', 'grok');
    const d = _dealDeskHumanRelay({ pdf_url: 'https://dchub.cloud/reports/deal-desk/dd-FYH.pdf', status: 'ready' });
    for (const r of [c, d]) {
      expect(r.render).toBe('verbatim_link_required');   // machine field: left for the owner, see PR body
      expect(typeof r.markdown).toBe('string');
      expect(orderHits(r._agent_instruction)).toEqual([]);
      expect(r._agent_instruction).toMatch(/^Share /);
    }
  });
});

describe('decision 2: the free allowance is "a few", never a number, in agent text', () => {
  it('gated_preview lead and human_message, whatever the gate allows', () => {
    for (const env of [{}, { DCHUB_LP_FREE_RUNS_ANALYZE_SITE: '3' }, { DCHUB_LP_FREE_RUNS_ANALYZE_SITE: '7' }]) {
      const m = gatedPreviewHumanMessage('https://dchub.cloud/u/abc234', env);
      expect(gatedPreviewLead(env)).toContain('a few free full site reports each month');
      expect(m).not.toMatch(NUMERIC_ALLOWANCE);
    }
  });
  it('analyze_site access lines, key-link lines, llms.txt and the shipped manifests', () => {
    const surfaces = {
      ANALYZE_SITE_ACCESS_B2, ANALYZE_SITE_ACCESS_PRE_B2, SITE_NOSID_KEY_LINE, SITE_KEY_LINK_MESSAGE,
      'llms.txt': LLMS, 'toolspec.json': read('toolspec.json'), 'mcp-server.json': read('mcp-server.json'),
      'integrations/packs/siting.json': read('integrations/packs/siting.json'),
    };
    for (const [k, v] of Object.entries(surfaces)) {
      expect(typeof v, k).toBe('string');
      expect(v, k).not.toMatch(NUMERIC_ALLOWANCE);
    }
    expect(ANALYZE_SITE_ACCESS_B2 + ANALYZE_SITE_ACCESS_PRE_B2).toContain('a few free full site reports each month');
    expect(SITE_NOSID_KEY_LINE).toContain('a few times each month');
  });
});
