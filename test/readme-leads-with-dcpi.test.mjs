// 2026-10-09: Glama renders the README as the listing Overview, so the first
// paragraph under the H1 is the first thing a directory reader sees. It must
// lead with DCPI, carry the canon "300+ markets" and no "$", no em dash.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const afterH1 = readme.split(/^# .+$/m)[1] ?? '';
const firstPara = afterH1.trim().split(/\n\s*\n/)[0] ?? '';

describe('README leads with DCPI', () => {
  it('first paragraph under the H1 names DCPI and 300+ markets', () => {
    expect(firstPara.startsWith('**[DCPI')).toBe(true);
    expect(firstPara).toContain('300+ markets');
    expect(firstPara).toContain('https://dchub.cloud/dcpi');
  });
  it('first paragraph has no price and no em dash', () => {
    expect(firstPara).not.toMatch(/\$/);
    expect(firstPara).not.toContain('—');
  });
});
