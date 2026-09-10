// A client-config block must never name `streamable-http` as its transport.
//
// ★ WHY THIS LIVES HERE, in the repo that OWNS canon.
//
// This defect has now been fixed three times downstream and never here:
//   dchub-backend #4264  /connect hand-wrote three client configs, all wrong
//   dchub-backend #4282  five more Flask surfaces, same value
//   dchub-backend #4289  32 STATIC files, 24 of them under static/integrations/
// plus dchub-frontend #1433, which added the equivalent guard there.
//
// Both of those repos had to hardcode canon's shapes into their guard, because
// neither holds a copy of canon to check against — and a guard that hardcodes
// what it is checking goes stale the moment canon moves, while still reporting
// green. THIS repo does not have that problem: `persist_config.clients` in
// server.mjs IS canon, so this guard DERIVES its invariant by parsing that
// block rather than restating it. If someone adds `streamable-http` to a client
// snippet in server.mjs, this fails — the downstream guards cannot see that.
//
// ★ THE DISTINCTION — and it is the whole point, because a blind
// find-and-replace of `streamable-http` would be wrong on every occurrence in
// this repo (5 of 5 today, all correct):
//
//   `streamable-http` IS a real MCP transport name, and it is the CORRECT
//   value when DC Hub describes ITSELF — server.json remotes[0].type,
//   mcp-server.json transport, smithery.yaml type, a registry submission entry.
//   Those are what we publish about our own server and they stay.
//
//   It is NEVER the value in a CLIENT CONFIG — the block a human pastes into
//   Claude Desktop, Cursor, Cline, VS Code, Windsurf, Gemini CLI or
//   Antigravity. A wrong transport there does not fail loudly; it is a
//   connector that silently does not load.
//
// ★★ THE WINDOW IS DIRECTIONAL AND FENCE-CLIPPED. Both halves were learned the
// expensive way downstream:
//
//   BACKWARD only — dchub-backend's static/.well-known/ai-agents.json carried
//   `mcp.transport` (correct) and `mcp.client_config.mcpServers…transport` (a
//   defect) ten lines apart, with the marker between them. A symmetric window
//   flags the correct one, and the obvious way to make CI green is to "fix" a
//   value that was right.
//
//   CLIPPED AT A FENCE — the first version of the backend guard, pointed at
//   THIS repo, flagged docs/one-click-install.md:52. That line is correct:
//   Continue.dev nests a TRANSPORT OBJECT (`transport: {type: …}`) rather than
//   keying a server entry, so `streamable-http` is right for its schema. The
//   marker that flagged it belonged to Cursor's block, five lines and one fence
//   above. A doc that lists one fenced block per client will do this every time.
//
// A false positive is not a spare line of output here: this guard's remedy is
// "change the value", so it walks the next person into breaking a correct
// config. Both probes below pin that it does not.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// `transport` / `type` keyed to the forbidden value, in JSON or in JS emitting
// JSON. Whitespace-flexible, both quote styles.
const FORBIDDEN = /["']?(?:transport|type)["']?\s*:\s*["']streamable-http["']/;
// The same defect in Claude Code's CLI form, invisible to the JSON pattern.
const FORBIDDEN_CLI = /--transport\s+streamable-http/;

// What makes a block a CLIENT CONFIG rather than a self-description: the key
// that OPENS the container a client keys on.
//
// ★ NOT `"dchub"`. dchub-backend #4282 used it as a discriminator; over three
// narrow globs it was harmless, but repo-wide it is our own name sitting next
// to every self-description, and it flagged 20 correct occurrences there.
const CFG_MARKERS = ["mcpServers", '"servers"', "'servers'"];
const CFG_WINDOW = 10;
const FENCE = "```";

// sdk/ vendors its own examples and ships its own runners; not our surface.
const SKIP = /^(sdk|node_modules)\//;

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !SKIP.test(f));
}

/** Is there a config marker in the SAME block, at or above line i? */
function windowHasMarker(lines, i) {
  let win = lines.slice(Math.max(0, i - CFG_WINDOW), i + 1);
  const fences = win.reduce(
    (acc, l, k) => (l.trimStart().startsWith(FENCE) ? [...acc, k] : acc), []);
  if (fences.length) win = win.slice(fences[fences.length - 1]);
  const joined = win.join("\n");
  return CFG_MARKERS.some((m) => joined.includes(m));
}

function violationsIn(files) {
  const bad = [];
  for (const f of files) {
    let lines;
    try {
      lines = readFileSync(join(ROOT, f), "utf8").split("\n");
    } catch {
      continue;
    }
    lines.forEach((line, i) => {
      if (FORBIDDEN_CLI.test(line)) {
        bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
        return;
      }
      if (!FORBIDDEN.test(line)) return;
      if (windowHasMarker(lines, i)) {
        bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
  return bad;
}

/** The `clients: { … }` object out of persist_config, by brace matching. */
function canonClientsBlock() {
  const src = readFileSync(join(ROOT, "server.mjs"), "utf8");
  const anchor = src.indexOf("const _persistConfig =");
  if (anchor < 0) throw new Error("persist_config not found in server.mjs");
  const start = src.indexOf("clients: {", anchor);
  if (start < 0) throw new Error("persist_config.clients not found");
  const open = start + "clients: ".length;
  let depth = 0;
  for (let n = open; n < src.length; n++) {
    if (src[n] === "{") depth++;
    else if (src[n] === "}" && --depth === 0) return src.slice(open, n + 1);
  }
  throw new Error("persist_config.clients block never closed");
}

describe("canon itself", () => {
  // ★ FLOOR. Every assertion below this is "X is absent", and absence is also
  // what a failed extraction looks like. A renamed variable would make the
  // block empty and every count would read zero — green, and meaningless.
  it("the clients block parses and is a real block", () => {
    const block = canonClientsBlock();
    expect(block.length).toBeGreaterThan(2000);
    // The eight clients canon actually ships snippets for.
    for (const name of ["claude_desktop", "claude_code", "cursor", "vscode",
                        "cline", "windsurf", "gemini_cli", "antigravity"]) {
      expect(block, `${name} missing from persist_config.clients`)
        .toContain(name);
    }
  });

  it("names streamable-http ZERO times as a client transport", () => {
    const block = canonClientsBlock();
    const hits = block.split("streamable-http").length - 1;
    expect(hits, "persist_config.clients now ships a client snippet naming " +
      "`streamable-http`. That is the value every downstream guard " +
      "(dchub-backend, dchub-frontend) forbids BECAUSE canon does not use it. " +
      "Either this is the defect those guards exist to catch, or canon really " +
      "changed and three repos need updating in lockstep — it is never a " +
      "one-line edit here.").toBe(0);
    // ...and `streamableHttp` (camelCase, Cline's) is a DIFFERENT token that
    // must survive. If this goes to zero someone ran a blind replace.
    expect(block.split("streamableHttp").length - 1).toBeGreaterThanOrEqual(1);
  });
});

describe("no client config in this repo names streamable-http", () => {
  // ★ FLOOR again: a broken `git ls-files` yields an empty list, and an empty
  // scan reports clean.
  it("the scan actually reaches the repo", () => {
    const files = trackedFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain("server.mjs");
    expect(files).toContain("docs/one-click-install.md");
  });

  it("finds no violations", () => {
    const bad = violationsIn(trackedFiles());
    expect(bad, "A client config block names `streamable-http` as its " +
      "transport. That value appears ZERO times in persist_config.clients " +
      "(this repo's own server.mjs) and a wrong transport is a connector that " +
      "silently does not load.\n\n" + bad.join("\n")).toEqual([]);
  });

  // ★ THE POSITIVE PROBE. Everything above asserts ABSENCE, and once the repo
  // is clean that is what a working guard AND a broken one both print. Proved
  // downstream: mutating the marker predicate to a bare `false` left
  // dchub-backend's whole guard file GREEN across five tests. Only a KNOWN-BAD
  // input can tell the two apart.
  it("still detects a known-bad client config", () => {
    const cases = {
      "probe.json":
        '{\n  "mcpServers": {\n    "dchub": {\n' +
        '      "url": "https://dchub.cloud/mcp",\n' +
        '      "transport": "streamable-http"\n    }\n  }\n}',
      "probe-vscode.json":
        '{\n  "servers": {\n    "dchub": {"type": "streamable-http"}\n  }\n}',
      "probe.md":
        "**Claude Desktop**:\n```json\n" +
        '{ "mcpServers": { "dchub": { "transport": "streamable-http" } } }\n```',
      "probe-cli.md":
        "```bash\nclaude mcp add dchub --transport streamable-http " +
        "https://dchub.cloud/mcp\n```",
    };
    for (const [name, body] of Object.entries(cases)) {
      const lines = body.split("\n");
      const hit = lines.findIndex(
        (l) => FORBIDDEN.test(l) || FORBIDDEN_CLI.test(l));
      const flagged = FORBIDDEN_CLI.test(lines[hit]) || windowHasMarker(lines, hit);
      expect(flagged, `${name} was NOT flagged — detection is off, and every ` +
        `other assertion here passes on an empty result`).toBe(true);
    }
  });

  // ★ NEGATIVE PROBE 1 — directional. A self-description whose only marker
  // sits AFTER it must not be flagged.
  it("does not flag a self-description whose marker comes after it", () => {
    const lines = [
      '{',
      '  "name": "DC Hub MCP Server",',
      '  "type": "remote-mcp-server",',
      '  "transport": "streamable-http",',      // <- correct
      '  "client_config": {',
      '    "mcpServers": {',                    // <- marker, AFTER
      '      "dchub": {"transport": "http"}',
      '    }',
      '  }',
      '}',
    ];
    const hit = lines.findIndex((l) => FORBIDDEN.test(l));
    expect(windowHasMarker(lines, hit)).toBe(false);
    // ...and a SYMMETRIC window would have flagged it, so this probe is
    // exercising the difference rather than passing for a trivial reason.
    const sym = lines
      .slice(Math.max(0, hit - CFG_WINDOW), hit + CFG_WINDOW + 1).join("\n");
    expect(CFG_MARKERS.some((m) => sym.includes(m))).toBe(true);
  });

  // ★ NEGATIVE PROBE 2 — fence. This is docs/one-click-install.md's real shape.
  it("does not reach across a fence into the previous client's block", () => {
    const lines = [
      "**Cursor** (manual) — `~/.cursor/mcp.json`:",
      "```json",
      '{ "mcpServers": { "dchub": { "url": "https://dchub.cloud/mcp" } } }',
      "```",
      "",
      "**Continue.dev** — `config.json`:",
      "```json",
      '{ "transport": { "type": "streamable-http", "url": "…" } }',
      "```",
    ];
    const hit = lines.findIndex((l) => FORBIDDEN.test(l));
    expect(windowHasMarker(lines, hit)).toBe(false);
    // ...and a FENCE-BLIND backward window would have found the marker.
    const blind = lines.slice(Math.max(0, hit - CFG_WINDOW), hit + 1).join("\n");
    expect(CFG_MARKERS.some((m) => blind.includes(m))).toBe(true);
  });
});
