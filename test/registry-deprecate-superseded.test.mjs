// registry-deprecate-superseded.test.mjs (2026-10-03, CM-6)
//
// registry-refresh.yml can mark superseded cloud.dchub/mcp-server versions
// `deprecated`. That is a public listing change, so the step must stay:
//   - gated: a workflow_dispatch boolean that defaults to false, or the publish
//     step reporting it created a new version (2026-10-09, PR 4);
//   - deprecate-only: never `--status deleted`, never `--all-versions`;
//   - latest-safe: the isLatest entry is filtered out before any call.
// Read as text (no YAML dependency), like registry-publish-ref-gated.test.mjs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const TEXT = readFileSync(new URL('../.github/workflows/registry-refresh.yml', import.meta.url), 'utf8');

export function deprecateStep(text) {
  const i = text.indexOf('- name: Deprecate superseded registry versions');
  if (i === -1) return null;
  const rest = text.slice(i + 2);
  const j = rest.search(/\n {6}- name: /);
  return j === -1 ? rest : rest.slice(0, j);
}

export function verdict(text) {
  const step = deprecateStep(text);
  if (!step) return 'missing';
  if (!/if: \(github\.event_name == 'workflow_dispatch' && inputs\.deprecate_superseded == true\) \|\| steps\.publish\.outputs\.published == 'true'/.test(step)) return 'not-gated';
  // the auto trigger is only as good as the output it reads: the publish step
  // must carry id: publish and write published=true on success only
  if (!/id: publish/.test(text) || !/Successfully published"\)?[\s\S]{0,200}published=true/.test(text)) return 'publish-output-missing';
  if (/--status\s+deleted|--all-versions/.test(step)) return 'destructive';
  if (!/--status deprecated/.test(step)) return 'no-deprecate';
  if (!/not m\.get\("isLatest"\)/.test(step)) return 'latest-unsafe';
  const input = text.match(/deprecate_superseded:\n(?: {8}.*\n)+/);
  if (!input || !/type: boolean/.test(input[0]) || !/default: false/.test(input[0])) return 'input-not-off';
  return 'ok';
}

describe('registry deprecate-superseded step', () => {
  it('is opt-in, deprecate-only and never touches isLatest', () => {
    expect(verdict(TEXT)).toBe('ok');
  });
  it('controls: each unsafe variant is caught', () => {
    expect(verdict(TEXT.replace('--status deprecated', '--status deleted'))).toBe('destructive');
    expect(verdict(TEXT.replace('"$REG_NAME" "$v"', '--all-versions "$REG_NAME"'))).toBe('destructive');
    expect(verdict(TEXT.replace(" && inputs.deprecate_superseded == true", ''))).toBe('not-gated');
    expect(verdict(TEXT.replace(" || steps.publish.outputs.published == 'true'", ' || true'))).toBe('not-gated');
    expect(verdict(TEXT.replace('id: publish', 'id: pub'))).toBe('publish-output-missing');
    expect(verdict(TEXT.replace('published=true', 'published=false'))).toBe('publish-output-missing');
    expect(verdict(TEXT.replace('or not m.get("isLatest")', 'or True'))).toBe('latest-unsafe');
    expect(verdict(TEXT.replace(/(deprecate_superseded:\n(?: {8}.*\n)*? {8}default: )false/, '$1true'))).toBe('input-not-off');
    expect(verdict(TEXT.replace('- name: Deprecate superseded registry versions', '- name: x'))).toBe('missing');
  });
});
