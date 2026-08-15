// r-endburst (2026-08-15, conversion item 2) — end-of-burst return hook.
//
// MEASURED: agents do a deep ~40-call burst, complete, and LEAVE (median 39.5
// calls/agent/7d). END-OF-BURST is the return moment, not "come back
// tomorrow". Completion-shaped tools (execute_plan final assembly,
// get_shortlist, generate_site_analysis) append ONE compact hook line on
// SUCCESS: next session, whats_changed/get_changes returns only the delta —
// plus, for UNBOUND callers only, the bind_email keep-this-key clause.
// HONESTY pins: no digest/email promise (sends are disarmed).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { withEndOfBurstHook, END_OF_BURST_TOOLS, END_OF_BURST_MARKER, _composeInstructions } from '../server.mjs';
import { MPP_COVERED_TOOLS } from '../mpp-hook.mjs';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs'), 'utf8');

const ok = () => ({
  content: [{ type: 'text', text: JSON.stringify({ _entity: 'plan_execution', executed: [] }) }],
  structuredContent: { _entity: 'plan_execution' },
});
const ANON = { tier: 'free' };                       // unbound (bindable)
const PAID = { tier: 'paid', api_key: 'dch_live_x', email: 'h@co.com' };

describe('end-of-burst hook — present on completion tools', () => {
  it('appends ONE whats_changed line to every completion tool success', () => {
    for (const tool of ['execute_plan', 'get_shortlist', 'generate_site_analysis']) {
      const r = withEndOfBurstHook(ok(), tool, PAID);
      const hooks = r.content.filter((it) => it.text && it.text.includes('whats_changed'));
      expect(hooks.length, tool).toBe(1);
      expect(hooks[0].text).toContain('get_changes');           // the LIVE tool
      expect(hooks[0].text).toContain('/dchub:whats_changed');  // the recipe
      expect(hooks[0].text.toLowerCase()).toContain('since');   // delta semantics
      expect(r.structuredContent._end_of_burst.next_tool).toBe('get_changes');
      // content[0] preserved for downstream JSON.parse
      expect(() => JSON.parse(r.content[0].text)).not.toThrow();
    }
  });

  it('is idempotent — a second pass never stacks a second line', () => {
    const r = withEndOfBurstHook(withEndOfBurstHook(ok(), 'execute_plan', PAID), 'execute_plan', PAID);
    expect(r.content.filter((it) => it.text && it.text.includes('whats_changed')).length).toBe(1);
  });

  // 2026-08-15 REGRESSION (review finding): the idempotency guard originally
  // scanned content text for the substring 'whats_changed' — which
  // execute_plan's OWN payload serializes whenever its next_recipe FALLBACK
  // fires ({ prompt: 'whats_changed' } for any intent_class outside the 7
  // mapped ones, i.e. the flagship tool's DEFAULT path). The hook read its own
  // input as "already hooked" and silently self-suppressed. The guard now keys
  // on the hook's OWN marker (END_OF_BURST_MARKER) + the structured flag.
  it("attaches on execute_plan's real fallback payload (next_recipe contains 'whats_changed')", () => {
    const sc = {
      _entity: 'plan_execution',
      executed: [],
      next_recipe: { prompt: 'whats_changed', why: 'See what moved in the dataset since this call — the return hook.' },
    };
    const real = {
      content: [{ type: 'text', text: JSON.stringify(sc) }],
      structuredContent: sc,
    };
    const r = withEndOfBurstHook(real, 'execute_plan', PAID);
    expect(r.structuredContent._end_of_burst).toBeTruthy();
    expect(r.content.filter((it) => it.text && it.text.includes(END_OF_BURST_MARKER)).length).toBe(1);
    // second pass on the real payload: still exactly one hook line
    const r2 = withEndOfBurstHook(r, 'execute_plan', PAID);
    expect(r2.content.filter((it) => it.text && it.text.includes(END_OF_BURST_MARKER)).length).toBe(1);
  });

  it('the hook line begins with the marker the idempotency guard keys on', () => {
    const r = withEndOfBurstHook(ok(), 'execute_plan', PAID);
    const hook = r.content.find((it) => it.text && it.text.includes(END_OF_BURST_MARKER));
    expect(hook.text.startsWith(END_OF_BURST_MARKER)).toBe(true);
    // and the marker is NOT a substring a tool payload can innocently contain
    expect(END_OF_BURST_MARKER).not.toBe('whats_changed');
  });

  it('unbound caller gets the bind_email recoverability clause; bound/paid does NOT', () => {
    const anon = withEndOfBurstHook(ok(), 'get_shortlist', ANON);
    const anonHook = anon.content.find((it) => it.text && it.text.includes('whats_changed'));
    expect(anonHook.text).toContain('bind_email');
    expect(anonHook.text).toContain('saved work');
    // HONESTY (2026-08-15 review): bind_email's own description says binding
    // makes a key RECOVERABLE, not durable — "keeps this key alive" was the
    // exact durability claim it disclaims. Pin the honest verb, ban the old one.
    expect(anonHook.text).toContain('recoverable');
    expect(anonHook.text).not.toContain('alive');
    expect(anon.structuredContent._end_of_burst.bind_hint).toContain('bind_email');
    expect(anon.structuredContent._end_of_burst.bind_hint).toContain('recoverable');
    expect(anon.structuredContent._end_of_burst.bind_hint).not.toContain('alive');

    const paid = withEndOfBurstHook(ok(), 'get_shortlist', PAID);
    const paidHook = paid.content.find((it) => it.text && it.text.includes('whats_changed'));
    expect(paidHook.text).not.toContain('bind_email');
    expect(paid.structuredContent._end_of_burst.bind_hint).toBeUndefined();
  });

  it('HONEST copy: no digest/email-delivery promise (sends are disarmed)', () => {
    const r = withEndOfBurstHook(ok(), 'execute_plan', ANON);
    const hook = r.content.find((it) => it.text && it.text.includes('whats_changed'));
    expect(hook.text.toLowerCase()).not.toContain('digest');
    expect(hook.text.toLowerCase()).not.toContain('we will email');
    expect(hook.text.toLowerCase()).not.toContain('subscribe');
  });
});

describe('end-of-burst hook — absent elsewhere', () => {
  it('non-completion tools are untouched', () => {
    for (const tool of ['get_grid_intelligence', 'search_facilities', 'get_changes', 'plan_query']) {
      expect(END_OF_BURST_TOOLS.has(tool), tool).toBe(false);
      const r = withEndOfBurstHook(ok(), tool, PAID);
      expect(r.content.length).toBe(1);
      expect(r.structuredContent._end_of_burst).toBeUndefined();
    }
  });

  it('error responses are untouched (isError AND JSON error payloads)', () => {
    const err = { ...ok(), isError: true };
    expect(withEndOfBurstHook(err, 'execute_plan', PAID).content.length).toBe(1);
    const authReq = {
      content: [{ type: 'text', text: JSON.stringify({ error: 'auth_required' }) }],
      structuredContent: { error: 'auth_required' },
    };
    const r = withEndOfBurstHook(authReq, 'get_shortlist', ANON);
    expect(r.content.length).toBe(1);
    expect(r.structuredContent._end_of_burst).toBeUndefined();
  });

  it('the generic keyed return-nudge can never stack on the hooked tools', () => {
    // Source pin on _RETURN_NUDGE_SKIP: every END_OF_BURST tool must be listed.
    const skipBlock = SRC.slice(SRC.indexOf('const _RETURN_NUDGE_SKIP'),
                                SRC.indexOf(']);', SRC.indexOf('const _RETURN_NUDGE_SKIP')));
    for (const tool of END_OF_BURST_TOOLS) expect(skipBlock).toContain(`'${tool}'`);
  });

  it('the three handlers actually route through the hook (source pins)', () => {
    expect(SRC).toContain("}, 'execute_plan', c);");
    expect(SRC).toContain("}, 'get_shortlist', null);");
    expect(SRC).toContain("}, 'generate_site_analysis', null);");
  });

  // Latent-coupling pin (2026-08-15 review): the prewall/undercap offer attach
  // REPLACES result.content wholesale, which would drop an appended hook line
  // if a hooked tool ever became MPP-payable. Today the sets are disjoint —
  // pin it so a pricing edit cannot silently create the collision.
  it('END_OF_BURST_TOOLS stay disjoint from the MPP payable set', () => {
    expect(MPP_COVERED_TOOLS.length, 'MPP payable set is empty — pin is vacuous').toBeGreaterThan(0);
    for (const tool of END_OF_BURST_TOOLS) {
      expect(MPP_COVERED_TOOLS.includes(tool),
        `${tool} is both END_OF_BURST and MPP-payable — the offer attach would drop the hook line`).toBe(false);
    }
  });
});

describe('initialize instructions carry BOTH doctrines', () => {
  // The blob only reaches generic clients (prompt-override law) — exactly the
  // mcp-remote channel most in need of both behaviours.
  it('verbatim human-line relay + end-of-burst whats_changed, in both compose paths', () => {
    const withFigures = _composeInstructions({
      generated_at: new Date().toISOString(),
      numbers: {
        facilities: '18,000+', countries: '170+', markets: '300+', deals: '1,800+',
        substations: '126k', infrastructure_assets_total: '320,000+',
        transmission_lines: '94k', fiber_routes: '55k', gas_pipelines: '30k',
        power_plants_us: '13k', submarine_cables: '690+', cable_landings: '1,900+',
        generating_units_global: '182k', live_feeds: 7, grid_regions: 49,
      },
    }, Date.now());
    const noFigures = _composeInstructions(null, Date.now());
    for (const out of [withFigures, noFigures]) {
      // doctrine 1 — verbatim human line, FIRST line of the final answer
      expect(out).toContain('→ **For your human:**');
      expect(out).toContain('VERBATIM');
      expect(out).toContain('FIRST line of your final answer');
      // doctrine 2 — end-of-burst whats_changed return hook
      expect(out).toContain('whats_changed');
      expect(out).toContain('get_changes');
      expect(out).toContain('bind_email');
      // honesty: the doctrines promise no digest/email sends. Hardened
      // (2026-08-15 review): assert the heading EXISTS before slicing after
      // it, so a heading rename can never make this check pass vacuously.
      const parts = out.split('END OF BURST');
      expect(parts.length, 'END OF BURST heading missing from instructions').toBeGreaterThan(1);
      expect(parts[1]).not.toContain('digest');
      // honesty: bind_email makes a key recoverable — never "keeps it alive"
      expect(parts[1]).toContain('recoverable');
      expect(parts[1]).not.toContain('alive');
    }
  });
});
