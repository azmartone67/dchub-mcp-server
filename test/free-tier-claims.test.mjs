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
const CANON = JSON.parse(read("canonical/tier_limits.json")).calls_per_day;

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
        out.push({ file: f, line: i + 1, n: num(m[1]), text: line.slice(Math.max(0, at - 110), at + m[0].length + 40).trim() });
      }
    });
  }
  return out;
}

describe("published calls/day claims", () => {
  it("finds claims at all (guards against a vacuous pass)", () => {
    expect(CANON.anonymous).toBe(5);
    expect(claims().length).toBeGreaterThan(10);
  });

  it("every number is a rung on the canonical ladder", () => {
    const allowed = new Set(Object.values(CANON));
    const bad = claims().filter((c) => !allowed.has(c.n));
    expect(bad.map((b) => `${b.file}:${b.line} → ${b.n} calls/day`)).toEqual([]);
  });

  it("an anonymous/keyless claim states the anonymous rung", () => {
    // THE regression. `10 calls/day` is a real rung (free), so a
    // ladder-membership check alone cannot catch "anonymous: 10 calls/day".
    const bad = claims().filter(
      (c) => ANON_CTX.test(c.text) && c.n !== CANON.anonymous,
    );
    expect(bad.map((b) => `${b.file}:${b.line} → ${b.n}, expected ${CANON.anonymous} — ${b.text.slice(0, 70)}`))
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
      expect.arrayContaining(["anonymous", "free", "starter", "developer", "pro", "enterprise"]),
    );
  });

  for (const r of rows) {
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
    expect(FREE_TIER.anonymous_calls_per_day).toBe(CANON.anonymous);
    expect(FREE_TIER.free_calls_per_day).toBe(CANON.free);
    expect(FREE_TIER.identified_calls_per_day).toBe(CANON.identified);
    expect(FREE_TIER.unbound_calls_total).toBe(CANON.free);
  });
});

describe("the canon snapshot itself", () => {
  it("is a monotonic ladder", () => {
    const order = ["anonymous", "free", "identified", "starter", "developer", "pro", "enterprise"];
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
