// Owner (Brain note 2026-10-28, item 2): execute_plan leads the served tools/list; claim_free_key follows.
// The pure move, its kill switch, and the two lists that must NOT move: the frozen /mcp/chatgpt toolset and
// /mcp/grok. The served /mcp order itself is pinned in claim-handoff-keyless-walls.test.mjs.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import * as S from '../server.mjs';

const t = (n) => ({ name: n });
const names = (l) => l.map((x) => x.name);

describe('_frontDoorFirst', () => {
  it('puts execute_plan first and keeps every other tool in its order', () => {
    const out = S._frontDoorFirst([t('claim_free_key'), t('a'), t('execute_plan'), t('b')]);
    expect(names(out)).toEqual(['execute_plan', 'claim_free_key', 'a', 'b']);
  });

  it('after _claimKeyFirst the head is execute_plan, claim_free_key', () => {
    const out = S._frontDoorFirst(S._claimKeyFirst([t('a'), t('b'), t('execute_plan'), t('claim_free_key'), t('c')]));
    expect(names(out)).toEqual(['execute_plan', 'claim_free_key', 'a', 'b', 'c']);
  });

  it('is a no-op when execute_plan is absent or already first', () => {
    expect(names(S._frontDoorFirst([t('claim_free_key'), t('a')]))).toEqual(['claim_free_key', 'a']);
    expect(names(S._frontDoorFirst([t('execute_plan'), t('claim_free_key'), t('a')]))).toEqual(['execute_plan', 'claim_free_key', 'a']);
  });

  it('leaves a list without claim_free_key alone (the frozen ChatGPT toolset order, packs)', () => {
    const l = [t('a'), t('execute_plan'), t('b')];
    expect(names(S._frontDoorFirst(l))).toEqual(['a', 'execute_plan', 'b']);
  });

  it('DCHUB_EXECUTE_PLAN_FIRST=0 restores the claim-first order', () => {
    process.env.DCHUB_EXECUTE_PLAN_FIRST = '0';
    try {
      expect(names(S._frontDoorFirst([t('claim_free_key'), t('a'), t('execute_plan')]))).toEqual(['claim_free_key', 'a', 'execute_plan']);
    } finally { delete process.env.DCHUB_EXECUTE_PLAN_FIRST; }
  });

  it('the frozen ChatGPT toolset fixture is untouched by this change', () => {
    const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/chatgpt-toolset.frozen.json', import.meta.url), 'utf8'));
    const list = Array.isArray(fx) ? fx : fx.tools;
    expect(list.some((x) => x.name === 'claim_free_key')).toBe(false);   // so _frontDoorFirst never reorders it
    expect(names(S._frontDoorFirst(list))).toEqual(names(list));
  });
});

describe('the execute_plan description', () => {
  it('says it picks and chains the right tools and returns one dated, cited answer', () => {
    const spec = JSON.parse(fs.readFileSync(new URL('../toolspec.json', import.meta.url), 'utf8'));
    const tools = Array.isArray(spec) ? spec : spec.tools;
    const d = tools.find((x) => x.name === 'execute_plan').description;
    expect(d).toContain('it picks and chains the right tools and returns one dated, cited answer');
  });
});
