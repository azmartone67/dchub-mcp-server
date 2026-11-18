// 2026-11-16: Glama renders the README as the listing Overview, so the first
// paragraph under the H1 is the first thing a directory reader sees. It must
// lead with the orchestration / execute_plan sentence (electricity prices and
// power grid). The DCPI paragraph follows immediately and must still name
// Data Center Power Index (DCPI), carry the canon "300+ markets", and have
// no "$", no em dash. A teaser for new capacity listings (source_capacity /
// /listings) follows DCPI; it names no partner, MW figure, date, or price.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const afterH1 = readme.split(/^# .+$/m)[1] ?? '';
const paras = afterH1.trim().split(/\n\s*\n/);
const firstPara = paras[0] ?? '';
const dcpiPara = paras[1] ?? '';
const LEAD = 'DC Hub is the orchestration layer for data center and energy intelligence: start with execute_plan for electricity prices and power grid questions.';

describe('README opening', () => {
  it('first paragraph under the H1 is the orchestration lead', () => {
    expect(firstPara).toBe(LEAD);
  });
  it('the next paragraph names DCPI and 300+ markets', () => {
    expect(dcpiPara.startsWith('**[DCPI')).toBe(true);
    expect(dcpiPara).toContain('Data Center Power Index');
    expect(dcpiPara).toContain('300+ markets');
    expect(dcpiPara).toContain('https://dchub.cloud/dcpi');
  });
  it('the third paragraph teases new capacity listings, unnamed and without figures or dates', () => {
    expect(paras[2]).toBe('New data center capacity listings (pocket listings) are coming soon: query them with source_capacity, or browse https://dchub.cloud/listings.');
    expect(paras[2]).not.toMatch(/\$/);
    expect(paras[2]).not.toMatch(/\bMW\b/);
  });
  it('DCPI paragraph has no price and no em dash', () => {
    expect(dcpiPara).not.toMatch(/\$/);
    expect(dcpiPara).not.toContain('—');
  });
});
