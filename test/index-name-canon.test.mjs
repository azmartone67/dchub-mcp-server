// ── idx-name-canon (owner, 2026-09-27) ──
//
// The two indices are the "Data Center Power Index (DCPI)" and the "Data
// Center Gas Index (DCGI)". That is what /dcpi and /dcgi title themselves, what
// /api/v1/dcgi/scores returns in "index", and what the published comparison
// brief v5 prints. The retired "DC Hub … Index" form must not come back into
// any tracked file outside the exemptions below.
//
// Exemptions are per FILE and each one says why. A dated exemption expires:
// after `until` the file is no longer exempt, so the follow-up cannot be
// forgotten — this test goes red and names it.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Built from parts so this file does not match itself.
const OLD = ['DC', 'Hub'].join(' ');
const LEGACY = OLD + ' (Power|Gas) Index';

export const EXEMPT = {
  // OpenAI app-directory review freeze (frz-chatgpt-toolset): the reviewed
  // /mcp/chatgpt descriptions and their snapshots may not move until review closes.
  'lib/chatgpt-directory.mjs': { why: 'frz-chatgpt-toolset (OpenAI review)' },
  'test/fixtures/chatgpt-toolset.frozen.json': { why: 'frz-chatgpt-toolset snapshot' },
  'test/fixtures/chatgpt-directory.pre-claude.mjs': { why: 'pre-claude snapshot fixture' },
  // frz-claude-relay-wording: /mcp instructions + tools/list stay byte-identical
  // until the 2026-10-01 readout. The manifests below are generated from server.mjs.
  'server.mjs': { why: 'frz-claude-relay-wording (instructions, tool descriptions)', until: '2026-10-02' },
  'toolspec.json': { why: 'generated from server.mjs tool descriptions', until: '2026-10-02' },
  'mcp-server.json': { why: 'generated from server.mjs tool descriptions', until: '2026-10-02' },
  'integrations/packs/gas.json': { why: 'generated from server.mjs tool descriptions', until: '2026-10-02' },
  'integrations/packs/siting.json': { why: 'generated from server.mjs tool descriptions', until: '2026-10-02' },
  // History: these quote text that was served or scraped at the time.
  'scripts/registry_monitor.py': { why: 'self-test case quoting external registry copy' },
  'test/no-live-dcgi-claims.test.mjs': { why: 'comment quoting what was served until 2026-08-30' },
  'test/asset-quantities-heal-registry-copy.test.mjs': { why: 'comment quoting a registry listing' },
};

export function legacyHits(files, today = new Date().toISOString().slice(0, 10)) {
  return files.filter((f) => {
    const ex = EXEMPT[f];
    return !ex || (ex.until && today >= ex.until);
  });
}

function filesWithLegacy() {
  try {
    return execFileSync('git', ['grep', '-l', '-i', '-I', '-E', LEGACY], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch (e) {
    if (e.status === 1) return []; // git grep: no match
    throw e;
  }
}

describe('idx-name-canon: the retired "DC Hub … Index" names stay retired', () => {
  it('no tracked file outside the exemptions carries the retired name', () => {
    expect(legacyHits(filesWithLegacy())).toEqual([]);
  });

  it('CONTROL: an unexempted file is reported, and a dated exemption expires', () => {
    expect(legacyHits(['README.md'])).toEqual(['README.md']);
    expect(legacyHits(['server.mjs'], '2026-10-01')).toEqual([]);
    expect(legacyHits(['server.mjs'], '2026-10-02')).toEqual(['server.mjs']);
  });

  it('CONTROL: the pattern matches the retired forms and not the canon ones', () => {
    const rx = new RegExp(LEGACY, 'i');
    expect(rx.test(`the ${OLD} Power Index (DCPI)`)).toBe(true);
    expect(rx.test(`${OLD} Gas Index`.toUpperCase())).toBe(true);
    expect(rx.test('the Data Center Power Index (DCPI)')).toBe(false);
  });

  it('every exemption still points at a file that carries the name (no dead entries)', () => {
    const hits = new Set(filesWithLegacy());
    expect(Object.keys(EXEMPT).filter((f) => !hits.has(f))).toEqual([]);
  });
});
