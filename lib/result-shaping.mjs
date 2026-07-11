// ── result-shaping: keep structuredContent consistent with content ──────────
// Extracted from server.mjs so it can be unit-tested offline.
//
// BUG THIS FIXES (2026-06-21): the next_session stamp used to create a
// structuredContent containing ONLY {next_session} for any tool whose handler
// returned data solely in content[0].text (≈40 of 47 tools). MCP clients that
// render structuredContent (Claude Desktop / Claude.ai) then showed ONLY the
// retention nudge and HID the real payload. Tools whose handler already set
// structuredContent = full data (grid/scoreboard/compare_isos) were unaffected,
// which is why the breakage looked tool-specific.
//
// Fix: never fabricate a data-less structuredContent. When the handler set none,
// MIRROR the JSON payload from content[0] into structuredContent before adding
// next_session — so both surfaces carry the data (MCP-spec consistent). If the
// payload can't be safely mirrored (non-JSON / bare array), leave structuredContent
// absent so the client falls back to content (data still shows).

// Parse the first JSON-OBJECT content block (skips the "Source: DC Hub …"
// attribution text block, which doesn't start with '{'). Returns the object, or
// null if there's no plain-object payload to mirror.
export function payloadObjFromContent(content) {
  try {
    if (!Array.isArray(content)) return null;
    const first = content.find(
      (it) => typeof it?.text === 'string' && it.text.trim().startsWith('{'));
    if (!first) return null;
    const obj = JSON.parse(first.text);
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : null;
  } catch {
    return null;
  }
}

// ── embedClaim: in-context claim delivery at the VALUE moment (#1241) ────────
// Diagnosis: 54 high-intent claims minted, ~1 viewed — the claim URL was only
// returned on the BLOCKED (trial-preview) path, and as a link agents don't
// surface. This injects a structured `claim` object into BOTH content[0] JSON
// and structuredContent so the calling agent renders it inline in its reply.
// Pair with withNextSession (mirrors content -> structuredContent). Additive,
// idempotent, never throws; no-op without a claim.url.
export function embedClaim(result, claim) {
  try {
    if (!result || result.isError || !claim || !claim.url) return result;
    let content = result.content;
    if (Array.isArray(content)) {
      content = content.map((it) => {
        if (typeof it?.text === 'string' && it.text.trim().startsWith('{')) {
          try {
            const o = JSON.parse(it.text);
            if (o && typeof o === 'object' && !Array.isArray(o) && !o.claim) {
              o.claim = claim;
              return { ...it, text: JSON.stringify(o) };
            }
          } catch { /* not JSON → leave intact */ }
        }
        return it;
      });
    }
    const out = { ...result, content };
    if (result.structuredContent && typeof result.structuredContent === 'object'
        && !result.structuredContent.claim) {
      out.structuredContent = { ...result.structuredContent, claim };
    }
    return out;
  } catch (_) {
    return result;
  }
}

// ── withQueryEcho: make the echoed `query` authoritative per-call ────────────
// Concurrency guard (2026-07-04): semantic_search and search_intelligence both
// proxy the SAME backend endpoint (/api/v1/rag/search), whose JSON echoes back a
// top-level `query`. When the two tools run in ONE parallel batch, that echoed
// label could come back CROSSED — call A's response carrying call B's submitted
// query — a state-isolation defect UPSTREAM of this process (the RESULTS are
// always correct for each call's own query; only the label crossed).
//
// Each handler already holds its OWN submitted query in a local. Stamping that
// local onto the response here makes the echo deterministic and immune to any
// upstream crossing, so an agent that fires both tools at once can always trust
// which query produced which results. Pure + local: returns a shallow copy with
// `query` overwritten (never mutates the input), no-ops on non-object / bare-array
// payloads and empty queries, never throws.
export function withQueryEcho(data, query) {
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    if (typeof query !== 'string' || !query) return data;
    return { ...data, query };
  } catch (_) {
    return data;
  }
}

// ── withProvenance: surface the backend PROVENANCE ENVELOPE (2026-07-11) ────
// The backend stamps flagship collection responses with a collection-level
// `provenance` block — {source, method, as_of, verification_counts,
// cite_url_template, license, cite_as} — plus per-record `v` flags
// ("verified" | "tracked" | "published" | "inferred"). This helper:
//   1) MIRRORS that block into structuredContent.provenance (existing key wins)
//      so structuredContent-preferring clients (Claude Desktop/.ai) see it, and
//   2) appends ONE compact footer line (attached to the existing "Source: DC
//      Hub" citation block when present) so content-reading agents can QUOTE
//      the verification level when citing.
// TOLERANT BY DESIGN: the block may or may not be present per tool (rollout is
// backend-side and incremental). When absent or malformed the result is
// returned UNCHANGED — never fabricate provenance. When the handler set no
// structuredContent at all we do NOT invent a metadata-only one (that was the
// 2026-06-21 bug class); withNextSession's payload mirror carries the block
// there. Additive, idempotent, never throws.
const _PROV_MARK = '\u{1F4CE} provenance:';

// Build the compact one-line footer, e.g.
//   "📎 provenance: 4,903/21,900 verified · as_of 2026-07-10 · cite DC Hub, dchub.cloud"
// Returns null when the block carries nothing worth printing (never fabricate).
export function provenanceFooterLine(prov) {
  try {
    if (!prov || typeof prov !== 'object' || Array.isArray(prov)) return null;
    const parts = [];
    const vc = prov.verification_counts;
    if (vc && typeof vc === 'object' && !Array.isArray(vc)) {
      const fmt = (n) => (typeof n === 'number' && Number.isFinite(n))
        ? n.toLocaleString('en-US') : null;
      const v = fmt(vc.verified), t = fmt(vc.tracked);
      if (v != null && t != null) parts.push(`${v}/${t} verified`);
      else if (v != null) parts.push(`${v} verified`);
      else if (t != null) parts.push(`${t} tracked`);
    }
    if (typeof prov.as_of === 'string' && prov.as_of) parts.push(`as_of ${prov.as_of}`);
    if (typeof prov.cite_as === 'string' && prov.cite_as) parts.push(`cite ${prov.cite_as}`);
    if (!parts.length) return null;
    return `${_PROV_MARK} ${parts.join(' · ')}`;
  } catch {
    return null;
  }
}

export function withProvenance(result, { appendFooter = true } = {}) {
  try {
    if (!result || result.isError || !Array.isArray(result.content)) return result;
    const payload = payloadObjFromContent(result.content);
    const prov = payload && payload.provenance;
    // Backend block absent/malformed → byte-identical result. NEVER fabricate.
    if (!prov || typeof prov !== 'object' || Array.isArray(prov)) return result;

    let out = result;

    // (1) Mirror into an EXISTING structuredContent (existing provenance wins —
    // idempotent; a handler that already set it, e.g. sc = full payload, is
    // unchanged). No sc at all → leave absent; withNextSession mirrors the full
    // payload (incl. provenance) later in the chain.
    const sc = (result.structuredContent && typeof result.structuredContent === 'object'
                && !Array.isArray(result.structuredContent)) ? result.structuredContent : null;
    if (sc && sc.provenance === undefined) {
      out = { ...out, structuredContent: { ...sc, provenance: prov } };
    }

    // (2) ONE compact footer line — appended to the existing citation footer
    // block when present, else as its own trailing text item. Idempotent.
    if (appendFooter
        && !out.content.some((it) => typeof it?.text === 'string' && it.text.includes(_PROV_MARK))) {
      const line = provenanceFooterLine(prov);
      if (line) {
        const content = out.content.slice();
        const idx = content.findIndex(
          (it) => typeof it?.text === 'string' && it.text.startsWith('Source: DC Hub'));
        if (idx >= 0) content[idx] = { ...content[idx], text: content[idx].text + '\n' + line };
        else content.push({ type: 'text', text: line });
        out = { ...out, content };
      }
    }
    return out;
  } catch (_) {
    return result;
  }
}

// Stamp next_session, keeping structuredContent === the full payload.
// Additive, idempotent, never throws, never empties a response.
export function withNextSession(result, NEXT_SESSION) {
  try {
    if (!result || result.isError) return result;
    const payload = payloadObjFromContent(result.content);   // the real data (or null)
    let sc;
    if (result.structuredContent && typeof result.structuredContent === 'object') {
      // Merge the payload UNDER the existing sc so a METADATA-ONLY sc (e.g.
      // withFreshness's {freshness,citation} on get_fiber_intel) still carries
      // the data. Existing keys win — payload only fills what's missing — so a
      // handler that set sc=full data is unchanged.
      sc = payload ? { ...payload, ...result.structuredContent } : { ...result.structuredContent };
    } else {
      if (!payload) return result;                  // no safe mirror → stay content-only
      sc = { ...payload };                          // mirror the real payload
    }
    if (sc.next_session) return result;             // idempotent — never stamp twice
    // r-portfolio (2026-07-11): NEXT_SESSION may be a factory (payload) =>
    // block, so the nudge can reference the caller's ACTUAL saved state (the
    // backend's `portfolio` block) instead of generic copy. sc carries the
    // payload merged under any metadata, so the factory sees `portfolio`
    // whichever surface it arrived on. Factory failure → generic block.
    let ns = NEXT_SESSION;
    if (typeof NEXT_SESSION === 'function') {
      try { ns = NEXT_SESSION(sc); } catch (_) { ns = null; }
    }
    if (!ns || typeof ns !== 'object') return result;
    sc.next_session = ns;
    return { ...result, structuredContent: sc };
  } catch (_) {
    return result;
  }
}

// r-portfolio (2026-07-11): personalize the next_session retention block with
// the caller's actual saved state when the payload carries the backend's
// `portfolio` block (get_changes / list_saved_sites for keyed callers). The
// static copy told an agent with 3 saved sites to "save_site (persist a site
// you scored)" — this replaces that with "you have 3 saved sites — 1 moved
// since your last visit (verdict CAUTION → BUILD)". Pure + fail-soft: any
// surprise in the shape returns `base` unchanged.
export function personalizeNextSession(payload, base) {
  try {
    const p = payload && payload.portfolio;
    const n = p ? Number(p.saved_sites) : 0;
    if (!Number.isFinite(n) || n < 1) return base;
    const moved = Number(p.moved_count || 0) || 0;
    const armed = Number(p.alerts_armed || 0) || 0;
    const bits = [`You have ${n} saved site${n === 1 ? '' : 's'}`];
    const movedRows = Array.isArray(p.moved) ? p.moved : [];
    if (moved) {
      const names = movedRows.slice(0, 3).map((m) => m && m.name).filter(Boolean);
      const sinceLabel = String(p.since || '').slice(0, 10);
      bits.push(`${moved} moved since ${sinceLabel || 'your last check'}`
                + (names.length ? ` (${names.join(', ')})` : ''));
      const flip = movedRows.find((m) => m && m.verdict_changed && m.verdict_was && m.verdict_now);
      if (flip) bits.push(`${flip.name || flip.market}: verdict ${flip.verdict_was} → ${flip.verdict_now}`);
    } else {
      bits.push('none moved in this window');
    }
    bits.push(armed
      ? `${armed} alert${armed === 1 ? '' : 's'} armed`
      : 'no alerts armed — set_site_alert emails your human when one moves');
    return {
      ...base,
      your_state: bits.join(' · '),
      call: 'get_changes since=<your cached generated_at> — its `portfolio` block leads with YOUR saved sites\' deltas',
      why: 'DC Hub is tracking your saved sites: get_changes returns a `portfolio` block with per-site verdict flips, score deltas, fired alerts and new facilities nearby — the delta on YOUR shortlist, not just global movers.',
    };
  } catch (_) {
    return base;
  }
}
