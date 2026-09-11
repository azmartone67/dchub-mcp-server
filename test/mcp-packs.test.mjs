// ── a pack advertises a SUBSET, and can only ever be a subset ───────────────
//
// WHAT SHIPPED (2026-09-08). tools/list on live /mcp was one unpaginated page:
// 88 tools, 420,946 bytes minified, ~117k tokens, byte-identical on every path
// (verified /mcp vs /mcp/analyst the same day). r-pack makes the PATH select
// which tools are listed, so a caller that came for grid headroom is not handed
// the site-selection catalog as well.
//
// ★ WHAT THIS SUITE IS ACTUALLY FENCING. A listing filter has exactly two ways
// to fail, and neither announces itself:
//
//   1. IT WIDENS. The tools/list branch has a fail-soft ladder ending at the
//      ephemeral SDK path, which knows nothing about packs. If a pack path ever
//      reaches it, a 10-tool endpoint answers with all 88 — publishing MORE
//      than it advertises, at exactly the moment something is already wrong.
//      Every assertion here that compares a pack against the canonical list is
//      there for this case, not for tidiness.
//
//   2. IT SILENTLY SHRINKS. A pack names its tools as strings. Rename a tool in
//      server.mjs and the pack stops listing it, with no error anyone sees —
//      the endpoint just gets quieter. So the counts below are PINNED integers,
//      not floors and not `.length` read back off the same source they check
//      (which would pass vacuously against any value). If a pack's membership
//      changes on purpose, this number changes in the same commit.
//
// ★ AND THE ONE THAT COST US A DAY ELSEWHERE. `GET /mcp/<anything>` answers 200
// from the zone worker's health blob, so an unregistered path LOOKS healthy to
// anything that verifies by GET while POST returns `Cannot POST` and every
// install dies at initialize (this is why /mcp/docker was registered before it
// was listed). Measured on 2026-09-08, before this change:
//     GET  /mcp/site   200 application/json
//     POST /mcp/site   404 Cannot POST /mcp/site
// So the mount test below POSTs. A GET check would have passed on every one of
// these paths the day before they existed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let S, PORT, httpServer, CANON;

// PINNED. Not derived from MCP_PACKS — a count read out of the thing it is
// checking cannot fail. Change these deliberately, in the commit that changes
// the pack.
// ★2026-09-11 siting 18 -> 20 and deals 13 -> 15: get_pocket_listings and
// request_listing_intro joined both packs (off-market capacity is a siting
// input and a deal flow).
const EXPECTED = {
  deepresearch: 2,
  site: 10,
  grid: 16,
  siting: 20,
  fiber: 11,
  gas: 9,
  deals: 15,
};

async function listTools(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const raw = await res.text();
  const line = raw.split('\n').find((l) => l.startsWith('data: '));
  const body = JSON.parse(line ? line.slice(6) : raw);
  return { status: res.status, tools: body?.result?.tools, body };
}

beforeAll(async () => {
  // Same discipline as required-args: server.mjs captures API_BASE once at
  // module evaluation, and a sibling test sharing this worker's process.env
  // must not inherit the override.
  const prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;

  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;

  const canon = await listTools('/mcp');
  expect(Array.isArray(canon.tools), 'canonical /mcp tools/list did not return a tool array').toBe(true);
  CANON = canon.tools;
}, 60_000);

afterAll(async () => {
  if (httpServer) await new Promise((r) => httpServer.close(r));
});

describe('the canonical surface is untouched', () => {
  it('/mcp still serves the full catalog', () => {
    // The floor exists because every pack assertion below is relative to CANON.
    // If CANON itself collapsed, "pack is a subset of canon" would pass for a
    // pack of zero tools against a catalog of zero tools.
    expect(CANON.length).toBeGreaterThan(50);
  });

  it('/mcp is not itself a pack path', () => {
    expect(S.MCP_PACKS.has('/mcp')).toBe(false);
  });

  it('every pack path is mounted (POST, not GET)', async () => {
    for (const p of S.MCP_PACK_PATHS) {
      const r = await listTools(p);
      expect(r.status, `${p} did not answer POST tools/list`).toBe(200);
      expect(Array.isArray(r.tools), `${p} answered POST without a tool array`).toBe(true);
    }
  });
});

describe('every declared pack name exists', () => {
  it('no pack names a tool the catalog does not have', () => {
    const canonNames = new Set(CANON.map((t) => t.name));
    const bad = [];
    for (const [path, def] of S.MCP_PACKS) {
      for (const n of S.packToolNames(def)) if (!canonNames.has(n)) bad.push(`${path} -> ${n}`);
    }
    // A typo or a rename lands here rather than in a quietly shorter endpoint.
    expect(bad, `pack entries absent from the catalog: ${bad.join(', ')}`).toEqual([]);
  });

  it('the spine is in every pack that declares it', () => {
    for (const [path, def] of S.MCP_PACKS) {
      if (!def.spine) continue;
      for (const n of S.PACK_SPINE) {
        expect(S.packToolNames(def), `${path} lost spine tool ${n}`).toContain(n);
      }
    }
  });

  it('deepresearch omits the spine on purpose, and is the only one that does', () => {
    // Pinned so the omission stays a decision. If a second pack ever drops the
    // spine, that is a design change and this line is where it gets argued.
    const spineless = [...S.MCP_PACKS.values()].filter((d) => !d.spine).map((d) => d.pack);
    expect(spineless).toEqual(['deepresearch']);
  });
});

describe('what a pack path actually serves', () => {
  for (const [pack, count] of Object.entries(EXPECTED)) {
    it(`/mcp/${pack} serves exactly ${count} tools, and they are the declared ones`, async () => {
      const path = `/mcp/${pack}`;
      const def = S.MCP_PACKS.get(path);
      expect(def, `${path} is not declared in MCP_PACKS`).toBeTruthy();

      const { tools } = await listTools(path);
      expect(tools.length, `${path} served ${tools.length} tools, pinned at ${count}`).toBe(count);

      // Exact membership AND order — order is part of the contract: a pack
      // lists the tools it exists for before the shared spine.
      expect(tools.map((t) => t.name)).toEqual(S.packToolNames(def));
    });
  }

  it('no pack serves a tool the canonical surface does not', async () => {
    const canonNames = new Set(CANON.map((t) => t.name));
    for (const p of S.MCP_PACK_PATHS) {
      const { tools } = await listTools(p);
      const extra = tools.map((t) => t.name).filter((n) => !canonNames.has(n));
      expect(extra, `${p} widened beyond /mcp: ${extra.join(', ')}`).toEqual([]);
    }
  });

  it('every pack is strictly smaller than the full catalog', async () => {
    for (const p of S.MCP_PACK_PATHS) {
      const { tools } = await listTools(p);
      expect(tools.length, `${p} is not smaller than /mcp — the filter did nothing`).toBeLessThan(CANON.length);
      expect(tools.length, `${p} served an empty list`).toBeGreaterThan(0);
    }
  });

  it('a filtered tool is the canonical tool, annotations and schema intact', async () => {
    // The filter must COPY tool objects out of the canonical result, never
    // rebuild them. Rebuilding is how the access/maturity annotations —
    // re-applied on the cached path precisely because the SDK probe strips
    // them — would vanish on pack paths only.
    const { tools } = await listTools('/mcp/site');
    const byName = new Map(CANON.map((t) => [t.name, t]));
    for (const t of tools) {
      const c = byName.get(t.name);
      expect(c, `${t.name} not in canon`).toBeTruthy();
      expect(t.description).toBe(c.description);
      expect(t.inputSchema).toEqual(c.inputSchema);
      expect(t.annotations, `${t.name} lost its annotations through the filter`).toBeTruthy();
      expect(t.annotations.access).toBe(c.annotations.access);
    }
  });
});

describe('a pack path does not answer with more than it advertises', () => {
  it('the cache kill switch cannot widen a pack', async () => {
    // DCHUB_TOOLSLIST_CACHE_DISABLE turns off an optimisation. On /mcp it drops
    // to the ephemeral SDK path; on a pack path that path would serve all 88,
    // so the switch is ignored there. This asserts the ignoring.
    const prev = process.env.DCHUB_TOOLSLIST_CACHE_DISABLE;
    process.env.DCHUB_TOOLSLIST_CACHE_DISABLE = '1';
    try {
      const { tools } = await listTools('/mcp/site');
      expect(tools.length).toBe(EXPECTED.site);
    } finally {
      if (prev === undefined) delete process.env.DCHUB_TOOLSLIST_CACHE_DISABLE;
      else process.env.DCHUB_TOOLSLIST_CACHE_DISABLE = prev;
    }
  });

  it('a source path is not a pack path and still serves everything', async () => {
    // r-source-path tags attribution and must keep serving the full catalog —
    // /mcp/glama is a registry arrival, not a curated surface. This is the line
    // that fails if someone folds the two axes together.
    const { tools } = await listTools('/mcp/glama');
    expect(tools.length).toBe(CANON.length);
  });
});
