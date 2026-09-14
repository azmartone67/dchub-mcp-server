// ★HARD GATE, NO NETWORK. scripts/refresh-toolspec.mjs, refresh-tool-maturity.mjs
// and refresh-problem-taxonomy.mjs each called main() at import. main() fetches
// live data first and rewrites a committed snapshot when that works, so
// importing one made a live fetch from a test:
// test/snapshot-repairs-missing-keys.test.mjs imports refresh-problem-taxonomy
// for buildSnapshot. Each script now runs main() only when it is the entrypoint.
// Both directions are pinned here without the network: fetch is replaced by a
// function that rejects, in this process and in the child that runs each script.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STUBBED = 'fetch stubbed by test';
const STUB_FETCH = `data:text/javascript,globalThis.fetch = async () => { throw new Error("${STUBBED}") };`;

afterEach(() => vi.unstubAllGlobals());

describe.each([
  ['refresh-toolspec', 'toolspec refresh:'],
  ['refresh-tool-maturity', 'maturity refresh:'],
  ['refresh-problem-taxonomy', 'taxonomy refresh:'],
])('scripts/%s.mjs', (name, says) => {
  it('importing it fetches nothing', async () => {
    const fetch = vi.fn(async () => { throw new Error(STUBBED); });
    vi.stubGlobal('fetch', fetch);
    await import(`../scripts/${name}.mjs`);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('running it as a script still runs main(), which reaches its fetch', () => {
    const r = spawnSync(process.execPath, ['--import', STUB_FETCH, `scripts/${name}.mjs`], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    const out = r.stdout + r.stderr;
    expect(out).toContain(says);
    expect(out).toContain(STUBBED);
  });
});
