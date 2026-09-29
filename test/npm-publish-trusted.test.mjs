// npm-publish-trusted.test.mjs — (2026-09-28)
//
// Pins .github/workflows/npm-publish.yml, which publishes npm-launcher/ as the
// npm package `dchub-mcp-server` via npm trusted publishing (GitHub OIDC).
// The properties that make it safe are all easy to lose in an edit:
//   - `id-token: write` (without it OIDC cannot mint, and the publish fails —
//     or someone "fixes" it by adding a token);
//   - NO NPM_TOKEN / NODE_AUTH_TOKEN secret anywhere (OIDC only);
//   - a version-parity guard that fails before publish when npm-launcher's
//     version disagrees with server.json;
//   - a skip-if-published guard, and the publish step actually gated on it;
//   - main-only, npm >= 11.5.1, --provenance --access public, 4-file tarball.
//
// No YAML parser on purpose (the repo has none; see
// registry-publish-ref-gated.test.mjs). Every extraction below is asserted to
// have found something, so a guard that silently matches nothing fails here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const WORKFLOW = new URL('../.github/workflows/npm-publish.yml', import.meta.url);
const text = readFileSync(WORKFLOW, 'utf8');

/** Drop comment-only lines so a mention in a comment cannot satisfy a check. */
const code = text
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

/** The steps of the publish job, each as { name, body }. */
function steps(src) {
  const out = [];
  const parts = src.split(/\n {6}- /).slice(1);
  for (const p of parts) {
    const m = p.match(/^name:\s*(.+)$/m) || p.match(/^uses:\s*(.+)$/m);
    out.push({ name: m ? m[1].trim() : '', body: `- ${p}` });
  }
  return out;
}
const allSteps = steps(code);
const find = (re) => allSteps.findIndex((s) => re.test(s.name));

describe('npm-publish.yml — trusted publishing', () => {
  it('extraction finds the steps it claims to read', () => {
    expect(allSteps.length).toBeGreaterThanOrEqual(6);
    expect(find(/^Publish/)).toBeGreaterThan(-1);
  });

  it('grants id-token: write and only contents: read', () => {
    const perms = code.match(/^permissions:\n((?: {2}.+\n)+)/m);
    expect(perms, 'top-level permissions block').not.toBeNull();
    expect(perms[1]).toMatch(/^ {2}id-token:\s*write\b/m);
    expect(perms[1]).toMatch(/^ {2}contents:\s*read\b/m);
    expect(perms[1].match(/:\s*write\b/g)).toHaveLength(1);
  });

  it('uses no npm token secret — OIDC only', () => {
    expect(code).not.toMatch(/NPM_TOKEN/);
    expect(code).not.toMatch(/NODE_AUTH_TOKEN/);
    expect(code).not.toMatch(/secrets\./);
    expect(code).not.toMatch(/_authToken/);
  });

  it('publishes only from main, on a version-file push or dispatch', () => {
    expect(code).toMatch(/^ {4}if:\s*github\.ref == 'refs\/heads\/main'\s*$/m);
    expect(code).toMatch(/push:\n {4}branches:\n {6}- main\n/);
    for (const p of ['server.json', 'npm-launcher/**']) expect(code).toContain(`- '${p}'`);
  });

  it('sets up node against registry.npmjs.org and ensures npm >= 11.5.1', () => {
    expect(code).toMatch(/registry-url:\s*'https:\/\/registry\.npmjs\.org'/);
    const i = find(/npm >= 11\.5\.1/);
    expect(i).toBeGreaterThan(-1);
    expect(allSteps[i].body).toContain("npm install -g 'npm@^11.5.1'");
    expect(i).toBeLessThan(find(/^Publish/));
  });

  it('fails when npm-launcher version != server.json version, before publishing', () => {
    const i = find(/^Version parity/);
    expect(i).toBeGreaterThan(-1);
    const body = allSteps[i].body;
    expect(body).toContain('require("./server.json").version');
    expect(body).toContain('require("./npm-launcher/package.json").version');
    expect(body).toMatch(/\[ "\$LAUNCHER" != "\$SERVER" \][\s\S]*?exit 1/);
    expect(i).toBeLessThan(find(/^Publish/));
  });

  it('skips when the version is already on npm, and the publish is gated on it', () => {
    const i = find(/already published/);
    expect(i).toBeGreaterThan(-1);
    const body = allSteps[i].body;
    expect(body).toContain('id: published');
    expect(body).toContain('npm view "dchub-mcp-server@$VERSION" version');
    expect(body).toMatch(/\[ "\$out" = "\$VERSION" \][\s\S]*?skip=true/);
    const pub = allSteps[find(/^Publish/)].body;
    expect(pub).toMatch(/if:\s*steps\.published\.outputs\.skip == 'false'/);
    expect(i).toBeLessThan(find(/^Publish/));
  });

  it('publishes npm-launcher/ with --provenance --access public', () => {
    const pub = allSteps[find(/^Publish/)].body;
    expect(pub).toMatch(/working-directory:\s*npm-launcher\b/);
    expect(pub).toMatch(/run:\s*npm publish --provenance --access public\s*$/m);
  });

  it('dry-run packs and requires exactly the 4 expected tarball files', () => {
    const i = find(/Dry-run pack/);
    expect(i).toBeGreaterThan(-1);
    const body = allSteps[i].body;
    expect(body).toContain('npm pack --dry-run --json');
    expect(body).toContain('["LICENSE", "README.md", "bin/dchub-mcp-server.mjs", "package.json"]');
    expect(body).toContain('process.exit(1)');
    expect(i).toBeLessThan(find(/^Publish/));
  });
});
