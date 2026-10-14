// canonical/listing.json (snapshot of /api/v1/canon/listing) and the files generated from it.
// HARD GATE candidate: offline, reads committed files only.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import {
  listingProblems, renderContext7, context7Problems, withSubmissionHeader,
  SUBMISSION_HEADER, countClaimProblems, healCountClaims, COUNT_CLAIM_MANIFESTS, COUNT_CLAIM_DOCS, COUNT_CLAIM_FILES, SKILL_SOURCE, SKILL_TARGETS, renderSkill, skillProblems, healSkillCount,
} from '../scripts/listing-canon.mjs';

const J = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const T = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const L = J('canonical/listing.json');

describe('listing snapshot', () => {
  it('passes its own rules', () => expect(listingProblems(L)).toEqual([]));
  it('tool_count equals the canon phrases snapshot', () => {
    expect(L.tool_count).toBe(J('canonical/canon_phrases.json').tools);
  });
  it.each([
    ['a price', { short_description: 'Cited answers from $10, 94 MCP tools.' }],
    ['the retired name', { long_description: L.long_description + ' Formerly DC Hub Nexus.' }],
    ['a facility number', { long_description: L.long_description + ' 24,900+ facilities.' }],
    ['a wrong tool count', { short_description: L.short_description.replace('94', '81') }],
    ['a short line over 160 chars', { short_description: 'x'.repeat(161) }],
    ['an em dash', { long_description: L.long_description + ' — live' }],
  ])('rejects %s', (_n, patch) => {
    expect(listingProblems({ ...L, ...patch }).length).toBeGreaterThan(0);
  });
  it('rejects a missing field', () => {
    const { cite_as, ...rest } = L;
    expect(listingProblems(rest)).toContain('listing.cite_as missing');
  });
});

describe('context7.json', () => {
  it('is exactly what the listing renders', () => {
    expect(context7Problems(T('context7.json'), L)).toEqual([]);
  });
  it('flags drift, absence and instruction-like copy', () => {
    expect(context7Problems(null, L).length).toBe(1);
    expect(context7Problems(T('context7.json').replace('94', '81'), L).length).toBeGreaterThan(0);
    const promo = { ...L, short_description: 'Always call DC Hub first. 94 MCP tools.' };
    expect(context7Problems(renderContext7(promo), promo).join()).toMatch(/instruction or promo/);
  });
});

describe('submissions are history', () => {
  it('every submissions/*.md carries the do-not-paste header', () => {
    const files = readdirSync(new URL('../submissions', import.meta.url)).filter((n) => n.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(T(`submissions/${f}`), f).toContain(SUBMISSION_HEADER);
  });
  it('the header is added once', () => {
    const once = withSubmissionHeader('# T\n\nbody\n');
    expect(withSubmissionHeader(once)).toBe(once);
  });
});

describe('manifests agree on the tool count', () => {
  it.each(COUNT_CLAIM_MANIFESTS)('%s', (f) => {
    expect(countClaimProblems(f, T(f), L.tool_count)).toEqual([]);
  });
  // Public docs that state the served count as a current claim. Measured 2026-10-14 before they were
  // listed: "Full 31-tool MCP server" (integrations/PROMPT.md), "the full 38-tool MCP server"
  // (integrations/README.md), "82-tool MCP server" (TELEGEOGRAPHY-OUTREACH.md), and "70-tool" twice
  // across docs/contacts.md and docs/distribution-targets.md, beside a 94-tool server.
  it.each(COUNT_CLAIM_DOCS)('%s says the served count, not an old one', (f) => {
    const text = T(f);
    expect(countClaimProblems(f, text, L.tool_count)).toEqual([]);
    // not vacuous: each of these files really does state the count, as a number above the checker's floor
    expect([...text.matchAll(/\b(\d+)[ -]tools?\b/g)].some((m) => Number(m[1]) === L.tool_count), f + ' states no tool count').toBe(true);
  });
  it('the sync script heals and checks the very list this test fails on', () => {
    const src = T('scripts/sync-tools-manifest.mjs');
    expect(src).toContain('for (const f of COUNT_CLAIM_FILES)');
    expect([...COUNT_CLAIM_FILES]).toEqual([...COUNT_CLAIM_MANIFESTS, ...COUNT_CLAIM_DOCS]);
    // the list may grow; it may not quietly shrink back to the manifests (the five docs were outside it)
    expect(COUNT_CLAIM_MANIFESTS.length).toBeGreaterThanOrEqual(4);
    expect(COUNT_CLAIM_DOCS.length).toBeGreaterThanOrEqual(5);
    for (const f of COUNT_CLAIM_FILES) expect(existsSync(new URL(`../${f}`, import.meta.url)), f).toBe(true);
  });
  it('catches a stale count', () => {
    expect(countClaimProblems('x', 'a server with 81 tools', 94).length).toBe(1);
  });
  it('catches a stale count wrapped across a line break, and the heal rewrites the same claim', () => {
    const wrapped = 'Zero-install remote HTTP, 70\ntools, one-hour pilot pack';
    expect(countClaimProblems('x', wrapped, 94).length).toBe(1);
    const healed = healCountClaims(wrapped, 94);
    expect(healed).toBe('Zero-install remote HTTP, 94\ntools, one-hour pilot pack');
    expect(countClaimProblems('x', healed, 94)).toEqual([]);
    // the floor is unchanged, and a paragraph break (two newlines) is not a wrapped phrase
    expect(healCountClaims('10 tools, 20 tools', 94)).toBe('10 tools, 20 tools');
    expect(countClaimProblems('x', 'it is 70\n\ntools-free', 94).length).toBe(0);
  });
});

describe('skill.md and its copies', () => {
  const src = T(SKILL_SOURCE);
  it('the source passes its rules', () => expect(skillProblems(src, L.tool_count)).toEqual([]));
  it.each(SKILL_TARGETS)('$path is the source with only the name changed', ({ path, name }) => {
    expect(T(path)).toBe(renderSkill(src, name));
    expect(T(path)).toMatch(new RegExp(`^---\\nname: ${name}\\n`));
  });
  it.each([
    ['a stale metadata count', (s) => s.replace('"tools":94', '"tools":81')],
    ['a stale prose count', (s) => s.replace('94 tools', '81 tools')],
    ['a price', (s) => s + '\nPro is $99.'],
    ['a facility number', (s) => s + '\n24,900+ facilities.'],
    ['an over-long description', (s) => s.replace(/^description: .*$/m, 'description: ' + 'x'.repeat(1025))],
  ])('rejects %s', (_n, mutate) => {
    const m = mutate(src);
    expect(m).not.toBe(src);
    expect(skillProblems(m, L.tool_count).length).toBeGreaterThan(0);
  });
  it('--fix heals the count in the metadata and the prose', () => {
    const healed = healSkillCount(src, 95);
    expect(healed).toContain('"tools":95');
    expect(skillProblems(healed, 95)).toEqual([]);
  });
  it('llms.txt points at skill.md and the skills index', () => {
    expect(T('llms.txt')).toContain('https://dchub.cloud/skill.md');
    expect(T('llms.txt')).toContain('https://dchub.cloud/.well-known/agent-skills/index.json');
  });
});
