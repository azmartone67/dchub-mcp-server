// canvas-teaser-copy.mjs -- site_selection_canvas's locked synthesis names no plan (owner, 2026-11-17).
//
// WHY. The data API (dchub-backend routes/site_selection_canvas.py _teaser) writes the canvas synthesis for a
// caller without the decision layer as
//   message: "🎯 The decision layer is locked. You can see the ranked shortlist above (N markets) for free — but the
//             *answer* (which one to pick, the why, the build sequence, and the risk flags for X) is the paid layer."
//   unlock:  { url, pitch: "A paid DC Hub plan for agents unlocks the full Site Selection Canvas synthesis + the MCP
//             decision tools." }
// and /mcp served both as written. The keyless wording step (lib/keyless-plan-wording.mjs) does not run for a clean
// platform (via=chatgpt), a keyed caller, or a loopback step, so /mcp?via=chatgpt carried the sentence and the pitch.
//
// WHAT. On the canonical /mcp surfaces, the canvas handler rewrites that one message to a neutral sentence (what is
// withheld, no plan, no price) and drops `unlock.pitch`; `unlock.url` stays, it is the link. The directory, Claude and
// core profiles are skipped: each runs its own scrub, which already drops both sentences, and /mcp/chatgpt's output
// stays as it was. Kill switch DCHUB_CANVAS_TEASER_NEUTRAL=0.

export const CANVAS_TEASER_FLAG = 'DCHUB_CANVAS_TEASER_NEUTRAL';
export function canvasTeaserNeutralOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env[CANVAS_TEASER_FLAG]) || '').trim());
}

// The data API's teaser sentence; N and the market name are captured so the neutral form keeps them.
const TEASER_RE = /^(?:🎯 )?The decision layer is locked\. You can see the ranked shortlist above \((\d+) markets?\) for free\s*[—-]+\s*but the \*answer\* \(which one to pick, the why, the build sequence, and the risk flags for ([^)]*)\) is the paid layer\.$/;

export function neutralCanvasTeaserMessage(n, market) {
  return `The ranked shortlist above (${n} markets) is included. The decision layer (which one to pick, the why, `
    + `the build sequence, and the risk flags for ${market}) is not included in this preview.`;
}

// Returns the data object with the synthesis rewritten (a new object), or the input when nothing matches.
export function neutralCanvasTeaser(data, { skip = false, env = process.env } = {}) {
  try {
    if (skip || !canvasTeaserNeutralOn(env)) return data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    const syn = data.synthesis;
    if (!syn || typeof syn !== 'object' || Array.isArray(syn) || syn.locked !== true) return data;
    let changed = false;
    const out = { ...syn };
    if (typeof syn.message === 'string') {
      const m = TEASER_RE.exec(syn.message.trim());
      if (m) { out.message = neutralCanvasTeaserMessage(m[1], m[2]); changed = true; }
    }
    if (syn.unlock && typeof syn.unlock === 'object' && !Array.isArray(syn.unlock) && 'pitch' in syn.unlock) {
      const { pitch: _drop, ...rest } = syn.unlock;
      out.unlock = rest;
      changed = true;
    }
    return changed ? { ...data, synthesis: out } : data;
  } catch (_) { return data; }
}
