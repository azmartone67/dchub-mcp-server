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

// Stamp next_session, keeping structuredContent === the full payload.
// Additive, idempotent, never throws, never empties a response.
export function withNextSession(result, NEXT_SESSION) {
  try {
    if (!result || result.isError) return result;
    let sc;
    if (result.structuredContent && typeof result.structuredContent === 'object') {
      sc = { ...result.structuredContent };        // handler-provided (already full data)
    } else {
      const payload = payloadObjFromContent(result.content);
      if (!payload) return result;                  // no safe mirror → stay content-only
      sc = { ...payload };                          // mirror the real payload
    }
    if (sc.next_session) return result;             // idempotent — never stamp twice
    sc.next_session = NEXT_SESSION;
    return { ...result, structuredContent: sc };
  } catch (_) {
    return result;
  }
}
