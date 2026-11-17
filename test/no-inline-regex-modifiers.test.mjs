// Production runs node:20-alpine (Dockerfile). Inline regex modifier groups — (?i:...), (?-i:...), (?ims-i:...) —
// need V8 12.5+ (Node 23): on Node 20 a module that builds one throws SyntaxError at import and the server never
// starts. Local Node 24 and vitest accept them, so nothing else here catches it. Found in mcp#1518 (lib/neutral-
// connect.mjs, "FREE weekly" matched in capitals via (?-i:...)); the image's own build-and-introspect check went red.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const files = () => {
  const out = [path.join(ROOT, 'server.mjs')];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(?:mjs|js)$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, 'lib'));
  return out;
};
// "(?" then modifier letters with an optional "-" part, then ":" — never (?:, (?=, (?!, (?<=, (?<!, (?<name>.
const INLINE_MODIFIER = /\(\?[imsx]*-?[imsx]+:/;

describe('no inline regex modifier groups (Node 20 cannot parse them)', () => {
  it('server.mjs and lib/ build none', () => {
    const hits = [];
    for (const f of files()) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (INLINE_MODIFIER.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits).toEqual([]);
  });
  it('the pattern finds the form that broke the image, and not the groups Node 20 has', () => {
    expect(INLINE_MODIFIER.test('new RegExp(`(?:a)|(?-i:${X})`, "i")')).toBe(true);
    expect(INLINE_MODIFIER.test('/(?i:free)/')).toBe(true);
    for (const ok of ['/(?:a|b)/', '/(?=x)/', '/(?!x)/', '/(?<=x)/', '/(?<!x)/', '/(?<name>x)/']) expect(INLINE_MODIFIER.test(ok), ok).toBe(false);
  });
});
