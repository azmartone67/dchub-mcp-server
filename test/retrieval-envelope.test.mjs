// retrieval-envelope.test.mjs — RAG-1 (Grok self-improving Brain handoff, 2026-10-02).
//
// Measured live 2026-10-02 on keyless search_intelligence q="ERCOT large load queue GW":
//
//   results[].score       null, _score_in_pro: true, score_band: "AVOID"   (every hit)
//   corpus                3 names, _corpus_total_in_pro: 10
//   _upgrade.message      "This answer hid scores and the count, and 7 more rows."
//   citation.cite_as      "PARTIAL preview, 3 of 10 shown"
//   _results_total_in_pro 8   (3 shown → the real gap is 5)
//
// `score` here is 0-1 retrieval relevance. The generic depth gate banded it with the
// DCPI 0-100 bands, so 0.91 read as AVOID. `corpus` is request metadata, and trimming
// it is what produced "7 more rows" and "3 of 10".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { trimForTrial, TRIAL_PREVIEW_ROWS, RETRIEVAL_TOOLS, RETRIEVAL_PUBLIC_CORPORA,
         _INTEL_CORPUS_MAP } from '../server.mjs';
import { collectMissed, missedSentence } from '../lib/upgrade-missed.mjs';

// The backend's answer for a caller this server counts as keyed: 8 hits, all 10 corpora.
function ragPayload() {
  return {
    _cite: 'Data: DC Hub (dchub.cloud)',
    corpus: [...RETRIEVAL_PUBLIC_CORPORA],
    count: 8,
    ok: true,
    query: 'ERCOT large load queue GW',
    results: Array.from({ length: 8 }, (_, i) => ({
      cite: { title: 't' + i, slug: 's' + i, published_at: '2026-07-01' },
      cosine: 0.83,
      kind: 'press',
      score: 0.91 - i * 0.01,
      source_id: String(100 + i),
      source_table: 'press_releases',
      text: 'body ' + i,
    })),
  };
}

const BANDS = /\b(BUILD|CAUTION|AVOID)\b/;

describe('RAG-1: retrieval envelope truthfulness on the free-tier trim', () => {
  for (const tool of RETRIEVAL_TOOLS) {
    describe(tool, () => {
      const out = trimForTrial(ragPayload(), tool);

      it('no DCPI band word anywhere in a retrieval result', () => {
        expect(JSON.stringify(out)).not.toMatch(BANDS);
        for (const r of out.results) {
          expect(r).not.toHaveProperty('score_band');
          expect(r).not.toHaveProperty('_score_in_pro');
        }
      });

      it('relevance score passes through unchanged', () => {
        expect(out.results.map((r) => r.score)).toEqual(ragPayload().results.slice(0, out.results.length).map((r) => r.score));
      });

      it('corpus list is not row-trimmed', () => {
        expect(out.corpus).toEqual([...RETRIEVAL_PUBLIC_CORPORA]);
        expect(out).not.toHaveProperty('_corpus_total_in_pro');
      });

      it('results are still trimmed, and the hidden count is total minus shown', () => {
        expect(out.results.length).toBe(TRIAL_PREVIEW_ROWS);
        expect(out._results_total_in_pro).toBe(8);
        const m = collectMissed(out, []);
        expect(m.rows).toEqual({ field: 'results', shown: TRIAL_PREVIEW_ROWS, total: 8 });
        // Either wording is honest: "showed 3 of 8 results" or "…, and 5 more results".
        const line = missedSentence(m, tool);
        expect(line).toMatch(new RegExp(`(${TRIAL_PREVIEW_ROWS} of 8 |\\b${8 - TRIAL_PREVIEW_ROWS} more )`));
        expect(line).not.toMatch(/scores|of 10\b|\b7 more/);
      });
    });
  }

  // ★ The exemption is tool-scoped. If it leaked to the name `score`, every DCPI
  // surface would publish the number its band stands in for.
  it('score is still depth-gated and banded on a non-retrieval tool', () => {
    const out = trimForTrial({ market: 'x', score: 82 }, 'get_market_dcpi_rank');
    expect(out.score).toBeNull();
    expect(out._score_in_pro).toBe(true);
    expect(out.score_band).toBe('BUILD');
  });

  it('a non-retrieval tool still row-trims an array named corpus', () => {
    const out = trimForTrial({ corpus: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'get_news');
    expect(out.corpus.length).toBe(TRIAL_PREVIEW_ROWS);
    expect(out._corpus_total_in_pro).toBe(6);
  });
});

describe('RAG-1: the descriptions name the corpora the backend serves', () => {
  // The backend's PUBLIC_CORPORA in public names (dchub-backend routes/brain_rag.py,
  // PUBLIC_CORPORA mapped through _PUBLIC_CORPUS_OUT, at 2cd6d4e). The backend repo is
  // private, so this is copied; a change there must change it here.
  const BACKEND = ['news_articles', 'deals', 'facilities', 'market_narratives',
    'press_releases', 'announcements', 'permitting_intel', 'construction_permits',
    'tax_incentives', 'capacity_pipeline'];
  const BACKEND_ACCEPTS = new Set([...BACKEND, 'discovered_facilities', 'tax_incentives_neon']);

  it('RETRIEVAL_PUBLIC_CORPORA equals the backend list', () => {
    expect([...RETRIEVAL_PUBLIC_CORPORA].sort()).toEqual([...BACKEND].sort());
  });

  it('every search_intelligence short name maps to a corpus the backend accepts', () => {
    for (const [k, v] of Object.entries(_INTEL_CORPUS_MAP)) {
      expect(BACKEND_ACCEPTS.has(v), `${k} -> ${v}`).toBe(true);
    }
    const reached = new Set(Object.values(_INTEL_CORPUS_MAP)
      .map((v) => (v === 'discovered_facilities' ? 'facilities' : v)));
    expect([...reached].sort()).toEqual([...BACKEND].sort());
  });

  // mcp-server.json is rewritten from server.mjs by `npm run sync:fix` (toolspec.json
  // only refreshes from the live gateway after a deploy, so it lags this PR).
  it('the shipped tool descriptions name every corpus', () => {
    const spec = JSON.parse(readFileSync(new URL('../mcp-server.json', import.meta.url), 'utf8'));
    const tools = Array.isArray(spec) ? spec : (spec.tools || []);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    const sem = JSON.stringify(byName.semantic_search);
    for (const c of BACKEND) expect(sem, `semantic_search names ${c}`).toContain(c);
    const si = JSON.stringify(byName.search_intelligence);
    for (const c of ['news', 'deals', 'facilities', 'market_narratives', 'press',
      'announcements', 'permitting', 'permits', 'incentives', 'pipeline']) {
      expect(si, `search_intelligence names ${c}`).toContain(c);
    }
  });
});
