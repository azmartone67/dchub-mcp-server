// Every published calls/day claim must come from the canonical ladder.
//
// ★2026-08-23. This repo advertised the free tier as 10 calls/day (×12
// places), 50 calls/day, AND 100 calls/day — three numbers for one product —
// while the canonical ladder (dchub-backend tier_registry.TIER_LIMITS, served
// at /api/v1/tiers) says anonymous=5, free=10, identified=50. The anonymous
// figure moved 10 → 5 on 2026-08-03 specifically to restore a real first rung
// (anon 5 → free 10 → identified 50 → starter 200); every surface still saying
// 10 erased the rung that change existed to create and over-claimed 2x on the
// entry tier. smithery.yaml already said 5 in ONE line and 10 in three others.
//
// The canon is a committed snapshot (canonical/tier_limits.json, refreshed by
// scripts/refresh-tier-limits.mjs) so this gate is deterministic and
// network-free — the same contract as tool_maturity.json and canon_phrases.json.
//
// This is a GATE, not a healer: the prose shapes vary too much to auto-rewrite
// safely, and a wrong auto-rewrite of published copy is worse than a red build.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
// ★2026-09-27 (free-tier rule, owner decision D2): the snapshot's calls_per_day
// carries only PER-DAY rungs. Anonymous has no call count (previews, no key
// needed; A1 2026-10-03) and the free key is 10 calls IN TOTAL — both now
// live in `allowance`. CANON is the rung set a published number may name: the
// per-day rungs plus the free key's allowance count (10 is still the free rung;
// what is stale is the "/day" some frozen copy puts after it).
const SNAP = JSON.parse(read("canonical/tier_limits.json"));
const CANON = { ...SNAP.calls_per_day };
if (SNAP.allowance && SNAP.allowance.free && Number.isFinite(SNAP.allowance.free.calls)) {
  CANON.free = SNAP.allowance.free.calls;
}
// The retired anonymous figure ("5 calls/day", TIER_LIMITS 2026-08-03..09-27)
// still printed on these surfaces, per file. ★2026-09-27 copy follow-up: every
// unfrozen one now states the published rule. What is left is the Smithery
// description (smithery.yaml `description:`), which is frz-smithery-description
// — it moves after 2026-10-01, and this entry is removed with it. A NEW
// "5 calls/day" anywhere fails, and so does fixing this one without removing it.
// ★2026-10-02 MCP-text batch: the Smithery description now states the rule, so
// nothing is pinned.
const LEGACY_ANON_5 = {};
// The retired free-key figure ("10 calls/day"; the free key is 10 calls to try,
// lifetime). Left ONLY inside MCP tool descriptions (claim_free_key,
// unlock_more_data), which are frozen: the /mcp tools/list must stay
// byte-identical (frz-claude-relay-wording, until 2026-10-01) and the same text
// reaches /mcp/chatgpt (frz-chatgpt-toolset). Moves after 10-01.
// ★2026-10-02 MCP-text batch: both descriptions now say "calls to try", so
// nothing is pinned.
const LEGACY_FREE_10_PER_DAY = {};

// Everything an agent, a registry or an installing human actually reads.
const SURFACES = [
  // ★2026-09-05: scripts/smithery_description.txt was NOT here, and it is the
  // copy on the highest-volume external channel — the one surface an installing
  // agent reads before it ever reaches this repo. It carries no calls/day claim
  // today, so adding it changes nothing now; that is the point. The next person
  // to write a number into the listing gets the same gate as every other surface
  // instead of a silent third answer to "what is the free tier".
  "scripts/smithery_description.txt",
  "README.md", "llms-install.md", "DATA_QUALITY.md", "smithery.yaml",
  "mcp-server.json", "dxt/manifest.json", "integrations/README.md",
  "integrations/cohere/README.md", "integrations/chatgpt/README.md",
  "integrations/chatgpt/openapi.json",
];

// The published rule, verbatim (canon phrase `free_tier`, /api/v1/canon/phrases;
// dchub-backend ai_surface_canon.PINNED['free_tier_rule']). A surface quoting it
// whole names "Anonymous:" and "50 calls/day" in one sentence by design — that
// is the rule, not an anonymous 50/day claim.
const FREE_TIER_RULE = "Anonymous: previews, no key needed. "
  + "Free key: 10 calls to try. Add an email: 50 calls/day (up to 10 full answers "
  + "per tool per day). Paid plans: dchub.cloud/pricing.";
const CLAIM = /([\d,]+)\s*calls?\/day/gi;
const ANON_CTX = /anonymous|keyless|no signup|no api key|without one|no key needed/i;
const num = (s) => Number(String(s).replace(/,/g, ""));

function claims() {
  const out = [];
  for (const f of SURFACES) {
    const txt = read(f);
    txt.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(CLAIM)) {
        // ★2026-09-02: `text` is the WINDOW around the claim, not the whole
        // line. A tool description is one JSON line of ~4,000 chars, and the
        // manifests now carry them complete (the sync used to truncate chained
        // descriptions to their first literal) — so "keyless" 3,000 chars
        // upstream of "10 calls/day" must not read as an anonymous claim.
        const at = m.index ?? 0;
        let inRule = false;
        for (let r = line.indexOf(FREE_TIER_RULE); r !== -1; r = line.indexOf(FREE_TIER_RULE, r + 1)) {
          if (at >= r && at < r + FREE_TIER_RULE.length) inRule = true;
        }
        out.push({ file: f, line: i + 1, n: num(m[1]), inRule, text: line.slice(Math.max(0, at - 110), at + m[0].length + 40).trim() });
      }
    });
  }
  return out;
}

describe("published calls/day claims", () => {
  it("surfaces quote the published rule verbatim (and the exemption is not vacuous)", () => {
    const quoted = claims().filter((c) => c.inRule);
    expect(new Set(quoted.map((c) => c.file))).toEqual(
      new Set(["llms-install.md", "integrations/README.md", "mcp-server.json"]));
    expect(quoted.every((c) => c.n === 50)).toBe(true);
  });

  it("finds claims at all (guards against a vacuous pass)", () => {
    // Anonymous has no call count under the free-tier rule.
    expect(CANON.anonymous).toBeUndefined();
    expect(SNAP.allowance.anonymous.calls).toBeNull();
    expect(claims().length).toBeGreaterThan(10);
  });

  it("the retired anonymous 5/day survives only where it is pinned as residue", () => {
    const got = {};
    for (const c of claims().filter((x) => x.n === 5)) got[c.file] = (got[c.file] || 0) + 1;
    expect(got).toEqual(LEGACY_ANON_5);
  });

  it("the retired free-key 10 calls/day survives only in the frozen tool descriptions", () => {
    const got = {};
    for (const c of claims().filter((x) => x.n === 10)) got[c.file] = (got[c.file] || 0) + 1;
    expect(got).toEqual(LEGACY_FREE_10_PER_DAY);
  });

  it("no surface still prints a 3 calls/day taste", () => {
    expect(claims().filter((x) => x.n === 3).map((c) => `${c.file}:${c.line}`)).toEqual([]);
  });

  it("every number is a rung on the canonical ladder", () => {
    const allowed = new Set(Object.values(CANON));
    const bad = claims().filter((c) => c.n !== 5 && !allowed.has(c.n));
    expect(bad.map((b) => `${b.file}:${b.line} → ${b.n} calls/day`)).toEqual([]);
  });

  it("an anonymous/keyless claim names no other rung", () => {
    // THE regression. `10 calls/day` is a real rung (free), so a
    // ladder-membership check alone cannot catch "anonymous: 10 calls/day".
    // Anonymous has no calls/day figure at all now; the only anonymous-context
    // number tolerated is the pinned 5/day residue above.
    const bad = claims().filter((c) => ANON_CTX.test(c.text) && c.n !== 5 && !c.inRule);
    expect(bad.map((b) => `${b.file}:${b.line} → ${b.n} — ${b.text.slice(0, 70)}`))
      .toEqual([]);
  });

  it("no surface claims a free tier larger than the identified rung", () => {
    // "100 calls/day" for a free key matched no tier at all and outran even
    // the email-bound rung.
    const bad = claims().filter(
      (c) => /free tier|free key|dch_live_/i.test(c.text) && c.n > CANON.identified,
    );
    expect(bad.map((b) => `${b.file}:${b.line} → ${b.n}`)).toEqual([]);
  });
});

// ★2026-09-02: the ladder-membership check above could not see this one.
// smithery.yaml's pricing block said `free: "… 50 calls/day"` for a month —
// 50 IS a rung (identified), so membership passed — while the same file's
// configSchema said a FREE key is 10/day and canon says free=10 /
// identified=50. A pricing block is the one place a claim carries its tier
// LABEL, so it is checked label-by-label against canon, not by membership.
describe("smithery.yaml pricing block matches the ladder label-by-label", () => {
  const yaml = read("smithery.yaml");
  const at = yaml.indexOf("\npricing:");
  const tail = yaml.slice(at + 1);
  const end = tail.search(/\n[A-Za-z]/); // next top-level key, or EOF
  const block = end === -1 ? tail : tail.slice(0, end);
  const rows = [...block.matchAll(/^  (\w+):\s*"([^"]*)"/gm)].map((m) => ({ tier: m[1], text: m[2] }));

  it("finds the pricing rows (not a vacuous pass)", () => {
    expect(at).toBeGreaterThan(-1);
    expect(rows.map((r) => r.tier)).toEqual(
      // ★2026-09-22: no Starter row. The owner rule (2026-09-21, mcp#497) is that
      // Starter is offered nowhere; the rows left are the rungs /pricing sells.
      expect.arrayContaining(["anonymous", "free", "developer", "pro", "enterprise"]),
    );
  });

  // ★2026-09-27 owner decision D2: the anonymous row states the rule
  // ("previews, no key needed") and the free-key row states
  // "10 calls to try" — neither is a calls/day rung, so they are checked by the
  // rule's words. Every other row still carries its canonical calls/day rung.
  const RULE = {
    anonymous: /previews, no key/i,
    free: /10 calls to try/i,
  };
  for (const r of rows.filter((x) => RULE[x.tier])) {
    it(`${r.tier}: states the owner's free-tier rule, not a calls/day figure`, () => {
      expect(r.text).toMatch(RULE[r.tier]);
      expect(r.text).not.toMatch(/calls?\/day/i);
    });
  }
  for (const r of rows.filter((x) => !RULE[x.tier])) {
    it(`${r.tier}: the calls/day figure is canon's ${r.tier} rung`, () => {
      expect(CANON[r.tier], `no canonical rung is labelled "${r.tier}"`).toBeDefined();
      const m = r.text.match(/([\d,]+)\+?\s*calls?\/day/i);
      expect(m, `${r.tier} row states no calls/day figure: ${r.text}`).toBeTruthy();
      expect(num(m[1]), `smithery.yaml pricing.${r.tier} says ${m[1]} calls/day; canon says ${CANON[r.tier]}`)
        .toBe(CANON[r.tier]);
    });
  }
});

// ★2026-09-02 (D8): the served surface too. Measured 00:29Z: the free tier was
// described FOUR ways across the manifest family ("10 calls/day", "10 free
// calls total", "50 calls/day when bound", "5 dossiers/day") because every
// figure in server.mjs was a literal. They now interpolate lib/tier-canon.mjs
// (FREE_TIER / _callsPerDay), so a literal "<digits> calls/day" inside a
// server.mjs string is drift by construction — this fails on the first one.
describe("server.mjs states no rung as a literal", () => {
  const SRC = read("server.mjs").split("\n");
  const CODE = (l) => !/^\s*(\/\/|\/\*|\* )/.test(l);   // comments may quote history
  const LIT = /\b\d[\d,]*\s*(?:free\s+)?calls?(?:\/day|\s+total)\b/i;
  it("finds the interpolated sites at all (vacuity guard)", () => {
    const hits = SRC.filter((l) => CODE(l) && /FREE_TIER\.\w+_calls_per_day|_callsPerDay\('\w+'\)/.test(l));
    expect(hits.length).toBeGreaterThan(12);
  });
  it("no code line carries a literal N calls/day or N free calls total", () => {
    const bad = SRC.map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => CODE(l) && LIT.test(l));
    expect(bad.map((b) => `server.mjs:${b.n} → ${b.l.trim().slice(0, 90)}`)).toEqual([]);
  });
  it("no plan entry hardcodes calls_per_day", () => {
    const bad = SRC.map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => CODE(l) && /calls_per_day:\s*\d/.test(l));
    expect(bad.map((b) => `server.mjs:${b.n}`)).toEqual([]);
  });
  it("FREE_TIER mirrors the snapshot exactly", async () => {
    const { FREE_TIER } = await import("../lib/tier-canon.mjs");
    expect(FREE_TIER.anonymous_calls_per_day).toBe('n/a');   // no call count
    expect(FREE_TIER.free_calls_per_day).toBe(CANON.free);
    expect(FREE_TIER.identified_calls_per_day).toBe(CANON.identified);
    expect(FREE_TIER.unbound_calls_total).toBe(CANON.free);
  });
});

describe("the canon snapshot itself", () => {
  it("is a monotonic ladder", () => {
    // Anonymous sits off the call ladder (no call count); the free rung is
    // its allowance count, below the first per-day rung.
    const order = ["free", "identified", "starter", "developer", "pro", "enterprise"];
    for (let i = 1; i < order.length; i++) {
      expect(CANON[order[i]]).toBeGreaterThanOrEqual(CANON[order[i - 1]]);
    }
  });

  it("is derived, and says so", () => {
    const snap = JSON.parse(read("canonical/tier_limits.json"));
    expect(snap.source).toBe("/api/v1/tiers");
    expect(snap._comment).toMatch(/do not hand-edit/i);
  });

  it("every JSON surface it governs still parses", () => {
    for (const f of SURFACES.filter((f) => f.endsWith(".json"))) {
      expect(() => JSON.parse(read(f))).not.toThrow();
    }
  });
});

// ★2026-09-22: the registry-facing manifests offer no Starter. The owner rule
// (2026-09-21, mcp#497) removed Starter $9 from every surface server.mjs serves
// (test/no-starter-offer.test.mjs); these hand-authored manifests are what the
// registries and catalogues copy, and four of them still sold it. The smithery
// row check above would ACCEPT a Starter row (canon still has the rung for
// grandfathered subscribers), so absence is asserted here.
describe("registry manifests offer no Starter plan", () => {
  const FILES = ["smithery.yaml", "mcp-server.json", "REGISTRY-LISTINGS.md", "llms-install.md",
                 "README.md", "integrations/chatgpt/openapi.json"];
  const STARTER = /\bstarter\b[^\n]{0,40}\$\s?9(?![\d.,])|\$\s?9\/mo|\$\s?9 Starter|^\s*starter:/im;
  for (const f of FILES) {
    it(`${f} names no Starter offer`, () => {
      const m = read(f).match(STARTER);
      expect(m && m[0], `${f} still offers Starter: ${m && m[0]}`).toBeFalsy();
    });
  }
});

// ★2026-09-28 (owner rule 09-27): the sentence names no plan price. The MCP
// composes its own copy (lib/tier-canon.mjs _freeTierRuleText, served as
// structuredContent.free_tier_rule on claim_free_key and bind_email) from the
// tier snapshot, so it can drift from the pin above on its own.
describe("the composed free-tier rule", () => {
  it("is the published sentence verbatim and states no price", async () => {
    const { _freeTierRuleText } = await import("../lib/tier-canon.mjs");
    expect(_freeTierRuleText()).toBe(FREE_TIER_RULE);
    expect(FREE_TIER_RULE.endsWith(" Paid plans: dchub.cloud/pricing.")).toBe(true);
    expect(FREE_TIER_RULE).not.toMatch(/\$/);
  });
});
