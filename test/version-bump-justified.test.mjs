// version-bump-justified.test.mjs (owner item D3, 2026-11-14): a version bump must carry a
// tool, description or install-config change. scripts/version-bump-justified.mjs is the
// check; manifest-consistency.yml runs it on every PR (the required `check` context).
//
// Each case builds a throwaway git repo (test/helpers/repo-sandbox.mjs) with the release
// surfaces the script reads, applies one change, and asserts the verdict.
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { judge, RELEASE_OK_LABEL } from '../scripts/version-bump-justified.mjs';
import { createScratchRepo } from './helpers/repo-sandbox.mjs';

const PPK = 'io.modelcontextprotocol.registry/publisher-provided';
const repos = [];
afterAll(() => { for (const d of repos) d.cleanup(); });

// A minimal tree with every surface the script reads, at a version.
function tree(d, v, { tools = [{ name: 'a', description: 'A.' }], meta = { toolCount: 1, licence: 'x' },
  title = 'T', bin = 'console.log(1)\n', remotes = ['https://dchub.cloud/mcp'] } = {}) {
  d.write('server.json', JSON.stringify({ name: 'cloud.dchub/mcp-server', title, version: v,
    remotes: remotes.map((url) => ({ type: 'streamable-http', url })),
    packages: [{ registryType: 'npm', identifier: 'dchub-mcp-server', version: v }],
    _meta: { [PPK]: meta } }, null, 2));
  d.write('mcp-server.json', JSON.stringify({ name: 'dchub', version: v, tools }, null, 2));
  d.write('package.json', JSON.stringify({ name: 'dchub-mcp-server', version: v, description: 'D' }, null, 2));
  d.write('npm-launcher/package.json', JSON.stringify({ name: 'dchub-mcp-server', version: v, description: 'D', bin: { x: 'bin/x.mjs' } }, null, 2));
  d.write('npm-launcher/bin/x.mjs', bin);
  d.write('smithery.yaml', `# c\nname: dchub\nversion: "${v}"\ndescription: "D"\n`);
}
function repo(build) {
  const d = createScratchRepo('vbump'); repos.push(d);
  tree(d, '1.0.0'); d.commit('v1.0.0');
  const base = d.git('rev-parse', 'HEAD').trim();
  build(d);
  return { d, base };
}
const verdict = (build, opts) => { const { d, base } = repo(build); return judge(d.root, base, opts); };

describe('a version bump must carry a release change', () => {
  it('no bump: nothing to justify (most PRs)', () => {
    const v = verdict((d) => { d.write('other.txt', 'x'); d.commit('unrelated'); });
    expect(v).toMatchObject({ ok: true, ran: true });
    expect(v.reason).toMatch(/no version bump/);
  });

  it('RED: a version-only bump (no surface moved)', () => {
    const v = verdict((d) => { tree(d, '1.0.1'); d.commit('bump only'); });
    expect(v.ok).toBe(false);
    expect(v.ran).toBe(true);
    expect(v.reason).toMatch(/no tool, description or install-config change/);
  });

  it('RED: the 2.12.53 shape, a bump whose only change is registry metadata in _meta', () => {
    const v = verdict((d) => { tree(d, '1.0.1', { meta: { toolCount: 1 } }); d.commit('drop licence + bump'); });
    expect(v.ok).toBe(false);
  });

  it.each([
    ['tools (a new tool)', { tools: [{ name: 'a', description: 'A.' }, { name: 'b', description: 'B.' }], meta: { toolCount: 2, licence: 'x' } }, 'tools'],
    ['a tool description', { tools: [{ name: 'a', description: 'A, reworded.' }] }, 'tools'],
    ['the registry title', { title: 'T2' }, 'server_json'],
    ['install config: remotes', { remotes: ['https://dchub.cloud/mcp', 'https://dchub.cloud/mcp/x'] }, 'server_json'],
    ['install config: the npm launcher bin', { bin: 'console.log(2)\n' }, 'npm_launcher_bin'],
  ])('green: a bump that carries %s', (_label, opts, surface) => {
    const v = verdict((d) => { tree(d, '1.0.1', opts); d.commit('change + bump'); });
    expect(v.ok).toBe(true);
    expect(v.changed).toContain(surface);
  });

  it('green: a change that merged WITHOUT a release justifies the later version-only bump (2.12.49 shape)', () => {
    const d = createScratchRepo('vbump'); repos.push(d);
    tree(d, '1.0.0'); d.commit('v1.0.0');
    tree(d, '1.0.0', { title: 'T2' }); d.commit('title, no bump');
    const prBase = d.git('rev-parse', 'HEAD').trim();
    tree(d, '1.0.1', { title: 'T2' }); d.commit('bump only');
    // the PR itself moves nothing but the version; it is judged against the commit that SET 1.0.0
    const v = judge(d.root, prBase);
    expect(v.ok).toBe(true);
    expect(v.changed).toContain('server_json');
  });

  it(`the '${RELEASE_OK_LABEL}' label lets a bump through and says why`, () => {
    const v = verdict((d) => { tree(d, '1.0.1'); d.commit('bump only'); }, { releaseOk: true });
    expect(v.ok).toBe(true);
    expect(v.reason).toMatch(new RegExp(`allowed by the '${RELEASE_OK_LABEL}' label`));
  });

  it('fails open, saying so, when the base is not in the clone', () => {
    const { d } = repo((r) => { tree(r, '1.0.1'); r.commit('bump only'); });
    const v = judge(d.root, '0000000000000000000000000000000000000000');
    expect(v).toMatchObject({ ok: true, ran: false });
    expect(v.reason).toMatch(/did not run/);
  });
});

describe('manifest-consistency.yml runs it on every PR', () => {
  const WF = readFileSync(new URL('../.github/workflows/manifest-consistency.yml', import.meta.url), 'utf8');
  // the one step that names the script, from its `- name:` to the next step
  const steps = WF.split(/\n(?=\s*- (?:name|uses|run):)/);
  const step = steps.find((s) => s.includes('scripts/version-bump-justified.mjs')) || '';
  it('has the step, on pull_request, with the PR base sha and the release-ok label', () => {
    expect(step).not.toBe('');
    expect(step).toMatch(/if:\s*github\.event_name == 'pull_request'/);
    expect(step).toMatch(/node scripts\/version-bump-justified\.mjs --base "\$BASE_SHA"/);
    expect(step).toMatch(/BASE_SHA:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}/);
    expect(step).toMatch(new RegExp(`contains\\(github\\.event\\.pull_request\\.labels\\.\\*\\.name,\\s*'${RELEASE_OK_LABEL}'\\)`));
  });
  it('can fail the required check (not continue-on-error)', () => {
    expect(step).not.toMatch(/continue-on-error/);
  });
});
