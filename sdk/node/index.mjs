/**
 * DC Hub Node SDK — hides the MCP JSON-RPC handshake.
 *
 * Wraps the MCP transport (initialize -> notifications/initialized -> tools/call,
 * SSE response parsing) so you can just write:
 *
 *   import { DCHub } from "dchub";
 *   const dc = new DCHub();                 // reads DCHUB_API_KEY from env
 *   await dc.market("northern-virginia");
 *   await dc.search({ state: "VA" });
 *   await dc.grid("ERCOT");
 *   await dc.call("get_market_intel", { market: "dallas" });  // any of the 81 tools
 *   await dc.tools();                        // list tool names
 *
 * Zero runtime dependencies (uses global fetch, Node >= 18).
 */
const DEFAULT_ENDPOINT = "https://dchub.cloud/mcp";

function parseBody(raw) {
  raw = raw.trim();
  if (!raw) return null;
  if (raw.startsWith("{")) return JSON.parse(raw);
  for (const line of raw.split("\n")) {            // SSE: 'data: {...}'
    const l = line.trim();
    if (l.startsWith("data:")) {
      const payload = l.slice("data:".length).trim();
      if (payload.startsWith("{")) return JSON.parse(payload);
    }
  }
  throw new Error(`Could not parse MCP response body: ${raw.slice(0, 300)}`);
}

/** Strip any free-tier upsell wrapper, returning the real data payload. */
function clean(result) {
  if (result && typeof result === "object") return result;
  if (typeof result === "string") {
    for (const part of result.split("---")) {
      const p = part.trim();
      if (p.startsWith("{")) {
        let obj;
        try { obj = JSON.parse(p); } catch { continue; }
        if (!("agent_action" in obj) && !("agent_claim" in obj)) return obj;
      }
    }
    return { text: result };
  }
  return result;
}

export class DCHub {
  constructor({ apiKey, endpoint, timeout = 60000 } = {}) {
    this.endpoint = endpoint || process.env.DCHUB_ENDPOINT || DEFAULT_ENDPOINT;
    this.apiKey = apiKey !== undefined ? apiKey : process.env.DCHUB_API_KEY;
    this.timeout = timeout;
    this.sessionId = null;
  }

  _headers() {
    const h = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.apiKey) h["X-API-Key"] = this.apiKey;
    if (this.sessionId) h["Mcp-Session-Id"] = this.sessionId;
    return h;
  }

  async _post(payload) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeout);
    try {
      const res = await fetch(this.endpoint, {
        method: "POST", headers: this._headers(),
        body: JSON.stringify(payload), signal: ctrl.signal,
      });
      const sid = res.headers.get("Mcp-Session-Id");
      if (sid) this.sessionId = sid;
      return parseBody(await res.text());
    } finally {
      clearTimeout(t);
    }
  }

  async _ensureSession() {
    if (this.sessionId) return;
    await this._post({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: {
        protocolVersion: "2024-11-05", capabilities: {},
        clientInfo: { name: "dchub-node-sdk", version: "1.0" },
      },
    });
    try {
      await this._post({ jsonrpc: "2.0", method: "notifications/initialized" });
    } catch { /* best effort */ }
  }

  /** Call any DC Hub MCP tool; returns the cleaned data payload. */
  async call(tool, args = {}) {
    await this._ensureSession();
    const resp = await this._post({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: tool, arguments: args },
    });
    if (resp.error) return resp.error;
    const content = resp.result?.content ?? [];
    const parsed = content.map((item) => {
      if (item.type === "text") {
        try { return JSON.parse(item.text); } catch { return item.text; }
      }
      return item;
    });
    const raw = parsed.length === 1 ? parsed[0] : parsed;
    return clean(raw);
  }

  /** List all available tool names. */
  async tools() {
    await this._ensureSession();
    const resp = await this._post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    return (resp.result?.tools ?? []).map((t) => t.name);
  }

  /** Market intelligence for a market slug, e.g. "northern-virginia". */
  market(slug) {
    return this.call("get_market_intel", { market: slug });
  }

  /** Search facilities by free-text / state / country. */
  search({ q, state, country, limit = 5 } = {}) {
    const args = { limit };
    if (q) args.q = q;
    if (state) args.state = state;
    if (country) args.country = country;
    return this.call("search_facilities", args);
  }

  /** Live grid intelligence for an ISO, e.g. "ERCOT", "PJM". */
  grid(iso) {
    return this.call("get_grid_data", { iso });
  }

  /** Honest 0-100 composite site score + explicit per-factor coverage map. */
  compositeSiteScore(lat, lon, state = "") {
    return this.call("get_composite_site_score", { lat, lon, state });
  }

  /** Natural-hazard risk from the FEMA National Risk Index. */
  disasterRisk(lat, lon) {
    return this.call("get_disaster_risk", { lat, lon });
  }

  /** Seismic (USGS ASCE 7) + climate normals (NOAA). */
  climateIntel(lat, lon, radius_km = 25) {
    return this.call("get_climate_intel", { lat, lon, radius_km });
  }

  /** Provenance from any result: {source, retrieved_at, license}. */
  static provenance(result) {
    const c = (result && result.citation) || {};
    return { source: c.source || (result && result._source), retrieved_at: c.retrieved_at, license: c.license };
  }
}

export { clean as _clean };
export default DCHub;
